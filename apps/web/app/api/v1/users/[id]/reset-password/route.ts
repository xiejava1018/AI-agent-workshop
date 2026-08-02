/**
 * app/api/v1/users/[id]/reset-password/route.ts
 *
 * M4 RBAC 平台中台 — 重置用户密码(管理员用)。
 *
 * PUT /api/v1/users/[id]/reset-password
 *   - 鉴权:user:reset-password
 *   - 行为:生成 22 字符 base64url 随机密码,bcrypt 哈希,设置 mustChangePassword=true。
 *   - 返回 { initialPassword } —— 明文密码仅返回一次。
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assertAnyPermission } from "@/lib/permissions";
import { auditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const BCRYPT_COST = 10;
const PASSWORD_BYTES = 16;

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}
function forbidden(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}
function notFound(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

function generateInitialPassword(): string {
  return randomBytes(PASSWORD_BYTES).toString("base64url");
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorized();
  if (!(await assertAnyPermission(callerId, "user:reset-password"))) {
    return forbidden();
  }

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return notFound();

  const initialPassword = generateInitialPassword();
  const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_COST);

  await prisma.user.update({
    where: { id },
    data: { passwordHash, mustChangePassword: true },
  });
  void auditLog({
    userId: callerId,
    action: "user.reset_password",
    resourceType: "user",
    resourceId: id,
    metadata: { username: target.username },
  });

  return NextResponse.json({
    code: 200,
    message: "success",
    data: { id, initialPassword },
  });
}