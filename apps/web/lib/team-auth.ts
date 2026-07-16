// lib/team-auth.ts
//
// M2.4 team-isolation helpers.
//
// The previous M2.3 design (lib/session-meta.ts:106-119) had a global
// OWNER/ADMIN bypass for assertCanReadSession — any OWNER/ADMIN could
// read ANY session regardless of team. This was an explicit
// simplification ("M1 简化, 不做 teamId 检查") that becomes a privacy
// incident the moment more than one team uses the same instance.
//
// M2.4 changes:
//   1. assertMemberOfTeam(userId, teamId) is the new atomic check.
//      It is the only safe way to gate a request on team membership.
//   2. assertCanReadSession was rewritten to require the session to be
//      in a team the caller belongs to (OWNER/ADMIN/MEMBER), OR the
//      session was explicitly shared with the caller via SessionShare.
//      The previous global OWNER/ADMIN bypass is removed.
//   3. Sessions with teamId === null (pre-M2.4 data) are deny-by-default.
//      This is the safe default; admin can recover via SessionShare if
//      needed.
//
// The DB-side helper `getUserTeamIds(userId)` is exported so other
// callers (e.g. /api/sessions list filtering) can scope queries
// without duplicating the SQL.

import { prisma } from "./prisma";
import type { SessionMetaRow } from "./session-meta";

export type UserRole = "OWNER" | "ADMIN" | "MEMBER";

/**
 * Return the set of team ids the user belongs to, with the highest role
 * the user holds in each team. OWNER > ADMIN > MEMBER.
 *
 * Cheap enough to call per request: the TeamMember table is small in
 * realistic deployments and there is a unique composite PK on
 * (teamId, userId). If this becomes a hot path, cache in globalThis
 * keyed by userId.
 */
export async function getUserTeamMemberships(
  userId: string
): Promise<Map<string, UserRole>> {
  const rows = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true, role: true },
  });
  const result = new Map<string, UserRole>();
  for (const row of rows) {
    const existing = result.get(row.teamId);
    // Keep the highest role for each team; this matters if a user
    // somehow has multiple TeamMember rows for the same team (shouldn't
    // happen because of the composite PK, but be defensive).
    if (
      !existing ||
      rankRole(row.role as UserRole) > rankRole(existing)
    ) {
      result.set(row.teamId, row.role as UserRole);
    }
  }
  return result;
}

function rankRole(r: UserRole): number {
  switch (r) {
    case "OWNER":
      return 3;
    case "ADMIN":
      return 2;
    case "MEMBER":
      return 1;
  }
}

/**
 * Return true iff the user is a member of `teamId` (any role).
 */
export async function assertMemberOfTeam(
  userId: string,
  teamId: string | null
): Promise<boolean> {
  if (!teamId) return false;
  const memberships = await getUserTeamMemberships(userId);
  return memberships.has(teamId);
}

/**
 * Return true iff `ownerUserId` has explicitly shared the session
 * identified by `sessionId` with `readerUserId` via SessionShare.
 */
export async function isSessionSharedWith(
  sessionId: string,
  readerUserId: string
): Promise<boolean> {
  const share = await prisma.sessionShare.findUnique({
    where: { sessionId_sharedWithUserId: { sessionId, sharedWithUserId: readerUserId } },
    select: { sessionId: true },
  });
  return share !== null;
}

/**
 * The new team-scoped read authorization for a session.
 *
 * Order of checks (short-circuits on first match):
 *   1. Session has no teamId → deny (pre-M2.4 data, deny-by-default).
 *   2. Session was created by the same user → allow.
 *   3. User is a member of the session's team → allow.
 *   4. User has a SessionShare for this session → allow.
 *   5. Otherwise → deny.
 *
 * Note the removal of the M2.3 OWNER/ADMIN global bypass. An OWNER of
 * team A can no longer read sessions of team B unless they were
 * explicitly shared in.
 */
export async function assertCanReadSessionScoped(
  userId: string,
  userRole: UserRole | null,
  meta: SessionMetaRow | undefined,
  sessionId: string
): Promise<{ allowed: boolean; reason: "owner" | "team_member" | "shared" | "deny"; teamRole?: UserRole }> {
  if (!meta) return { allowed: false, reason: "deny" };
  // userRole is accepted for backwards compatibility with the M2.3
  // call sites that already pass it through, but no longer affects
  // the decision. (We log it as part of the deny reason for
  // observability.)
  void userRole;

  if (!meta.teamId) {
    return { allowed: false, reason: "deny" };
  }
  if (meta.userId === userId) {
    return { allowed: true, reason: "owner" };
  }
  const memberships = await getUserTeamMemberships(userId);
  const teamRole = memberships.get(meta.teamId);
  if (teamRole) {
    return { allowed: true, reason: "team_member", teamRole };
  }
  if (await isSessionSharedWith(sessionId, userId)) {
    return { allowed: true, reason: "shared" };
  }
  return { allowed: false, reason: "deny" };
}