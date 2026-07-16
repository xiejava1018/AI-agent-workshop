// lib/skill-invoke.ts
//
// T5.4 — explicit `/<skill>` invocation for the multi-tenant skill system.
//
// The pi SDK auto-expands `/skill:<name>` inside `AgentSession.prompt()` from
// the FILESYSTEM skills discovered by its resource loader. That covers skills
// physically present under the session cwd, but it does NOT know about the
// multi-tenant `SkillPackage` table (global / team / user scoped rows) that
// M3 introduced.
//
// This module bridges that gap: given raw editor text, it detects a
// `/skill:<slug>` command, resolves the slug against the SkillPackage table
// within the caller's visible tenant scopes (user > team > global), reads the
// backing SKILL.md, and produces the same `<skill>...</skill>` injection block
// the SDK uses — so the expanded text can be handed straight to `prompt()`.
//
// Skills flagged `disable-model-invocation: true` are excluded from the system
// prompt (the model can't call them on its own) and can ONLY be triggered via
// this explicit `/skill:<slug>` path — which is exactly what T5.4 asks for.

import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { parseFrontmatter, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { prisma } from "./prisma";

const SKILL_COMMAND_PREFIX = "/skill:";

export interface ParsedSkillCommand {
  slug: string;
  args: string;
}

export interface SkillTenant {
  userId: string;
  teamId: string | null;
}

export interface ResolvedSkillPackage {
  id: string;
  slug: string;
  name: string;
  scope: string;
  filePath: string;
}

export interface InvokeSkillInput {
  text: string;
  userId: string;
  teamId: string | null;
  /** When set, an audit `SkillInvocation` row is written. */
  sessionId?: string;
}

export interface InvokeSkillResult {
  slug: string;
  skillPackageId: string;
  /** Text with the skill body expanded, ready to hand to `prompt()`. */
  expandedText: string;
  disableModelInvocation: boolean;
}

/**
 * Parse a `/skill:<slug> [args]` command out of raw editor text.
 * Returns `null` for anything that is not a well-formed skill command
 * (plain text, other slash commands, or an empty slug).
 */
export function parseSkillCommand(text: string): ParsedSkillCommand | null {
  if (!text.startsWith(SKILL_COMMAND_PREFIX)) return null;
  const rest = text.slice(SKILL_COMMAND_PREFIX.length);
  const spaceIndex = rest.indexOf(" ");
  const slug = spaceIndex === -1 ? rest : rest.slice(0, spaceIndex);
  if (!slug) return null;
  const args = spaceIndex === -1 ? "" : rest.slice(spaceIndex + 1).trim();
  return { slug, args };
}

/**
 * Resolve a skill slug to a `SkillPackage` row within the caller's visible
 * tenant scopes. Precedence is user > team > global: a personal skill with the
 * same slug shadows a team one, which shadows a global one. Disabled rows and
 * rows belonging to other users/teams are never returned.
 *
 * Returns `null` when no enabled, visible skill matches the slug.
 */
export async function resolveSkillPackageBySlug(
  slug: string,
  tenant: SkillTenant,
): Promise<ResolvedSkillPackage | null> {
  // user layer (highest precedence)
  const userMatches = await prisma.skillPackage.findMany({
    where: { slug, scope: "user", userId: tenant.userId, enabled: true },
  });
  if (userMatches.length > 0) return toResolved(userMatches[0]);

  // team layer
  if (tenant.teamId) {
    const teamMatches = await prisma.skillPackage.findMany({
      where: { slug, scope: "team", teamId: tenant.teamId, enabled: true },
    });
    if (teamMatches.length > 0) return toResolved(teamMatches[0]);
  }

  // global layer (lowest precedence)
  const globalMatches = await prisma.skillPackage.findMany({
    where: { slug, scope: "global", enabled: true },
  });
  if (globalMatches.length > 0) return toResolved(globalMatches[0]);

  return null;
}

function toResolved(row: Record<string, unknown>): ResolvedSkillPackage {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name ?? row.slug),
    scope: String(row.scope),
    filePath: String(row.filePath ?? ""),
  };
}

/**
 * Resolve a stored `filePath` (which may point at either the SKILL.md file
 * itself or the skill's directory) to the concrete SKILL.md path on disk.
 * Throws when neither form exists.
 */
function resolveSkillMarkdownPath(filePath: string): string {
  if (!filePath) throw new Error("skill has no filePath on disk");
  if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
  const candidate = join(filePath, "SKILL.md");
  if (existsSync(candidate)) return candidate;
  throw new Error(`SKILL.md not found for skill at ${filePath}`);
}

/**
 * Build the `<skill>...</skill>` injection block from a skill's SKILL.md,
 * matching the format the pi SDK uses for `/skill:name` expansion. When
 * `args` is non-empty they are appended after the block, exactly like the SDK.
 */
export function buildSkillBlock(input: { name: string; filePath: string; args: string }): string {
  const mdPath = resolveSkillMarkdownPath(input.filePath);
  const content = readFileSync(mdPath, "utf-8");
  const body = stripFrontmatter(content).trim();
  const baseDir = dirname(mdPath);
  const block = `<skill name="${input.name}" location="${mdPath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
  return input.args ? `${block}\n\n${input.args}` : block;
}

/**
 * Read the `disable-model-invocation` flag from a skill's SKILL.md
 * frontmatter. This flag lives in the file (per Agent Skills standard), not
 * in the SkillPackage table, so it is the source of truth for whether a skill
 * may ONLY be triggered via explicit `/skill:<slug>` invocation. Returns
 * `false` when the file cannot be read or the key is absent.
 */
export function readDisableModelInvocation(filePath: string): boolean {
  try {
    const mdPath = resolveSkillMarkdownPath(filePath);
    const content = readFileSync(mdPath, "utf-8");
    const { frontmatter } = parseFrontmatter<{ "disable-model-invocation"?: boolean }>(content);
    return Boolean(frontmatter["disable-model-invocation"]);
  } catch {
    return false;
  }
}

/**
 * Detect and expand a `/skill:<slug>` command against the multi-tenant
 * SkillPackage table.
 *
 * - Returns `null` when `text` is not a skill command (caller sends it as a
 *   normal prompt).
 * - Throws when the slug is not a visible, enabled skill for this tenant, so
 *   the UI can surface a clear "unknown skill" error instead of silently
 *   forwarding `/skill:foo` as literal prompt text.
 * - On success, returns the expanded `<skill>` block plus the resolved slug /
 *   package id. When `sessionId` is provided, an audit `SkillInvocation` row
 *   is written (best-effort — a logging failure never blocks the invocation).
 */
export async function invokeSkill(input: InvokeSkillInput): Promise<InvokeSkillResult | null> {
  const parsed = parseSkillCommand(input.text);
  if (!parsed) return null;

  const pkg = await resolveSkillPackageBySlug(parsed.slug, {
    userId: input.userId,
    teamId: input.teamId,
  });
  if (!pkg) {
    throw new Error(`Skill not found: ${parsed.slug}`);
  }

  const expandedText = buildSkillBlock({
    name: pkg.name || pkg.slug,
    filePath: pkg.filePath,
    args: parsed.args,
  });

  if (input.sessionId) {
    try {
      await prisma.skillInvocation.create({
        data: {
          skillPackageId: pkg.id,
          userId: input.userId,
          sessionId: input.sessionId,
        },
      });
    } catch {
      // Audit logging is best-effort; never block the actual skill invocation.
    }
  }

  return {
    slug: pkg.slug,
    skillPackageId: pkg.id,
    expandedText,
    disableModelInvocation: readDisableModelInvocation(pkg.filePath),
  };
}
