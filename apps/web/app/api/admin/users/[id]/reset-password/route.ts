// app/api/admin/users/[id]/reset-password/route.ts
//
// M4 RBAC 平台中台 — admin password reset API(平台管理员专属)。
//
// POST /api/admin/users/[id]/reset-password
//   - 鉴权:platform:access via assertPlatformAdmin(校验权限码,以 DB 为准)。
//   - No body required.
//   - Generates a new random password (16 bytes, base64url), bcrypt-hashes it
//     (cost 10), and sets mustChangePassword=true so the user is forced to
//     pick their own on next login.
//   - Returns: { initialPassword } — the plaintext is returned EXACTLY ONCE
//     and is never persisted in cleartext (only the bcrypt hash is stored).
//   - 400 if the caller tries to reset their own password this way (use the
//     change-password flow for self; admin-reset on self is a footgun).
//   - 403 if not platform admin.
//   - 404 if the target user does not exist.
//
// SECURITY: `x-user-id` is trusted (set by middleware from the verified JWT),
// but `x-user-role` is NEVER trusted — assertPlatformAdmin 校验 platform:access。

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assertPlatformAdmin } from "@/lib/permissions";

const BCRYPT_COST = 10;
const PASSWORD_BYTES = 16; // 16 random bytes → 22-char base64url string

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

function generateRandomPassword(): string {
  // base64url → URL-safe, no padding. 16 bytes yields 22 characters.
  return randomBytes(PASSWORD_BYTES).toString("base64url");
}

async function resolveAdmin(
  req: NextRequest
): Promise<{ ok: true; callerId: string } | { ok: false; status: 401 | 403 }> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return { ok: false, status: 401 };
  const admin = await assertPlatformAdmin(req);
  if (!admin) return { ok: false, status: 403 };
  return { ok: true, callerId };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await resolveAdmin(req);
  if (!admin.ok) {
    return admin.status === 401 ? unauthorizedResponse() : forbiddenResponse();
  }
  const { callerId } = admin;

  const { id: targetId } = await params;

  // Prevent self-reset: admins should use the dedicated change-password flow
  // (which requires the current password) rather than this admin-only reset.
  if (targetId === callerId) {
    return badRequestResponse("cannot reset your own password here");
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, username: true },
  });
  if (!target) return notFoundResponse();

  const initialPassword = generateRandomPassword();
  const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_COST);

  await prisma.user.update({
    where: { id: targetId },
    data: { passwordHash, mustChangePassword: true },
  });

  return NextResponse.json({ initialPassword });
}
