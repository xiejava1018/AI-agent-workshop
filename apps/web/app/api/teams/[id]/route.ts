/**
 * app/api/teams/[id]/route.ts
 *
 * 团队自查接口(team_owner / admin 视角,对应 platform_admin 的
 * /api/admin/teams/[id])。
 *
 * GET /api/teams/[id]
 *   - 鉴权:caller 必须是该团队的成员(任何角色)。
 *   - 返回 team 详情含成员列表,字段同 /api/admin/teams/[id]。
 *
 * 设计说明:
 *   - GET /api/admin/teams/[id] 严格要求 platform:access(platform_admin),
 *     team_owner 看不到自己团队的成员明细。
 *   - 本路由放宽为"团队任一成员可见",满足 team_owner/admin 在团队管理
 *     页查看成员、改角色、删成员的需求(写操作仍走 /api/admin/teams/[id]/...
 *     因为 canAdministerTeam 校验同 team_owner/admin 也通过)。
 *   - 写操作(POST member / PUT role / DELETE member)复用 /api/admin/teams/
 *     [id]/members 路由,本路由只解决"team_owner 看到自己团队"这一缺口。
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}
function forbidden(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}
function notFound(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorized();

  const { id: teamId } = await params;

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      members: {
        include: { user: { select: { id: true, username: true, disabled: true } } },
        orderBy: { joinedAt: "asc" },
      },
    },
  });
  if (!team) return notFound();

  // 鉴权:caller 必须是该团队的成员(任意角色)。
  // 与 canAdministerTeam 不同,这里允许 MEMBER 也能看(查看自己团队而已)。
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: callerId } },
    select: { role: true },
  });
  // 平台管理员可看所有团队(便于在多个团队间做对比)
  const isPlatformAdmin =
    (await prisma.userRole.findFirst({
      where: {
        userId: callerId,
        role: { code: "platform_admin", enabled: true },
      },
    })) !== null;
  if (!membership && !isPlatformAdmin) return forbidden();

  const members = team.members.map((m) => ({
    userId: m.userId,
    username: m.user.username,
    disabled: m.user.disabled,
    role: m.role,
    joinedAt: m.joinedAt,
    isOwner: m.userId === team.ownerUserId,
  }));

  return NextResponse.json({
    team: {
      id: team.id,
      name: team.name,
      ownerUserId: team.ownerUserId,
      tokenDailyLimit: team.tokenDailyLimit,
      maxConcurrentSessions: team.maxConcurrentSessions,
      createdAt: team.createdAt,
      members,
    },
  });
}
