/**
 * app/api/teams/[id]/projects/route.ts
 *
 * 团队项目自查/创建接口(team_owner / admin 视角)。
 *
 * GET /api/teams/[id]/projects
 *   - 鉴权:caller 必须是该团队的成员(任何角色)。
 *   - 返回 team 下的所有 projects。
 *
 * POST /api/teams/[id]/projects
 *   - 鉴权:caller 必须是该团队的 OWNER/ADMIN(canAdministerTeam)。
 *   - Body: { name, rootPath }
 *   - 创建 Project,rootPath 必须已存在于文件系统。
 *
 * 设计说明:
 *   - /api/projects 路由只能用 callerId 自己加入的第一个 OWNER/ADMIN 团队,
 *     跨团队创建无能为力。本路由显式带 teamId,适合 team_owner 管理。
 */

import { NextRequest, NextResponse } from "next/server";
import { statSync } from "fs";
import { prisma } from "@/lib/prisma";
import { allowFileRoot } from "@/lib/allowed-roots";
import { assertWithinRoot } from "@/lib/path-safety";
import { canAdministerTeam } from "@/lib/team-admin";

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
function badRequest(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
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
    select: { id: true },
  });
  if (!team) return notFound();

  // 鉴权:必须是该团队的成员(任意角色)
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: callerId } },
    select: { role: true },
  });
  if (!membership) {
    // 平台管理员 fallback:可见所有团队项目
    const isPlatformAdmin =
      (await prisma.userRole.findFirst({
        where: {
          userId: callerId,
          role: { code: "platform_admin", enabled: true },
        },
      })) !== null;
    if (!isPlatformAdmin) return forbidden();
  }

  const projects = await prisma.project.findMany({
    where: { teamId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ projects });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorized();

  const { id: teamId } = await params;

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true },
  });
  if (!team) return notFound();

  // 写操作严格:必须 OWNER/ADMIN 或平台管理员
  if (!(await canAdministerTeam(teamId, callerId))) return forbidden();

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    rootPath?: unknown;
  } | null;
  if (!body) return badRequest("invalid body");
  const { name: rawName, rootPath: rawRootPath } = body;
  if (typeof rawName !== "string" || rawName.trim().length === 0) {
    return badRequest("name required");
  }
  if (typeof rawRootPath !== "string" || rawRootPath.trim().length === 0) {
    return badRequest("rootPath required");
  }
  const name = rawName.trim();
  const rootPath = rawRootPath.trim();

  // 校验路径合法 + 存在
  try {
    assertWithinRoot(rootPath, rootPath);
  } catch {
    return badRequest("rootPath is invalid");
  }
  try {
    statSync(rootPath);
  } catch {
    return badRequest("rootPath does not exist");
  }

  // 同 team 下 rootPath 唯一(schema @@unique([teamId, rootPath]))
  const dup = await prisma.project.findUnique({
    where: { teamId_rootPath: { teamId, rootPath } },
    select: { id: true },
  });
  if (dup) return NextResponse.json({ error: "rootPath already exists in this team" }, { status: 409 });

  const project = await prisma.project.create({
    data: { name, rootPath, teamId, createdBy: callerId },
  });
  allowFileRoot(rootPath);

  return NextResponse.json({ project }, { status: 201 });
}
