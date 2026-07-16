import { NextResponse, type NextRequest } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getSessionMeta } from "@/lib/session-meta";
import { assertCanReadSessionScoped } from "@/lib/team-auth";
import { auditLog } from "@/lib/audit-log";
import { getUserHighestRole } from "@/lib/user-role";
import { enforceNotMustChange } from "@/lib/must-change-password";
import { invokeSkill } from "@/lib/skill-invoke";

/**
 * Expand a DB-backed `/skill:<slug>` command in a prompt-type body.
 *
 * The pi SDK auto-expands `/skill:name` from FILESYSTEM skills inside
 * `prompt()`. For the M3 multi-tenant SkillPackage table (T5.4) we resolve the
 * slug against the caller's visible scopes here and rewrite `body.message`
 * with the expanded `<skill>` block before handing it to the session. When the
 * message is not a skill command, `invokeSkill` returns null and the body is
 * forwarded unchanged; an unknown slug throws so the caller gets a 500 with a
 * clear "Skill not found" message instead of a literal `/skill:foo` prompt.
 */
async function maybeExpandSkillCommand(
  body: Record<string, unknown> & { type: string },
  userId: string,
  teamId: string | null,
  sessionId: string,
): Promise<Record<string, unknown> & { type: string }> {
  const isPromptLike =
    body.type === "prompt" || body.type === "steer" || body.type === "follow_up";
  if (!isPromptLike || typeof body.message !== "string") return body;

  const result = await invokeSkill({ text: body.message, userId, teamId, sessionId });
  if (!result) return body;
  return { ...body, message: result.expandedText };
}

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const userRole = await getUserHighestRole(userId);
  const meta = getSessionMeta(id);
  const decision = await assertCanReadSessionScoped(userId, userRole, meta, id);
  if (!decision.allowed) {
    void auditLog({
      userId,
      action: "session.access_denied",
      resourceType: "session",
      resourceId: id,
      metadata: {
        path: "/api/agent/[id] POST",
        reason: decision.reason,
        sessionTeamId: meta?.teamId ?? null,
        sessionOwnerId: meta?.userId ?? null,
      },
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const rawBody = await req.json() as { type: string; [key: string]: unknown };
    const body = await maybeExpandSkillCommand(rawBody, userId, meta?.teamId ?? null, id);

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();

    const { session } = await startRpcSession(id, filePath, cwd);
    const result = await session.send(body);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const userRole = await getUserHighestRole(userId);
  const meta = getSessionMeta(id);
  const decision = await assertCanReadSessionScoped(userId, userRole, meta, id);
  if (!decision.allowed) {
    void auditLog({
      userId,
      action: "session.access_denied",
      resourceType: "session",
      resourceId: id,
      metadata: {
        path: "/api/agent/[id] GET",
        reason: decision.reason,
        sessionTeamId: meta?.teamId ?? null,
        sessionOwnerId: meta?.userId ?? null,
      },
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
