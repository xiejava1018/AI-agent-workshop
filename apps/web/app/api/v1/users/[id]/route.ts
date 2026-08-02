/**
 * app/api/v1/users/[id]/route.ts
 *
 * M4 RBAC 平台中台 — 单条用户编辑+删除。
 *
 * PUT /api/v1/users/[id]
 *   - 鉴权:user:edit
 *   - Body: { username?, email?, full_name?, phone?, gender?, disabled? }
 *     —— username 修改需查重;email 修改需查重;其他字段 nullable。
 *     password 走 reset-password 独立路由。
 *
 * DELETE /api/v1/users/[id]
 *   - 鉴权:user:delete
 *   - 拒绝删除自己(防止锁死)
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
function conflict(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 409 });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return unauthorized();
  if (!(await assertAnyPermission(userId, "user:edit"))) return forbidden();

  const { id } = await params;
  // 修复点:User.id 是 cuid 字符串(由 Prisma @id @default(cuid()) 生成),
  // 前端页面 value-key 也是字符串。此前路由未显式校验格式,即便前端误传
  // number/NaN 也能进函数,但 prisma.findUnique 在 id 类型不匹配时会抛
  // 500 —— 提前校验字符串避免把"格式错误"误导为"用户不存在 (404)"。
  if (typeof id !== "string" || id.length === 0) return badRequest("invalid id");

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return notFound();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return badRequest("body required");

  const data: Record<string, unknown> = {};
  // username
  if (typeof body.username === "string") {
    const newName = body.username.trim();
    if (!newName) return badRequest("username cannot be empty");
    if (newName !== target.username) {
      const dup = await prisma.user.findUnique({ where: { username: newName } });
      if (dup) return conflict("username exists");
    }
    data.username = newName;
  }
  // email —— NULL/空串都允许(清空邮箱)
  if (body.email !== undefined) {
    if (body.email === null || body.email === "") {
      data.email = null;
    } else if (typeof body.email === "string") {
      const newEmail = body.email.trim();
      if (newEmail !== (target.email ?? "")) {
        const dup = await prisma.user.findUnique({ where: { email: newEmail } });
        if (dup) return conflict("email exists");
      }
      data.email = newEmail;
    } else {
      return badRequest("email must be string or null");
    }
  }
  // full_name
  if (body.full_name !== undefined) {
    if (body.full_name === null) data.full_name = null;
    else if (typeof body.full_name === "string") {
      data.full_name = body.full_name.trim() || null;
    } else {
      return badRequest("full_name must be string or null");
    }
  }
  // phone
  if (body.phone !== undefined) {
    if (body.phone === null) data.phone = null;
    else if (typeof body.phone === "string") {
      data.phone = body.phone.trim() || null;
    } else {
      return badRequest("phone must be string or null");
    }
  }
  // gender —— 仅接受 1/2,NULL 表示清空
  if (body.gender !== undefined) {
    if (body.gender === null) {
      data.gender = null;
    } else if (body.gender === 1 || body.gender === 2) {
      // 与已有值相同时也不写入,避免空更新
      if (target.gender !== body.gender) data.gender = body.gender;
    } else {
      return badRequest("gender must be 1, 2 or null");
    }
  }
  // disabled
  if (typeof body.disabled === "boolean") {
    if (target.disabled !== body.disabled) data.disabled = body.disabled;
  }
  if (Object.keys(data).length === 0) return badRequest("no fields to update");

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      full_name: true,
      phone: true,
      gender: true,
      disabled: true,
    },
  });
  void auditLog({
    userId,
    action: "user.update",
    resourceType: "user",
    resourceId: id,
    metadata: {
      before: {
        username: target.username,
        email: target.email,
        full_name: target.full_name,
        phone: target.phone,
        gender: target.gender,
        disabled: target.disabled,
      },
      after: {
        username: updated.username,
        email: updated.email,
        full_name: updated.full_name,
        phone: updated.phone,
        gender: updated.gender,
        disabled: updated.disabled,
      },
    },
  });
  return NextResponse.json({ code: 200, message: "success", data: { id } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorized();
  if (!(await assertAnyPermission(callerId, "user:delete"))) return forbidden();

  const { id } = await params;
  if (typeof id !== "string" || id.length === 0) return badRequest("invalid id");
  if (id === callerId) return badRequest("cannot delete yourself");

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return notFound();

  await prisma.user.delete({ where: { id } });
  void auditLog({
    userId: callerId,
    action: "user.delete",
    resourceType: "user",
    resourceId: id,
    metadata: { before: target },
  });
  return NextResponse.json({ code: 200, message: "success", data: { id } });
}