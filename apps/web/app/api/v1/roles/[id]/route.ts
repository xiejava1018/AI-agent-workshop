/**
 * app/api/v1/roles/[id]/route.ts
 *
 * M4 RBAC 平台中台 — 角色单条更新+删除。
 *
 * PUT /api/v1/roles/[id]
 *   - 鉴权:role:edit
 *   - Body: { name?, desc?, enabled?, sort? }
 *
 * DELETE /api/v1/roles/[id]
 *   - 鉴权:role:delete
 *   - 拒绝删除三个预置全局角色(platform_admin/team_owner/member)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const PROTECTED_ROLES = new Set(["platform_admin", "team_owner", "member"]);

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

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return unauthorized();
  if (!(await assertAnyPermission(userId, "role:edit"))) return forbidden();

  const { id } = await params;
  const role = await prisma.sysRole.findUnique({ where: { id } });
  if (!role) return notFound();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return badRequest("body required");

  // 字段白名单
  const data: Record<string, unknown> = {};
  for (const k of ["name", "desc", "enabled", "sort"] as const) {
    if (k in body) data[k] = body[k];
  }
  await prisma.sysRole.update({ where: { id }, data });

  return NextResponse.json({ code: 200, message: "success", data: { id } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return unauthorized();
  if (!(await assertAnyPermission(userId, "role:delete"))) return forbidden();

  const { id } = await params;
  const role = await prisma.sysRole.findUnique({ where: { id } });
  if (!role) return notFound();
  if (PROTECTED_ROLES.has(role.code)) {
    return badRequest(`cannot delete built-in role '${role.code}'`);
  }

  await prisma.sysRole.delete({ where: { id } });
  return NextResponse.json({ code: 200, message: "success", data: { id } });
}