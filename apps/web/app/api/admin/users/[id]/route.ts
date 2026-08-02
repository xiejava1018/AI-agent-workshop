// app/api/admin/users/[id]/route.ts
//
// T4.2 — admin user disable/enable + delete API.
//
// PATCH /api/admin/users/[id]
//   - Gated to OWNER or ADMIN (derived from DB, never trusted from headers).
//   - Body: { action: "disable" | "enable" }
//   - Sets User.disabled accordingly.
//   - 400 if action missing/invalid or if the caller tries to disable/enable
//     themselves (use a dedicated self-status path if ever needed; blocking
//     self-disable prevents an admin from locking themselves out).
//   - 403 if not admin, or if the target outranks the caller (an ADMIN cannot
//     disable an OWNER; only OWNER may act on OWNER rows).
//   - 404 if the target user does not exist.
//   - Returns: { id, username, disabled }
//
// DELETE /api/admin/users/[id]
//   - Same admin gate.
//   - Hard delete with cascade to TeamMember (the only FK relation on User is
//     TeamMember.userId, which is ON DELETE RESTRICT in the baseline — so we
//     must delete memberships first inside a transaction).
//   - 400 if the caller tries to delete themselves.
//   - 403 if not admin, or if the target is an OWNER (never allow deleting the
//     last owner; the simplest invariant is: never delete an OWNER at all).
//   - 404 if the target user does not exist.
//   - Returns: { id, deleted: true }
//
// SECURITY: `x-user-id` is trusted (set by middleware from the verified JWT),
// but `x-user-role` is NEVER trusted — the caller's identity is always re-derived
// from the database via assertPlatformAdmin (校验 platform:access 权限码)。
//
// M4 RBAC 平台中台:用户 disable/enable 收紧为 platform_admin 专属操作
// (与 /api/v1/users/[id]/disable 一致)。原先"团队 OWNER/ADMIN 可管本团队用户启停"
// 的能力由 /api/team/* 团队内成员管理接口保留;此路由是平台层面的治理动作。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertPlatformAdmin } from "@/lib/permissions";
import { auditLog } from "@/lib/audit-log";

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}

function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function badRequestResponse(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

function notFoundResponse(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

/**
 * Resolve the caller and require platform admin (校验 platform:access)。
 * SECURITY: x-user-id 是唯一可信 header,角色以 DB 为准。
 */
async function resolveAdmin(
  req: NextRequest
): Promise<{ ok: true; callerId: string } | { ok: false; status: 401 | 403 }> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return { ok: false, status: 401 };
  const admin = await assertPlatformAdmin(req);
  if (!admin) return { ok: false, status: 403 };
  return { ok: true, callerId };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await resolveAdmin(req);
  if (!admin.ok) {
    return admin.status === 401 ? unauthorizedResponse() : forbiddenResponse();
  }
  const { callerId } = admin;

  const { id: targetId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequestResponse("invalid body");
  }
  if (typeof body !== "object" || body === null) {
    return badRequestResponse("invalid body");
  }
  const { action } = body as { action?: unknown };
  if (action !== "disable" && action !== "enable") {
    return badRequestResponse("action must be 'disable' or 'enable'");
  }

  // Prevent self-disable/self-enable: a platform admin managing their own
  // status this way is a footgun (self-disable = lockout). Block it explicitly.
  if (targetId === callerId) {
    return badRequestResponse("cannot change your own status");
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, username: true },
  });
  if (!target) return notFoundResponse();

  // M4 RBAC 平台中台:platform_admin 可 disable/enable 任何用户,但不允许
  // 把自己 disable(防锁死,已在上文拦截),也不允许 disable 另一位 platform_admin
  // (避免治理层全被误禁导致无平台管理员)。enable 不限制。
  const platformAdminRole = await prisma.sysRole.findUnique({
    where: { code: "platform_admin" },
    select: { id: true },
  });
  if (action === "disable" && platformAdminRole) {
    const isTargetPlatformAdmin = await prisma.userRole.findUnique({
      where: { userId_roleId: { userId: targetId, roleId: platformAdminRole.id } },
    });
    if (isTargetPlatformAdmin) {
      return forbiddenResponse();
    }
  }

  const disabled = action === "disable";
  const updated = await prisma.user.update({
    where: { id: targetId },
    data: { disabled },
    select: { id: true, username: true, disabled: true },
  });
  void auditLog({
    userId: callerId,
    action: "user.disable",
    resourceType: "user",
    resourceId: targetId,
    metadata: { before: { disabled: !disabled }, after: { disabled } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await resolveAdmin(req);
  if (!admin.ok) {
    return admin.status === 401 ? unauthorizedResponse() : forbiddenResponse();
  }
  const { callerId } = admin;

  const { id: targetId } = await params;

  // Never let an admin delete themselves — that orphans their own session and
  // is almost always a mistake.
  if (targetId === callerId) {
    return badRequestResponse("cannot delete yourself");
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, username: true },
  });
  if (!target) return notFoundResponse();

  // M4 RBAC 平台中台:保护"最后一位 platform_admin"——不允许删
  // 持有 platform_admin 角色的用户(防治理层被自己误删导致锁死)。
  const platformAdminRole = await prisma.sysRole.findUnique({
    where: { code: "platform_admin" },
    select: { id: true },
  });
  if (platformAdminRole) {
    const isTargetPlatformAdmin = await prisma.userRole.findUnique({
      where: { userId_roleId: { userId: targetId, roleId: platformAdminRole.id } },
    });
    if (isTargetPlatformAdmin) {
      return forbiddenResponse();
    }
  }

  // Hard delete. TeamMember.userId has ON DELETE RESTRICT, so remove the
  // memberships first inside a transaction. No other table has an FK to User.
  await prisma.$transaction([
    prisma.teamMember.deleteMany({ where: { userId: targetId } }),
    prisma.user.delete({ where: { id: targetId } }),
  ]);
  void auditLog({
    userId: callerId,
    action: "user.delete",
    resourceType: "user",
    resourceId: targetId,
    metadata: { before: target },
  });

  return NextResponse.json({ id: targetId, deleted: true });
}
