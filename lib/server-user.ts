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
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Read `x-user-id` from the request header and derive the caller's role from
 * the database (via `getUserHighestRole`). Returns the admin's userId on
 * success, or null if the header is missing or the derived role is not OWNER
 * or ADMIN.
 *
 * SECURITY: This helper intentionally does NOT trust `x-user-role` on the
 * request. Even though middleware injects a DB-derived value for downstream
 * consumers, a direct route invocation can supply its own header. The only
 * source of truth for this authorization decision is the DB.
 *
 * Route handlers that need to distinguish 401 (no auth) from 403 (logged-in
 * but not admin) should branch on `x-user-id` themselves.
 */
export async function assertIsAdmin(
  req: NextRequest
): Promise<{ userId: string } | null> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return null;
  const role = await getUserHighestRole(userId);
  if (role !== "OWNER" && role !== "ADMIN") return null;
  return { userId };
}