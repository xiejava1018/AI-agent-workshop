/**
 * app/api/v1/menus/role/[roleId]/route.ts
 *
 * M4 RBAC 平台中台 — 角色绑定的权限码集合(菜单管理页的核心交互)。
 *
 * GET /api/v1/menus/role/[roleId]
 *   - 鉴权:role:view
 *   - 返回该角色当前绑定的全部权限码(code 列表)。
 *
 * PUT /api/v1/menus/role/[roleId]
 *   - 鉴权:role:assign-permission
 *   - Body: { permissionCodes: string[] }
 *   - 行为:差量更新 RolePermission 表(删旧增新,原子事务)。
 *   - 注意:**不直接绑菜单**,只是把"勾选菜单"的 UI 行为翻译为"勾选权限码"。
 *     菜单可见性仍由 `meta.permissions ∩ user.permissions` 决定。
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertAnyPermission } from "@/lib/permissions";

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
  { params }: { params: Promise<{ roleId: string }> }
): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return unauthorized();

  if (!(await assertAnyPermission(userId, "role:view", "role:assign-permission"))) {
    return forbidden();
  }

  const { roleId } = await params;
  const role = await prisma.sysRole.findUnique({ where: { id: roleId } });
  if (!role) return notFound();

  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { code: true } } },
  });
  const codes = rows.map((r) => r.permission.code);

  return NextResponse.json({
    code: 200,
    message: "success",
    data: { permissionCodes: codes },
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return unauthorized();
  if (!(await assertAnyPermission(userId, "role:assign-permission"))) {
    return forbidden();
  }

  const { roleId } = await params;
  const role = await prisma.sysRole.findUnique({ where: { id: roleId } });
  if (!role) return notFound();

  const body = (await req.json().catch(() => null)) as {
    permissionCodes?: unknown;
  } | null;
  if (!body || !Array.isArray(body.permissionCodes)) {
    return badRequest("permissionCodes[] required");
  }
  const codes = body.permissionCodes.filter(
    (c): c is string => typeof c === "string"
  );
  // 验所有 code 存在(防错字/越权)
  if (codes.length > 0) {
    const found = await prisma.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    if (found.length !== new Set(codes).size) {
      return badRequest("unknown permission code(s)");
    }
    // 原子事务:删旧 + 增新
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      prisma.rolePermission.createMany({
        data: found.map((p) => ({ roleId, permissionId: p.id })),
      }),
    ]);
  } else {
    await prisma.rolePermission.deleteMany({ where: { roleId } });
  }

  return NextResponse.json({
    code: 200,
    message: "success",
    data: { permissionCodes: codes },
  });
}