/**
 * lib/team-admin.ts
 *
 * Shared team administration utilities.
 */

import { prisma } from "@/lib/prisma";
import { getUserHighestRole } from "@/lib/server-user";

/**
 * True if the caller may administer the given team: either a platform OWNER,
 * or holds OWNER/ADMIN role within the team itself.
 */
export async function canAdministerTeam(
  teamId: string,
  callerId: string
): Promise<boolean> {
  const platformRole = await getUserHighestRole(callerId);
  if (platformRole === "OWNER") return true;
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: callerId } },
    select: { role: true },
  });
  return membership?.role === "OWNER" || membership?.role === "ADMIN";
}
