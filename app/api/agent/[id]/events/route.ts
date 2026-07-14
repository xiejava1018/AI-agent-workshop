import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession, type AgentSessionWrapper } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getSessionMeta } from "@/lib/session-meta";
import { assertCanReadSessionScoped } from "@/lib/team-auth";
import { auditLog } from "@/lib/audit-log";
import { getUserHighestRole } from "@/lib/user-role";
import { NextResponse, type NextRequest } from "next/server";
import { enforceNotMustChange } from "@/lib/must-change-password";
import { decrementUserSessionCap } from "@/lib/session-cap";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const userId = req.headers.get("x-user-id");
  if (!userId) return new NextResponse("auth required", { status: 401 });

  // 找用户的最高 role（OWNER > ADMIN > MEMBER）
  const userRole = await getUserHighestRole(userId);

  // M2.4: team-scoped authorization. Returns reason alongside the
  // boolean so the route can write audit log entries later.
  const meta = getSessionMeta(id);
  const decision = await assertCanReadSessionScoped(userId, userRole, meta, id);
  if (!decision.allowed) {
    // M2.4 audit: every cross-team or otherwise-denied session read
    // attempt is logged for incident response. The dedupe window in
    // auditLog coalesces a misbehaving client that retries a denied
    // request 100/sec into ~1 row / 5s.
    void auditLog({
      userId,
      action: "session.access_denied",
      resourceType: "session",
      resourceId: id,
      metadata: {
        path: "/api/agent/[id]/events",
        reason: decision.reason,
        sessionTeamId: meta?.teamId ?? null,
        sessionOwnerId: meta?.userId ?? null,
      },
    });
    return new NextResponse("forbidden", { status: 403 });
  }

  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    try {
      ({ session } = await startRpcSession(id, filePath, cwd));
    } catch (error) {
      return new Response(`Failed to start agent: ${error}`, { status: 500 });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      // Send initial connected event
      encode({ type: "connected", sessionId: id });

      // Capture the userId from middleware-injected header for cleanup accounting.
      // The route handler already validated x-user-id at line 22; reuse it for
      // the cap decrement on disconnect.
      const sessionUserId = req.headers.get("x-user-id") ?? "";

      // Track whether destroy has been called so cleanup is idempotent.
      let destroyed = false;
      const destroySession = () => {
        if (destroyed) return;
        destroyed = true;
        // sessionUserId may be "" for unauthenticated requests that bounced
        // earlier; only decrement when we have a real id.
        if (sessionUserId) decrementUserSessionCap(sessionUserId);
        // Only alive sessions can be destroyed. After destroy the registry
        // entry is already removed (see onDestroy callback in startRpcSession),
        // so getRpcSession returning undefined is the expected "already gone"
        // case and must NOT throw.
        const live: AgentSessionWrapper | undefined = getRpcSession(id);
        try {
          live?.destroy();
        } catch {
          // destroy() can throw if the inner agent was already torn down by
          // the 10-minute idle timer; that's fine — we just want to make
          // sure we don't double-account or leak the cap slot.
        }
      };

      const unsubscribe = session.onEvent((event) => {
        encode(event);
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      // Cleanup when client disconnects.
      // AGGRESSIVE destroy on disconnect: the previous design relied on a
      // 10-minute idle timer inside AgentSessionWrapper, which left session
      // objects (and their ~hundreds-of-MB runtime state) pinned in
      // globalThis.__piSessions between requests. Under sustained traffic
      // this drove dev-server RSS from 1.7GB to 8GB in <2 minutes
      // (reproduced 2026-07-14). Destroying on the first client-disconnect
      // signal matches the user's mental model: closing the tab frees the
      // session. The 10-minute idle timer remains as a safety net for
      // orphaned sessions (e.g. server-initiated aborts that never
      // triggered the abort signal on the client side).
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        destroySession();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
