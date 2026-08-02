/**
 * app/api/v1/menus/[id]/route.ts
 *
 * M4 RBAC 平台中台 — 单条菜单更新+删除。
 *
 * PUT /api/v1/menus/[id]
 *   - 鉴权:menu:edit
 *   - Body 字段(白名单):title / parentId / path / component / icon / type /
 *     authMark / sort / visible / enabled / meta
 *   - 防呆:不允许把菜单的 parentId 设为自身或自身的后代(避免成环)。
 *
 * DELETE /api/v1/menus/[id]
 *   - 鉴权:menu:delete
 *   - 行为:有子菜单时一并级联删除(由 onDelete: SetNull 改为级联需另行;这里显式拒绝)。
 *     这里采用"拒绝有子菜单的删除"——更安全。
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertAnyPermission } from "@/lib/permissions";
import { auditLog } from "@/lib/audit-log";

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

const EDITABLE_FIELDS = [
  "title",
  "parentId",
  "path",
  "component",
  "icon",
  "type",
  "authMark",
  "sort",
  "visible",
  "enabled",
] as const;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorized();
  if (!(await assertAnyPermission(callerId, "menu:edit"))) return forbidden();

  const { id } = await params;
  const menu = await prisma.sysMenu.findUnique({ where: { id } });
  if (!menu) return notFound();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return badRequest("body required");

  const data: Record<string, unknown> = {};
  for (const k of EDITABLE_FIELDS) {
    if (k in body) data[k] = body[k];
  }

  // 防成环:parentId 必须是 null 或另一条菜单,且不能是自身或自身后代
  if ("parentId" in data) {
    const newParent = (data.parentId as string | null) ?? null;
    if (newParent === id) return badRequest("parentId cannot be self");
    if (newParent) {
      const exists = await prisma.sysMenu.findUnique({ where: { id: newParent } });
      if (!exists) return badRequest("parentId menu not found");
      // 简单防后代:递归向上查新Parent的所有祖先,若含 id 则成环
      let cur: string | null = newParent;
      const ancestors = new Set<string>();
      while (cur && !ancestors.has(cur)) {
        ancestors.add(cur);
        const p: { parentId: string | null } | null = await prisma.sysMenu.findUnique({
          where: { id: cur },
          select: { parentId: true },
        });
        cur = p?.parentId ?? null;
      }
      if (ancestors.has(id)) {
        return badRequest("parentId would create a cycle");
      }
    }
  }

  if ("meta" in body) {
    const meta =
      typeof body.meta === "object" && body.meta !== null
        ? (body.meta as Record<string, unknown>)
        : { permissions: [] };
    if (!Array.isArray(meta.permissions)) meta.permissions = [];
    const permCodes = meta.permissions as string[];
    if (permCodes.length > 0) {
      const found = await prisma.permission.findMany({
        where: { code: { in: permCodes } },
        select: { code: true },
      });
      if (found.length !== new Set(permCodes).size) {
        return badRequest("unknown permission code(s) in meta.permissions");
      }
    }
    data.meta = JSON.stringify(meta);
  }

  if (Object.keys(data).length === 0) return badRequest("no fields to update");

  const updated = await prisma.sysMenu.update({ where: { id }, data });
  void auditLog({
    userId: callerId,
    action: "menu.update",
    resourceType: "menu",
    resourceId: id,
    metadata: { before: menu, after: updated },
  });
  return NextResponse.json({ code: 200, message: "success", data: { id } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorized();
  if (!(await assertAnyPermission(callerId, "menu:delete"))) return forbidden();

  const { id } = await params;
  const menu = await prisma.sysMenu.findUnique({ where: { id } });
  if (!menu) return notFound();

  const childCount = await prisma.sysMenu.count({ where: { parentId: id } });
  if (childCount > 0) {
    return badRequest(
      `cannot delete: menu has ${childCount} child menu(s); remove children first`
    );
  }

  await prisma.sysMenu.delete({ where: { id } });
  void auditLog({
    userId: callerId,
    action: "menu.delete",
    resourceType: "menu",
    resourceId: id,
    metadata: { before: menu },
  });
  return NextResponse.json({ code: 200, message: "success", data: { id } });
}