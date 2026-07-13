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