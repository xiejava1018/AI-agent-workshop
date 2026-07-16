// lib/scope-resolve.ts
import { prisma } from "./prisma";

export interface ResolveInput {
  agentId: string;
  userId: string;
  teamId: string | null;
  scope?: "team" | "personal";
}

export interface ResolvedSkills {
  skills: string[];
  layersApplied: string[];
}

/**
 * Resolve the effective skill set for an agent by converging four layers:
 * global → team → user → agent. Each binding has a mode of
 * "inherit" | "include" | "exclude". Excludes from any layer remove a slug
 * from the effective set; includes/inherits add it.
 *
 * Personal scope (`scope === "personal"`) skips the team layer entirely,
 * even if `teamId` is provided.
 */
export async function resolveAgentSkills(input: ResolveInput): Promise<ResolvedSkills> {
  const layersApplied: string[] = [];
  const effective = new Map<string, string>();

  // global layer
  const globalSkills = await prisma.skillPackage.findMany({
    where: { scope: "global", enabled: true },
  });
  for (const s of globalSkills) effective.set(s.slug, "inherit");
  layersApplied.push("global");

  // team layer (skip when personal scope)
  if (input.scope !== "personal" && input.teamId) {
    const teamSkills = await prisma.skillPackage.findMany({
      where: { scope: "team", teamId: input.teamId, enabled: true },
    });
    for (const s of teamSkills) effective.set(s.slug, "inherit");
    layersApplied.push("team");
  }

  // user layer bindings
  const userBindings = await prisma.userSkillBinding.findMany({
    where: { userId: input.userId },
  });
  for (const b of userBindings) {
    const pkg = await prisma.skillPackage.findUnique({ where: { id: b.skillPackageId } });
    if (!pkg) continue;
    if (b.mode === "exclude") effective.delete(pkg.slug);
    else effective.set(pkg.slug, b.mode);
  }
  layersApplied.push("user");

  // agent layer (last-write-wins convergence)
  const agentBindings = await prisma.agentSkillBinding.findMany({
    where: { agentId: input.agentId },
  });
  for (const b of agentBindings) {
    const pkg = await prisma.skillPackage.findUnique({ where: { id: b.skillPackageId } });
    if (!pkg) continue;
    if (b.mode === "exclude") effective.delete(pkg.slug);
    else effective.set(pkg.slug, b.mode);
  }
  layersApplied.push("agent");

  return { skills: [...effective.keys()], layersApplied };
}
