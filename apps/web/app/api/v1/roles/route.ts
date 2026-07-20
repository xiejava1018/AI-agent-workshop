/**
 * app/api/v1/roles/route.ts
 *
 * M4 RBAC 平台中台 — 角色 CRUD 列表+创建。
 *
 * GET /api/v1/roles
 *   - 鉴权:role:view
 *   - Query: page, pageSize, name(模糊), enabled(过滤)
 *   - 返回 { records, total, page, pageSize }
 *
 * POST /api/v1/roles
 *   - 鉴权:role:create
 *   - Body: { code, name, desc?, enabled?, sort?, permissionCodes?: string[] }
 *   - 创建 SysRole + 绑定 RolePermission(若提供 permissionCodes)
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
function badRequest(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}
function conflict(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 409 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return unauthorized();
  if (!(await assertAnyPermission(userId, "role:view"))) return forbidden();

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(sp.get("pageSize") ?? "10", 10) || 10)
  );
  const name = sp.get("name") ?? "";
  const enabledParam = sp.get("enabled");

  const where: Record<string, unknown> = {};
  if (name) where.name = { contains: name };
  if (enabledParam !== null) {
    where.enabled = enabledParam === "true" || enabledParam === "1";
  }

  const [total, records] = await Promise.all([
    prisma.sysRole.count({ where }),
    prisma.sysRole.findMany({
      where,
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    code: 200,
    message: "success",
    data: { records, total, page, pageSize },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return unauthorized();
  if (!(await assertAnyPermission(userId, "role:create"))) return forbidden();

  const body = (await req.json().catch(() => null)) as {
    code?: string;
    name?: string;
    desc?: string;
    enabled?: boolean;
    sort?: number;
    permissionCodes?: string[];
  } | null;
  if (!body || !body.code || !body.name) {
    return badRequest("code & name required");
  }

  const exists = await prisma.sysRole.findUnique({ where: { code: body.code } });
  if (exists) return conflict(`role code '${body.code}' already exists`);

  // 验 permissionCodes
  let permissionIds: string[] = [];
  if (Array.isArray(body.permissionCodes) && body.permissionCodes.length > 0) {
    const perms = await prisma.permission.findMany({
      where: { code: { in: body.permissionCodes } },
      select: { id: true },
    });
    if (perms.length !== new Set(body.permissionCodes).size) {
      return badRequest("unknown permission code(s)");
    }
    permissionIds = perms.map((p) => p.id);
  }

  const role = await prisma.sysRole.create({
    data: {
      code: body.code,
      name: body.name,
      desc: body.desc ?? "",
      enabled: body.enabled ?? true,
      sort: body.sort ?? 0,
    },
  });
  if (permissionIds.length > 0) {
    await prisma.rolePermission.createMany({
      data: permissionIds.map((pid) => ({ roleId: role.id, permissionId: pid })),
    });
  }

  void auditLog({
    userId,
    action: "role.create",
    resourceType: "role",
    resourceId: role.id,
    metadata: {
      after: {
        code: role.code,
        name: role.name,
        desc: role.desc,
        enabled: role.enabled,
        sort: role.sort,
        permissionCodes: body.permissionCodes ?? [],
      },
    },
  });

  return NextResponse.json({
    code: 200,
    message: "success",
    data: { id: role.id, code: role.code },
  });
}