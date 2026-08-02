/**
 * app/api/v1/users/[id]/password/route.ts
 *
 * M4 RBAC 平台中台 — 管理员给指定用户设置密码。
 *
 * 与 reset-password 路由的区别:
 *   - reset-password: 生成随机密码、mustChangePassword=true,用于"管理员自己
 *     忘记用户初始密码"或"用户丢失密码后的找回"场景。
 *   - password(本路由): 管理员在新增/编辑用户表单里直接指定明文密码,
 *     mustChangePassword=false,因为这是管理员主动分配给账号的最终密码。
 *
 * PUT /api/v1/users/[id]/password
 *   - 鉴权:user:reset-password
 *   - Body: { password: string }
 *   - 规则: password 至少 8 字符,trim 后非空;bcrypt 哈希后落库;
 *          必须携带 mustChangePassword=false,允许用户立即登录。
 *   - 返回 { id, username } —— **不返回明文密码**(明文由前端用来写入而不是。
 *     管理员已经知道明文)。
 *
 * 设计:openspec/changes/m4-rbac-platform/design.md §8(audit)
 *   - 记录 auditLog: action="user.set_password",包含操作人 + 目标用户;
 *     不写入明文密码,只记录 username。
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assertAnyPermission } from "@/lib/permissions";
import { auditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const BCRYPT_COST = 10;
const MIN_PASSWORD_LENGTH = 8;

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
  if (!(await assertAnyPermission(callerId, "user:reset-password"))) {
    return forbidden();
  }

  const { id } = await params;
  if (typeof id !== "string" || id.length === 0) return badRequest("invalid id");

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true },
  });
  if (!target) return notFound();

  const body = (await req.json().catch(() => null)) as {
    password?: unknown;
  } | null;
  if (!body || typeof body.password !== "string") {
    return badRequest("password required");
  }
  const newPassword = body.password.trim();
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return badRequest(
      `password must be at least ${MIN_PASSWORD_LENGTH} characters`
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await prisma.user.update({
    where: { id },
    data: { passwordHash, mustChangePassword: false },
  });

  void auditLog({
    userId: callerId,
    action: "user.set_password",
    resourceType: "user",
    resourceId: id,
    metadata: { username: target.username },
  });

  return NextResponse.json({
    code: 200,
    message: "success",
    data: { id: target.id, username: target.username },
  });
}
