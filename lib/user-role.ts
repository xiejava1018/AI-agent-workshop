import { prisma } from "./prisma";

export async function getUserHighestRole(userId: string): Promise<"OWNER" | "ADMIN" | "MEMBER" | null> {
  const tms = await prisma.teamMember.findMany({ where: { userId } });
  if (tms.some(t => t.role === "OWNER")) return "OWNER";
  if (tms.some(t => t.role === "ADMIN")) return "ADMIN";
  if (tms.some(t => t.role === "MEMBER")) return "MEMBER";
  return null;
}