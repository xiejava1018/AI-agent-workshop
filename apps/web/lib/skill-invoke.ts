import { prisma } from "./prisma";

export interface SkillCommand {
  skillName: string;
  remainingInput: string;
}

/**
 * Parse /<skill> or @MCP prefix from user input.
 * Returns null if no skill prefix found.
 */
export function parseSkillCommand(input: string): SkillCommand | null {
  const slashMatch = input.match(/^\/([a-zA-Z][a-zA-Z0-9_-]*)\s+(.*)$/);
  if (slashMatch) {
    return { skillName: slashMatch[1], remainingInput: slashMatch[2] };
  }
  const atMatch = input.match(/^@([a-zA-Z][a-zA-Z0-9_-]*)\s+(.*)$/);
  if (atMatch) {
    return { skillName: atMatch[1], remainingInput: atMatch[2] };
  }
  return null;
}

/**
 * Build skill injection instructions for a given skill.
 * Returns null if skill not found or disabled.
 */
export async function buildSkillInjection(skillName: string): Promise<string | null> {
  const skill = await prisma.skillPackage.findFirst({
    where: { slug: skillName, enabled: true },
  });
  if (!skill) return null;

  // Map to disableModelInvocation-style instruction
  // The actual skill injection format depends on how Pi Agent consumes it
  return `<skill>${skill.slug}</skill>\nYou must follow the ${skill.name} instructions.`;
}
