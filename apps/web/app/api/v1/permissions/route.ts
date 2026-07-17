/**
 * app/api/v1/permissions/route.ts
 *
 * M4 RBAC 平台中台 — 权限码列表(只读,已登录即可)。
 *
 * GET /api/v1/permissions
 *   - 返回全表 Permission,按 (module, sort) 排序。
 *   - 用途:system/menu 页面编辑 meta.permissions 多选;system/role 页面分配权限码。
 *   - 不要求特殊权限码 — 任何登录用户都可读权限码清单(只是只读)。
 *   - 注意:这与 spec §5 Requirement "/api/v1/* RBAC CRUD 路由" 表格对齐;
 *     鉴权是已登录,菜单管理/角色管理页面需各自 `menu:view`/`role:view` 才能进。
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return unauthorizedResponse();

  const rows = await prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { sort: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, module: true, description: true },
  });

  return NextResponse.json({
    code: 200,
    message: "success",
    data: rows,
  });
}