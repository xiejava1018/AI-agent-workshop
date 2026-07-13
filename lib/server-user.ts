import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { getUserHighestRole } from "./user-role";

// Re-export the M1 helper so M2.2 consumers can import from one place.
// Single source of truth lives in lib/user-role.ts.
export { getUserHighestRole };

export type UserContext = {
  user: { id: string; username: string; mustChangePassword: boolean };
  role: "OWNER" | "ADMIN" | "MEMBER" | null;
  teamIds: string[];
  mustChangePassword: boolean;
};

export async function getUserTeamIds(userId: string): Promise<string[]> {
  const tms = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true },
  });
  return tms.map(t => t.teamId);
}

export async function getCurrentUserContext(
  userId: string
): Promise<UserContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, mustChangePassword: true },
  });
  if (!user) return null;

  const [role, teamIds] = await Promise.all([
    getUserHighestRole(userId),
    getUserTeamIds(userId),
  ]);

  return { user, role, teamIds, mustChangePassword: user.mustChangePassword };
}

/**
 * Pure helper — true if the role string is OWNER or ADMIN.
 * Used by routes that gate on role without needing DB context, e.g. when the
 * request only carries `x-user-role` and we want to fail fast before reading
 * the DB. Caller-side `assertIsAdmin` performs the same check but also
 * inspects the request headers.
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Read `x-user-id` and `x-user-role` from the request headers and verify the
 * caller is an OWNER or ADMIN. Returns the admin's userId on success, or null
 * if either header is missing or the role is not admin.
 *
 * Routes that need to allow non-admin callers (or surface 401 vs 403
 * distinctly) should NOT use this — they should branch on the headers
 * themselves. The admin API surface always returns 403 for both "missing
 * header" and "wrong role" — that is intentionally the same shape so a probe
 * cannot distinguish "not logged in" from "not admin".
 */
export function assertIsAdmin(
  req: NextRequest
): { userId: string } | null {
  const userId = req.headers.get("x-user-id");
  const role = req.headers.get("x-user-role");
  if (!userId) return null;
  if (!isAdminRole(role)) return null;
  return { userId };
}