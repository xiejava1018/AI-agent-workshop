import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { allowFileRoot } from "@/lib/file-access";
import { startRpcSession, destroyAllSessionsForUser } from "@/lib/rpc-manager";
import { recordSessionMeta } from "@/lib/session-meta";
import { enforceNotMustChange } from "@/lib/must-change-password";
import { prisma } from "@/lib/prisma";
import { assertWithinRoot } from "@/lib/path-safety";
import { auditLog } from "@/lib/audit-log";
import {
  checkUserSessionCap,
  incrementUserSessionCap,
  getOldestActiveUserIdExcept,
  GLOBAL_SESSION_CAP_MAX,
} from "@/lib/session-cap";

// POST /api/agent/new  body: { type: string; message?: string; ... }
// Spawns a brand-new pi session. Most calls immediately send the first command;
// type:"ensure_session" only creates the runtime so clients can query commands.
// Returns { sessionId, data } where sessionId is pi's real session id.
//
// The cwd is NOT supplied by the client. Instead, server reads
// user.lastProjectId, loads the Project, verifies the user is a member of
// the project's team, and uses project.rootPath as the cwd (Task 4.2).
export async function POST(req: NextRequest) {
  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  try {
    // Task 4.2: cwd is no longer read from request body. Resolve cwd
    // from user.lastProjectId -> Project.rootPath, with team-membership
    // authorization.
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }

    // Task 4.6: per-user cap check (default 5) with global 50 fallback,
    // enforced BEFORE any expensive work (DB lookups, RPC start). JS single-
    // threaded event loop makes the check + (later) increment safe for
    // synchronous calls. Awaited lookups between check and increment could
    // theoretically allow concurrent requests to slip past by 1 in the worst
    // case; accepted per design doc §D4.
    // NOTE: checkUserSessionCap checks BOTH per-user (5) AND global (50);
    // the previous M2.2 separate global-only check is folded into this call.
    // LEAK FIX (2026-07-14): when a cap is hit, attempt LRU eviction of the
    // least-recently-active user before rejecting. The original cap design
    // only ever incremented (decrement had no caller), so a dev server with
    // sustained session churn drove RSS from 1.7GB to 8GB and OOM-killed
    // the process within minutes. Eviction here destroys the victim's live
    // AgentSessionWrapper objects (the ~hundreds-of-MB pi runtime state),
    // which is what actually frees memory — the cap counter is just the gate.
    let cap = checkUserSessionCap(userId);
    if (!cap.allowed) {
      const victim =
        cap.max === GLOBAL_SESSION_CAP_MAX
          ? getOldestActiveUserIdExcept(userId)
          : userId; // per-user cap: only this user's own sessions can be freed
      if (victim) {
        destroyAllSessionsForUser(victim);
        // Re-check after eviction; allowed may flip to true.
        cap = checkUserSessionCap(userId);
      }
    }
    if (!cap.allowed) {
      const isGlobal = cap.max === GLOBAL_SESSION_CAP_MAX;
      const message = isGlobal
        ? `global session cap reached (${GLOBAL_SESSION_CAP_MAX} active sessions)`
        : `user session cap reached (${cap.current}/${cap.max})`;
      return new NextResponse(JSON.stringify({ error: message }), {
        status: 503,
        headers: {
          "Retry-After": "60",
          "Content-Type": "application/json",
        },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lastProjectId: true },
    });
    if (!user?.lastProjectId) {
      return NextResponse.json(
        { error: "no project selected" },
        { status: 400 }
      );
    }

    const project = await prisma.project.findUnique({
      where: { id: user.lastProjectId },
    });
    if (!project) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }

    // Authorization: user must be a member of the project's team.
    const tm = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
    });
    if (!tm) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // Path self-check (M1 invariant — cwd must lie within itself).
    try {
      assertWithinRoot(project.rootPath, project.rootPath);
    } catch {
      return NextResponse.json({ error: "path invalid" }, { status: 500 });
    }

    const cwd = project.rootPath;
    const body = await req.json() as { [key: string]: unknown };
    const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } =
      body as {
        provider?: string;
        modelId?: string;
        toolNames?: string[];
        thinkingLevel?: string;
        [key: string]: unknown;
      };

    if (!existsSync(cwd)) {
      return NextResponse.json(
        { error: `Directory does not exist: ${cwd}` },
        { status: 400 }
      );
    }

    // Use a one-time key so startRpcSession's lock doesn't conflict with real session ids
    const tempKey = `__new__${Date.now()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames, userId);

    // Register session metadata so /api/agent/[id]/events and
    // /api/agent/[id] (POST) can authorize the freshly-created session
    // synchronously. The lazy rebuildFromJsonl scan in lib/session-meta.ts
    // is asynchronous and races with the first SSE open from the client,
    // which manifests as "EventStreamConnectionError -> 403" in
    // hooks/useAgentSession.ts's ensureEventsConnected (observed
    // 2026-07-14). recordSessionMeta is idempotent — later reads from the
    // .jsonl file override on the first-line fields.
    recordSessionMeta(realSessionId, userId, project.id, project.teamId);

    // M2.4 audit: every successful session creation is logged so we can
    // reconstruct what user created which session in which team after the
    // fact. This is the entry that lets "what sessions exist" questions
    // be answered without scanning globalThis.__piSessions.
    void auditLog({
      userId,
      action: "session.create",
      resourceType: "session",
      resourceId: realSessionId,
      metadata: { projectId: project.id, projectName: project.name, teamId: project.teamId },
    });

    // Task 4.6: increment cap ONLY after successful session creation.
    // A failed startRpcSession must NOT consume a slot.
    incrementUserSessionCap(userId);

    // Keep the files-route allowed-roots cache (see app/api/files/[...path]/route.ts)
    // in sync so the new cwd is immediately readable via /api/files. Without this,
    // a file request under a brand-new cwd would 403 for up to the cache TTL.
    allowFileRoot(cwd);

    // Apply pre-selected model before sending the prompt
    if (provider && modelId) {
      await session.send({ type: "set_model", provider, modelId });
    }

    // Apply pre-selected thinking level before sending the prompt
    if (thinkingLevel) {
      await session.send({ type: "set_thinking_level", level: thinkingLevel });
    }

    if (promptCommand.type === "ensure_session") {
      return NextResponse.json({ success: true, sessionId: realSessionId, data: null });
    }

    const result = await session.send(promptCommand);

    return NextResponse.json({ success: true, sessionId: realSessionId, data: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}