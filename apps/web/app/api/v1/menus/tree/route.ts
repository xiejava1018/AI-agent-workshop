/**
 * app/api/v1/menus/tree/route.ts
 *
 * M4 RBAC 平台中台 — 完整菜单树(菜单管理页用)。
 *
 * GET /api/v1/menus/tree
 *   - 鉴权:menu:view
 *   - 返回全表 SysMenu(按 parentId 自引用)组装为树形,children 嵌套。
 *   - 用途:system/menu 管理页 — 新增/编辑菜单时选父菜单;查看完整结构。
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertPlatformAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

function unauthorized(msg = "auth required"): NextResponse {
  return NextResponse.json({ error: msg }, { status: 401 });
}
function forbidden(msg = "forbidden"): NextResponse {
  return NextResponse.json({ error: msg }, { status: 403 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await assertPlatformAdmin(req);
  if (!admin) {
    const userId = req.headers.get("x-user-id");
    return userId ? forbidden() : unauthorized();
  }

  const rows = await prisma.sysMenu.findMany({
    orderBy: [{ sort: "asc" }, { name: "asc" }],
  });

  const byId = new Map<
    string,
    {
      id: string;
      parentId: string | null;
      name: string;
      title: string;
      path: string;
      component: string;
      icon: string;
      type: string;
      authMark: string;
      sort: number;
      visible: boolean;
      enabled: boolean;
      meta: string;
      children: unknown[];
    }
  >();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      parentId: r.parentId,
      name: r.name,
      title: r.title,
      path: r.path,
      component: r.component,
      icon: r.icon,
      type: r.type,
      authMark: r.authMark,
      sort: r.sort,
      visible: r.visible,
      enabled: r.enabled,
      meta: r.meta,
      children: [],
    });
  }
  const roots: typeof rows = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeById = byId as any;
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      nodeById.get(node.parentId).children.push(node);
    } else {
      roots.push(node as unknown as typeof rows[number]);
    }
  }
  roots.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  return NextResponse.json({
    code: 200,
    message: "success",
    data: roots,
  });
}