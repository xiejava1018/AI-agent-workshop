import fs from "fs";
import { resolve, relative, sep } from "path";
import { prisma } from "./prisma";

// Skills root directory — all skill file reads are pinned to this location
const SKILLS_ROOT = resolve(process.env.SKILLS_ROOT ?? "./.skills");

/**
 * Validate and read a skill file safely, rejecting any path that escapes SKILLS_ROOT.
 * Returns null if the file cannot be read or the path is invalid.
 */
export function safeReadSkillFile(filePath: string): string | null {
  if (!filePath) return null;
  const candidate = resolve(filePath);
  const rel = relative(SKILLS_ROOT, candidate);
  // Reject if the resolved path is outside SKILLS_ROOT (path traversal attempt)
  if (rel.startsWith(`..${sep}`) || rel.includes("..")) return null;
  try {
    return fs.readFileSync(candidate, "utf-8");
  } catch {
    return null;
  }
}

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

export interface BuildSkillInjectionOptions {
  skillName: string;
  teamId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
}

/**
 * Build skill injection instructions for a given skill.
 *
 * Multi-tenant resolution (highest priority first):
 * 1. user  — scope="user" AND userId matches
 * 2. team  — scope="team" AND teamId matches
 * 3. global — scope="global"
 *
 * Returns null if skill not found or disabled.
 */
export async function buildSkillInjection(
  opts: BuildSkillInjectionOptions
): Promise<string | null> {
  const { skillName, teamId = null, userId = null, sessionId = null } = opts;

  // Priority order: user > team > global
  const scopesToTry: Array<{ scope: string; teamId: string | null; userId: string | null }> = [
    { scope: "user", teamId: null, userId },
    { scope: "team", teamId, userId: null },
    { scope: "global", teamId: null, userId: null },
  ];

  let resolvedSkill: {
    id: string;
    slug: string;
    name: string;
    filePath: string;
    scope: string;
    userId: string | null;
    teamId: string | null;
  } | null = null;

  for (const scopeFilter of scopesToTry) {
    const skill = await prisma.skillPackage.findFirst({
      where: {
        slug: skillName,
        enabled: true,
        scope: scopeFilter.scope,
        teamId: scopeFilter.teamId,
        userId: scopeFilter.userId,
      },
    });
    if (skill) {
      resolvedSkill = skill as (typeof resolvedSkill) & { scope: string; userId: string | null; teamId: string | null };
      break;
    }
  }

  if (!resolvedSkill) return null;

  // Read skill file content from filePath (validated against SKILLS_ROOT)
  let skillContent = "";
  const skillRecord2 = resolvedSkill as { filePath: string | null; [key: string]: unknown };
  if (skillRecord2.filePath) {
    skillContent = safeReadSkillFile(skillRecord2.filePath) ?? "";
  }

  // Write SkillInvocation audit log
  try {
    await prisma.skillInvocation.create({
      data: {
        skillPackageId: (resolvedSkill as { id: string }).id,
        userId: userId ?? null,
        sessionId: sessionId ?? null,
      },
    });
  } catch (err) {
    // Non-fatal: audit log must not block skill resolution
    console.error("[skill-invoke] Failed to write SkillInvocation:", err);
  }

  // Build injection string
  // Format compatible with disableModelInvocation skill pattern
  return [
    `<skill>${(resolvedSkill as any).slug}</skill>`,
    `Skill: ${(resolvedSkill as any).name}`,
    skillContent,
    `You must follow the ${(resolvedSkill as any).name} instructions above.`,
  ].join("\n");
}
