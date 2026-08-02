/**
 * app/api/v1/users/[id]/roles/route.ts
 *
 * M4 RBAC 平台中台 — 设置用户的全局角色(差量替换)。
 *
 * PUT /api/v1/users/[id]/roles
 *   - 鉴权:user:assign-role
 *   - Body: { roleCodes: string[] }
 *   - 行为:差量替换(删旧 UserRole + 创建新),原子事务。
 *   - 注意:这是全局角色(RBAC),与 TeamMember(团队成员)正交,互不影响。
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

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorized();
  if (!(await assertAnyPermission(callerId, "user:assign-role"))) return forbidden();

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return notFound();

  const body = (await req.json().catch(() => null)) as {
    roleCodes?: unknown;
  } | null;
  if (!body || !Array.isArray(body.roleCodes)) {
    return badRequest("roleCodes[] required");
  }
  const codes = body.roleCodes.filter(
    (c): c is string => typeof c === "string"
  );

  let roleIds: string[] = [];
  if (codes.length > 0) {
    const roles = await prisma.sysRole.findMany({
      where: { code: { in: codes } },
      select: { id: true },
    });
    if (roles.length !== new Set(codes).size) {
      return badRequest("unknown role code(s)");
    }
    roleIds = roles.map((r) => r.id);
  }

  const beforeRoles = await prisma.userRole.findMany({
    where: { userId: id },
    select: { role: { select: { code: true } } },
  });
  const beforeCodes = beforeRoles.map((row) => row.role.code);

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: id } }),
    ...(roleIds.length > 0
      ? [
          prisma.userRole.createMany({
            data: roleIds.map((rid) => ({ userId: id, roleId: rid })),
          }),
        ]
      : []),
  ]);

  void auditLog({
    userId: callerId,
    action: "user.assign_role",
    resourceType: "user",
    resourceId: id,
    metadata: { before: { roleCodes: beforeCodes }, after: { roleCodes: codes } },
  });

  return NextResponse.json({ code: 200, message: "success", data: { id, roleCodes: codes } });
}