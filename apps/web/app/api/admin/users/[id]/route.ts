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
// but `x-user-role` is NEVER trusted — the caller's role is always re-derived
// from the database via `getUserHighestRole`.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserHighestRole } from "@/lib/server-user";

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
 * Resolve the caller from `x-user-id`, returning { callerId, callerRole } for
 * an admin, or null (with a flag distinguishing 401 vs 403) otherwise.
 *
 * SECURITY: `x-user-id` is the only trusted header. The role is re-derived
 * from the DB so a forged `x-user-role` cannot elevate a non-admin.
 */
async function resolveAdmin(
  req: NextRequest
): Promise<
  | { ok: true; callerId: string; callerRole: "OWNER" | "ADMIN" }
  | { ok: false; status: 401 | 403 }
> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return { ok: false, status: 401 };
  const callerRole = await getUserHighestRole(callerId);
  if (callerRole !== "OWNER" && callerRole !== "ADMIN") {
    return { ok: false, status: 403 };
  }
  return { ok: true, callerId, callerRole };
}

/**
 * Role rank for outranking comparisons: OWNER(2) > ADMIN(1) > MEMBER(0).
 * A caller may only act on a target whose rank is strictly less than or equal
 * to their own, EXCEPT on destructive/disable actions where an ADMIN may not
 * touch an OWNER at all.
 */
function roleRank(role: "OWNER" | "ADMIN" | "MEMBER" | null): number {
  switch (role) {
    case "OWNER":
      return 2;
    case "ADMIN":
      return 1;
    case "MEMBER":
      return 0;
    default:
      return -1;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await resolveAdmin(req);
  if (!admin.ok) {
    return admin.status === 401 ? unauthorizedResponse() : forbiddenResponse();
  }
  const { callerId, callerRole } = admin;

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

  // Prevent self-disable/self-enable: an admin managing their own status this
  // way is a footgun (self-disable = lockout). Block it explicitly.
  if (targetId === callerId) {
    return badRequestResponse("cannot change your own status");
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, username: true },
  });
  if (!target) return notFoundResponse();

  // Authorization: an ADMIN must not disable/enable an OWNER. An OWNER can
  // act on anyone except themselves (already blocked above).
  const targetRole = await getUserHighestRole(targetId);
  if (callerRole === "ADMIN" && roleRank(targetRole) >= roleRank(callerRole)) {
    return forbiddenResponse();
  }

  const disabled = action === "disable";
  const updated = await prisma.user.update({
    where: { id: targetId },
    data: { disabled },
    select: { id: true, username: true, disabled: true },
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
  const { callerId, callerRole } = admin;

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

  // Never delete an OWNER — preserves the "at least one owner" invariant
  // without a fragile count-based check. OWNER deletion is a transfer-role-
  // first operation, not a direct delete.
  const targetRole = await getUserHighestRole(targetId);
  if (targetRole === "OWNER") {
    return forbiddenResponse();
  }
  // An ADMIN may not delete another ADMIN either (equal rank).
  if (callerRole === "ADMIN" && targetRole === "ADMIN") {
    return forbiddenResponse();
  }

  // Hard delete. TeamMember.userId has ON DELETE RESTRICT, so remove the
  // memberships first inside a transaction. No other table has an FK to User.
  await prisma.$transaction([
    prisma.teamMember.deleteMany({ where: { userId: targetId } }),
    prisma.user.delete({ where: { id: targetId } }),
  ]);

  return NextResponse.json({ id: targetId, deleted: true });
}
