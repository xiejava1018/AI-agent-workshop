/**
 * lib/platform-keys.ts
 *
 * Task 4.4 — helpers for the platform API-key pool (PlatformApiKey table).
 *
 * The pool holds one AES-256-GCM–encrypted key per provider, used as the
 * fallback credential source when a user has no BYOK key. These helpers
 * centralise the OWNER-only authorization gate and the "status without key
 * material" projection so every route in the models admin surface behaves
 * identically and can never accidentally leak `secretEnc`.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserHighestRole } from "@/lib/user-role";

export type PlatformKeyStatus = {
  provider: string;
  hasKey: true;
  updatedAt: string;
};

/**
 * Write access gate for platform key mutations: platform admin (OWNER) only.
 *
 * SECURITY: role is derived from the DB; the `x-user-role` header is never
 * trusted. Returns `{ ok: true, userId }` for OWNER, `{ ok: false, authed:
 * true }` for authenticated-but-not-owner (→ 403), and `{ ok: false, authed:
 * false }` when no auth header is present (→ 401).
 */
export async function ownerGate(
  req: NextRequest,
): Promise<{ ok: true; userId: string } | { ok: false; authed: boolean }> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return { ok: false, authed: false };
  const role = await getUserHighestRole(userId);
  if (role !== "OWNER") return { ok: false, authed: true };
  return { ok: true, userId };
}

/**
 * List the platform key pool status: providers that have a stored key with
 * their last-updated timestamp. `secretEnc` is NEVER selected so key material
 * cannot leak into a response.
 */
export async function loadPlatformKeyStatus(): Promise<PlatformKeyStatus[]> {
  const rows = await prisma.platformApiKey.findMany({
    select: { provider: true, updatedAt: true },
    orderBy: { provider: "asc" },
  });
  return rows.map((r) => ({
    provider: r.provider,
    hasKey: true as const,
    updatedAt: r.updatedAt.toISOString(),
  }));
}
