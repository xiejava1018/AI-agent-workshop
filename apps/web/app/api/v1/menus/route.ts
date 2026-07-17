/**
 * app/api/v1/menus/route.ts
 *
 * M4 RBAC 平台中台 — 菜单 CRUD(POST 创建)。
 *
 * POST /api/v1/menus
 *   - 鉴权:menu:create
 *   - Body: { name, title, parentId?, path?, component?, icon?, type?, sort?,
 *            visible?, enabled?, meta?: { permissions: string[] } }
 *   - 行为:创建 SysMenu(全表 JSON 存 meta);parentId 可选(顶层菜单为 null)。
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
function badRequest(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}
function notFound(msg = "not found"): NextResponse {
  return NextResponse.json({ error: msg }, { status: 404 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorized();
  if (!(await assertAnyPermission(callerId, "menu:create"))) return forbidden();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.name !== "string" || typeof body.title !== "string") {
    return badRequest("name & title required");
  }

  if (body.parentId) {
    const parent = await prisma.sysMenu.findUnique({ where: { id: body.parentId as string } });
    if (!parent) return notFound("parent menu not found");
  }

  // meta 必须是含 permissions[] 的对象(也可为空)
  const meta: Record<string, unknown> =
    typeof body.meta === "object" && body.meta !== null
      ? (body.meta as Record<string, unknown>)
      : { permissions: [] };
  if (!Array.isArray(meta.permissions)) meta.permissions = [];

  // 验 permissions 全部存在
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

  const dup = await prisma.sysMenu.findFirst({
    where: {
      parentId: (body.parentId as string | null) ?? null,
      name: body.name as string,
    },
  });
  if (dup) return badRequest(`menu name '${body.name}' already exists at this level`);

  const created = await prisma.sysMenu.create({
    data: {
      name: body.name as string,
      title: body.title as string,
      parentId: (body.parentId as string | null) ?? null,
      path: (body.path as string) ?? "",
      component: (body.component as string) ?? "",
      icon: (body.icon as string) ?? "",
      type: (body.type as string) ?? "menu",
      authMark: (body.authMark as string) ?? "",
      sort: typeof body.sort === "number" ? body.sort : 0,
      visible: typeof body.visible === "boolean" ? body.visible : true,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      meta: JSON.stringify(meta),
    },
    select: { id: true, name: true },
  });

  return NextResponse.json({
    code: 200,
    message: "success",
    data: created,
  });
}