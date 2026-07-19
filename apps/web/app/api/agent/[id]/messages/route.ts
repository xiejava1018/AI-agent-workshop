import { NextResponse, type NextRequest } from "next/server";
import { resolveSessionPath, getSessionEntries, buildSessionContext } from "@/lib/session-reader";
import { getSessionMeta } from "@/lib/session-meta";
import { assertCanReadSessionScoped } from "@/lib/team-auth";
import { getUserHighestRole } from "@/lib/user-role";
import { enforceNotMustChange } from "@/lib/must-change-password";
import { auditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/[id]/messages?limit=50&before=<isoTimestamp>
 *
 * 返回该 session 持久化的历史消息(Bug 2:tab 切换历史消失)。
 *
 * 数据来源:session .jsonl 文件(走 session-reader),与 SSE events 是同一份数据,
 * 但 SSE 只能推增量、不能拉历史。Vue 端切 tab 时 fetchHistory(sessionId) 调用。
 *
 * 鉴权:与 /api/agent/sessions 同语义 — assertCanReadSessionScoped。
 *
 * 响应:{ code, data: { messages: AgentMessage[], hasMore: boolean, total: number } }
 *   - messages 按 entry 顺序(根 → 叶,UI 渲染序)
 *   - hasMore: limit 截断后是否还有更早的消息
 *   - total: 该 session 全部 entry 数(从 SessionInfo.messageCount 读)
 *
 * 为什么不走 buildSessionContext 的完整结果?
 *   buildSessionContext 会对 LLM 上下文做裁剪(压缩前的丢),这是给模型的。
 *   我们要的是 UI 完整历史,所以直接拿 getSessionEntries + 自己 walk path,
 *   复用同一份 entryToUiMessage(通过 buildSessionContext 暴露的 messages 即可,
 *   因 buildSessionContext 内已做了"为 UI 保留全量分支路径"的处理 — 见
 *   session-reader.ts 行 184-189 注释)。
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  const { id: sessionId } = await params;
  const url = new URL(req.url);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT)
  );
  const before = url.searchParams.get("before"); // 可选:ISO timestamp,只返早于此的消息

  // 鉴权
  const meta = getSessionMeta(sessionId);
  const userRole = await getUserHighestRole(userId);
  const decision = await assertCanReadSessionScoped(userId, userRole, meta, sessionId);
  if (!decision.allowed) {
    void auditLog({
      userId,
      action: "session.messages_denied",
      resourceType: "agent_session",
      resourceId: sessionId,
      metadata: { reason: decision.reason ?? "forbidden" },
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 解析 session 文件路径
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) {
    return NextResponse.json(
      { code: 404, error: "session not found or file unavailable" },
      { status: 404 }
    );
  }

  let entries;
  try {
    entries = getSessionEntries(filePath);
  } catch (e) {
    return NextResponse.json(
      { code: 500, error: "failed to read session entries" },
      { status: 500 }
    );
  }

  // 用 buildSessionContext 拿 messages(已做"UI 完整历史"处理)。
  // 它返回的 messages 是数组形式,顺序为根→叶。
  const ctx = buildSessionContext(entries, null, { deferThinking: false });
  let messages = ctx.messages;

  // before 过滤
  if (before) {
    const beforeMs = Date.parse(before);
    if (!Number.isNaN(beforeMs)) {
      messages = messages.filter((m) => {
        const ts = (m as { timestamp?: number }).timestamp;
        return typeof ts === "number" ? ts < beforeMs : true;
      });
    }
  }

  const total = messages.length;
  const hasMore = total > limit;
  const sliced = hasMore ? messages.slice(0, limit) : messages;

  return NextResponse.json({
    code: 200,
    data: {
      messages: sliced,
      hasMore,
      total,
    },
  });
}