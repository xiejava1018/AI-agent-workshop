/**
 * app/api/v1/users/[id]/route.ts
 *
 * M4 RBAC 平台中台 — 单条用户编辑+删除。
 *
 * PUT /api/v1/users/[id]
 *   - 鉴权:user:edit
 *   - Body: { username?, disabled? } —— 不允许编辑 passwordHash(走 reset-password)
 *
 * DELETE /api/v1/users/[id]
 *   - 鉴权:user:delete
 *   - 拒绝删除自己(防止锁死)
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
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return notFound();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return badRequest("body required");

  const data: Record<string, unknown> = {};
  if (typeof body.username === "string") {
    const newName = body.username.trim();
    if (!newName) return badRequest("username cannot be empty");
    if (newName !== target.username) {
      const dup = await prisma.user.findUnique({ where: { username: newName } });
      if (dup) return conflict("username exists");
    }
    data.username = newName;
  }
  if (typeof body.disabled === "boolean") {
    data.disabled = body.disabled;
  }
  if (Object.keys(data).length === 0) return badRequest("no fields to update");

  await prisma.user.update({ where: { id }, data });
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
  if (id === callerId) return badRequest("cannot delete yourself");

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return notFound();

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ code: 200, message: "success", data: { id } });
}