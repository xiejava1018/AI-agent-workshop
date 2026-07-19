import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceNotMustChange } from "@/lib/must-change-password";
import { assertCanReadSessionScoped } from "@/lib/team-auth";
import { getUserHighestRole } from "@/lib/user-role";
import { getSessionMeta } from "@/lib/session-meta";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { isPinned as isSessionPinned } from "@/lib/session-prefs";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/sessions
 *
 * M4 dashboard fix: 前端 useAgentEvents 调这个端点拉 session 列表。
 * 后端原本无该端点(只 /api/agent/new + /api/agent/[id]),
 * 导致 dashboard Agent 工作台 404。
 *
 * 返当前用户可见的 session 列表:
 * - platform_admin 返所有 session
 * - 其他用户返:自己创建的 + 所在 team 的 + SessionShare 给自己的
 *   (用 assertCanReadSessionScoped 的 team 语义)
 *
 * body: { code, message, data: { items, total } }
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  const userRole = await getUserHighestRole(userId);

  // 拉所有 session
  const sessions = await prisma.session.findMany({
    orderBy: { updatedAt: "desc" },
  });

  // 按 team 权限过滤 + 标 runtime 状态
  const items: Array<{
    id: string;
    title: string;
    userId: string;
    teamId: string | null;
    createdAt: string;
    updatedAt: string;
    /** M4 fix: true = session runtime 启动(可聊天), false = 文件不在/未启动(老 session 不可用) */
    available: boolean;
    /** M3 follow-up: 来自 session-prefs 的全局 pin 标记,供 dashboard Agent 工作台 UI 使用 */
    pinned: boolean;
  }> = [];

  for (const s of sessions) {
    const meta = getSessionMeta(s.id);
    const decision = await assertCanReadSessionScoped(userId, userRole, meta, s.id);
    if (decision.allowed) {
      // fix-agent-workbench-delete-session-404:拒绝 DB 有 row 但磁盘 .jsonl
      // 缺失的"僵尸 session",否则侧栏 UI 会列出它,删除时 DELETE handler 走
      // resolveSessionPath → null 必返 404。available 字段仅查内存 runtime,
      // 检测不到磁盘文件已丢失,所以这里补一道 resolveSessionPath 兜底。
      const filePath = await resolveSessionPath(s.id);
      if (!filePath) continue;
      // runtime 状态:memory registry 里有 = 可用(M2.x 老 session 文件不在 → 不可用)
      const available = getRpcSession(s.id) !== undefined;
      items.push({
        id: s.id,
        title: s.title,
        userId: s.userId,
        teamId: s.teamId,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        available,
        pinned: isSessionPinned(s.id),
      });
    }
  }

  return NextResponse.json({
    code: 200,
    message: "success",
    data: { items, total: items.length },
  });
}
