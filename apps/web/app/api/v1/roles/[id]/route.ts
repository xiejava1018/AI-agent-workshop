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
import { auditLog } from "@/lib/audit-log";

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
  // 修复点：SysRole.id 是 cuid 字符串(Prisma @id @default(cuid()))。
  // 前端页面 value-key 是字符串。若前端误传 number/NaN 会进函数但 prisma
  // findUnique 会 500 —— 提前拦截格式错误,避免误导为"角色不存在 (404)"。
  if (typeof id !== "string" || id.length === 0) return badRequest("invalid id");

  const role = await prisma.sysRole.findUnique({ where: { id } });
  if (!role) return notFound();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return badRequest("body required");

  // 字段白名单
  const data: Record<string, unknown> = {};
  for (const k of ["name", "desc", "enabled", "sort"] as const) {
    if (k in body) data[k] = body[k];
  }
  // enabled 必须是 boolean,否则可能被静默写入字符串"true"在某些客户端。
  if ("enabled" in data && typeof data.enabled !== "boolean") {
    return badRequest("enabled must be boolean");
  }
  // sort 必须是 number
  if ("sort" in data && typeof data.sort !== "number") {
    return badRequest("sort must be number");
  }
  // 防御性:不能通过此接口修改 code(code 一旦创建不可变更,避免破坏 RolePermission 等)。
  if ("code" in body) {
    return badRequest("code is immutable; create a new role instead");
  }
  if (Object.keys(data).length === 0) return badRequest("no fields to update");

  const updated = await prisma.sysRole.update({ where: { id }, data });
  void auditLog({
    userId,
    action: "role.update",
    resourceType: "role",
    resourceId: id,
    metadata: { before: role, after: updated },
  });

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
  if (typeof id !== "string" || id.length === 0) return badRequest("invalid id");
  const role = await prisma.sysRole.findUnique({ where: { id } });
  if (!role) return notFound();
  if (PROTECTED_ROLES.has(role.code)) {
    return badRequest(`cannot delete built-in role '${role.code}'`);
  }

  await prisma.sysRole.delete({ where: { id } });
  void auditLog({
    userId,
    action: "role.delete",
    resourceType: "role",
    resourceId: id,
    metadata: { before: role },
  });
  return NextResponse.json({ code: 200, message: "success", data: { id } });
}