/**
 * app/api/v1/users/[id]/disable/route.ts
 *
 * M4 RBAC 平台中台 — 启用/停用用户(切换 disabled 标志)。
 *
 * PUT /api/v1/users/[id]/disable
 *   - 鉴权:user:disable
 *   - Body: { disabled: boolean }
 *   - 行为:把 user.disabled 设为指定值。
 *   - 拒绝停用自己(防止锁死)。
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
  if (!(await assertAnyPermission(callerId, "user:disable"))) return forbidden();

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return notFound();

  const body = (await req.json().catch(() => null)) as {
    disabled?: unknown;
  } | null;
  if (!body || typeof body.disabled !== "boolean") {
    return badRequest("disabled:boolean required");
  }
  if (id === callerId && body.disabled === true) {
    return badRequest("cannot disable yourself");
  }

  await prisma.user.update({
    where: { id },
    data: { disabled: body.disabled },
  });
  void auditLog({
    userId: callerId,
    action: "user.disable",
    resourceType: "user",
    resourceId: id,
    metadata: { before: { disabled: target.disabled }, after: { disabled: body.disabled } },
  });
  return NextResponse.json({
    code: 200,
    message: "success",
    data: { id, disabled: body.disabled },
  });
}