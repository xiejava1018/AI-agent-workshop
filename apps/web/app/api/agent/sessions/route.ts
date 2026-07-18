import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceNotMustChange } from "@/lib/must-change-password";
import { assertCanReadSessionScoped } from "@/lib/team-auth";
import { getUserHighestRole } from "@/lib/user-role";
import { getSessionMeta } from "@/lib/session-meta";
import { getRpcSession } from "@/lib/rpc-manager";

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
  }> = [];

  for (const s of sessions) {
    const meta = getSessionMeta(s.id);
    const decision = await assertCanReadSessionScoped(userId, userRole, meta, s.id);
    if (decision.allowed) {
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
      });
    }
  }

  return NextResponse.json({
    code: 200,
    message: "success",
    data: { items, total: items.length },
  });
}
