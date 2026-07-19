import { NextResponse, type NextRequest } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getSessionMeta } from "@/lib/session-meta";
import { assertCanReadSessionScoped } from "@/lib/team-auth";
import { auditLog } from "@/lib/audit-log";
import { getUserHighestRole } from "@/lib/user-role";
import { enforceNotMustChange } from "@/lib/must-change-password";
import { invokeSkill } from "@/lib/skill-block";
import { expandModelSkillBlocks, type SkillBlockHint } from "@/lib/skill-block";

interface SkillExpansion {
  body: Record<string, unknown> & { type: string };
  /** Model-decided `<skill>` blocks detected in the message, for the frontend. */
  skillBlocks: SkillBlockHint[];
}

/**
 * Expand DB-backed skills in a prompt-type body, covering BOTH invocation paths:
 *
 * 1. EXPLICIT `/skill:<slug>` (T5.4): the pi SDK auto-expands `/skill:name`
 *    from FILESYSTEM skills inside `prompt()`. For the M3 multi-tenant
 *    SkillPackage table we resolve the slug against the caller's visible scopes
 *    here and rewrite `body.message` with the expanded `<skill>` block. When
 *    the message is not a skill command, `invokeSkill` returns null; an unknown
 *    slug throws so the caller gets a 500 with a clear "Skill not found".
 *
 * 2. MODEL-DECIDED `<skill>` block (T5.5): the assistant, having seen a skill's
 *    frontmatter in the system prompt, may emit a `<skill>...</skill>` block on
 *    its own. `expandModelSkillBlocks` resolves each block against the tenant
 *    table, injects the AUTHORITATIVE instructions read from disk for allowed
 *    skills, and STRIPS blocks the model is not allowed to self-invoke
 *    (unknown, cross-tenant, or `disable-model-invocation` — which is
 *    explicit-only). The detected blocks are returned so the caller can surface
 *    a visualization hint to the frontend.
 */
async function maybeExpandSkillCommand(
  body: Record<string, unknown> & { type: string },
  userId: string,
  teamId: string | null,
  sessionId: string,
): Promise<SkillExpansion> {
  const isPromptLike =
    body.type === "prompt" || body.type === "steer" || body.type === "follow_up";
  if (!isPromptLike || typeof body.message !== "string") return { body, skillBlocks: [] };

  // Explicit `/skill:<slug>` takes precedence: the whole message is the command.
  const explicit = await invokeSkill({ text: body.message, userId, teamId, sessionId });
  if (explicit) return { body: { ...body, message: explicit.expandedText }, skillBlocks: [] };

  // Otherwise look for model-decided `<skill>` blocks embedded in the message.
  const expanded = await expandModelSkillBlocks(body.message, { userId, teamId });
  if (!expanded) return { body, skillBlocks: [] };
  return {
    body: { ...body, message: expanded.expandedText },
    skillBlocks: expanded.detected,
  };
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
    const { body } = await maybeExpandSkillCommand(rawBody, userId, meta?.teamId ?? null, id);

    // Hotfix 补回归:用户首条 prompt 时,把会话 title 从 "" 改成首条消息摘要。
    // createSession 路由不再 derive title(因为 ensure_session 路径不一定发消息),
    // 这里统一在收到首条 prompt 时派生。后续不重复 update(title 已非空)。
    // deriveInitialSessionName 的语义与 apps/web 现有会话命名一致。
    if (body.type === "prompt" && typeof body.message === "string" && body.message.trim()) {
      try {
        const { prisma } = await import("@/lib/prisma");
        const existing = await prisma.session.findUnique({
          where: { id },
          select: { title: true }
        });
        if (existing && !existing.title) {
          const flat = body.message.replace(/\s+/g, " ").trim();
          const derived = [...flat].slice(0, 30).join("") || "新会话";
          await prisma.session.update({
            where: { id },
            data: { title: derived, updatedAt: new Date() }
          });
        }
      } catch {
        // 派生失败不影响 prompt 主路径
      }
    }

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
