// lib/skill-block.ts
//
// T5.5 — model-decided `<skill>` block handling for the multi-tenant skill
// system.
//
// Where T5.4 (`skill-invoke.ts`) covers the EXPLICIT `/skill:<slug>` path a
// human types into the editor, this module covers the MODEL SELF-DETERMINED
// path: the assistant, having been shown a skill's frontmatter in the system
// prompt, decides on its own to invoke it and emits a
// `<skill name="..." location="...">...</skill>` block in its response.
//
// The pi SDK ships `parseSkillBlock`, but it (a) anchors to the WHOLE message
// (`^...$`), (b) parses only a single block, and (c) knows nothing about the
// M3 multi-tenant `SkillPackage` table or the `disable-model-invocation` flag.
// This module bridges all three gaps:
//
//   1. `parseSkillBlock` / `parseSkillBlocks` — find one or all `<skill>`
//      blocks anywhere in a message (blocks may be wrapped in prose).
//   2. `resolveSkillBlock` — resolve a parsed block against the caller's
//      visible tenant scopes and enforce `disable-model-invocation`: a skill
//      flagged that way may ONLY be triggered via the explicit `/skill:` path
//      (T5.4), so the model is NOT allowed to self-invoke it here.
//   3. `expandModelSkillBlocks` — rewrite the assistant text, injecting the
//      AUTHORITATIVE instructions read from disk for allowed skills and
//      stripping disallowed blocks so their (untrusted) body never reaches the
//      next turn.
//   4. `describeSkillBlocks` — lightweight metadata for the frontend skill
//      center visualization (T6.7 / T6.4), no file bodies attached.

import { readFileSync } from "fs";
import { prisma } from "./prisma";
import { buildSkillInjection, parseSkillCommand } from "./skill-invoke";

// ---------------------------------------------------------------------------
// Local helpers that were previously imported from skill-invoke (T5.4 era)
// ---------------------------------------------------------------------------

/** Tenant context for skill resolution. */
export interface SkillTenant {
  userId: string;
  teamId: string | null;
}

/**
 * Read the `disable-model-invocation` flag from a skill file's YAML frontmatter.
 * Returns false when the file cannot be read.
 */
function readDisableModelInvocation(filePath: string): boolean {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return false;
    const fm = match[1];
    return /disable-model-invocation:\s*true/i.test(fm);
  } catch {
    return false;
  }
}

/**
 * Resolve a skill slug against the caller's tenant scopes.
 * Priority: user > team > global.
 * Returns null when the skill is not found or not visible.
 */
async function resolveSkillPackageBySlug(
  slug: string,
  tenant: SkillTenant,
): Promise<{
  id: string;
  slug: string;
  name: string;
  filePath: string;
  scope: string;
  userId: string | null;
  teamId: string | null;
} | null> {
  const scopesToTry: Array<{
    scope: "user" | "team" | "global";
    teamId: string | null;
    userId: string | null;
  }> = [
    { scope: "user", teamId: null, userId: tenant.userId },
    { scope: "team", teamId: tenant.teamId, userId: null },
    { scope: "global", teamId: null, userId: null },
  ];
  for (const filter of scopesToTry) {
    const pkg = await prisma.skillPackage.findFirst({
      where: {
        slug,
        enabled: true,
        scope: filter.scope,
        teamId: filter.teamId,
        userId: filter.userId,
      },
    });
    if (pkg) return pkg as unknown as { id: string; slug: string; name: string; filePath: string; scope: string; userId: string | null; teamId: string | null };
  }
  return null;
}

/**
 * Build an authoritative `<skill>` injection block from a skill file on disk.
 * Reads the file content and wraps it in a `<skill>` tag.
 */
function buildSkillBlock(opts: { name: string; filePath: string; args: string }): string {
  try {
    const content = readFileSync(opts.filePath, "utf-8");
    return `<skill name="${opts.name}">\n${content}\n</skill>`;
  } catch {
    return "";
  }
}

/**
 * Handle the explicit `/skill:<slug>` command path (T5.4).
 * Parses the text for a slash-or-at prefix, resolves the skill, and returns
 * the expanded text. Returns null when the text is not a skill command.
 *
 * NOTE: this function is kept in skill-block.ts rather than skill-invoke.ts to
 * avoid a circular dependency (skill-invoke.ts does not import skill-block.ts).
 */
export async function invokeSkill(opts: {
  text: string;
  userId: string;
  teamId: string | null;
  sessionId: string;
}): Promise<{ expandedText: string } | null> {
  const parsed = parseSkillCommand(opts.text);
  if (!parsed) return null;
  const injection = await buildSkillInjection({
    skillName: parsed.skillName,
    teamId: opts.teamId,
    userId: opts.userId,
    sessionId: opts.sessionId,
  });
  if (!injection) return null;
  return { expandedText: injection };
}

/** A single `<skill>` block parsed out of a message. */
export interface ParsedSkillBlock {
  name: string;
  location: string;
  content: string;
  /** Trailing prose the model appended after the block, if any. */
  userMessage: string | undefined;
  /** Char offsets of the block within the source text (for stripping/replace). */
  start: number;
  end: number;
}

/** Result of resolving a parsed block against the tenant's SkillPackage rows. */
export interface ResolvedSkillBlock {
  skillName: string;
  slug: string;
  /** Non-null when the block maps to a visible, enabled SkillPackage row. */
  skillPackageId: string | null;
  scope: string | null;
  /** True when this skill is flagged `disable-model-invocation` in SKILL.md. */
  disableModelInvocation: boolean;
  /**
   * True when the model is allowed to self-invoke this skill: the slug resolves
   * to a visible, enabled skill AND that skill is not `disable-model-invocation`.
   */
  allowed: boolean;
  /** Authoritative `<skill>` injection block, or "" when not allowed. */
  instructions: string;
}

/** Lightweight per-block hint surfaced to the frontend. */
export interface SkillBlockHint {
  skillName: string;
  slug: string;
  allowed: boolean;
  skillPackageId: string | null;
  scope: string | null;
}

/** Outcome of expanding all model-decided skill blocks in a message. */
export interface ExpandModelSkillBlocksResult {
  /** Text with allowed blocks kept and disallowed blocks stripped. */
  expandedText: string;
  /** One hint per detected block, in document order. */
  detected: SkillBlockHint[];
}

// A `<skill>` block is emitted with a `name="..." location="..."` open tag, a
// body, and a closing `</skill>`. We match non-greedily so multiple blocks in
// one message are each captured separately. The `g` flag drives `parseSkillBlocks`.
const SKILL_BLOCK_RE =
  /<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>/g;

/**
 * Parse the FIRST `<skill>` block found anywhere in `text`. Unlike the SDK's
 * whole-message `parseSkillBlock`, this finds a block even when the model
 * wraps it in surrounding prose. Returns `null` when no block is present.
 */
export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const blocks = parseSkillBlocks(text);
  return blocks.length > 0 ? blocks[0] : null;
}

/**
 * Parse EVERY `<skill>` block in `text`, in document order. A block's
 * `userMessage` is the prose that immediately follows it (up to the next block
 * or end of text), matching the SDK's "trailing user message" convention.
 */
export function parseSkillBlocks(text: string): ParsedSkillBlock[] {
  const blocks: ParsedSkillBlock[] = [];
  SKILL_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SKILL_BLOCK_RE.exec(text)) !== null) {
    blocks.push({
      name: match[1],
      location: match[2],
      content: match[3],
      userMessage: undefined, // filled in below once end offsets are known
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Attach the trailing prose (between this block's end and the next block's
  // start) as `userMessage`, trimmed. Empty prose stays undefined.
  for (let i = 0; i < blocks.length; i++) {
    const from = blocks[i].end;
    const to = i + 1 < blocks.length ? blocks[i + 1].start : text.length;
    const trailing = text.slice(from, to).trim();
    if (trailing) blocks[i].userMessage = trailing;
  }

  return blocks;
}

/**
 * Resolve a parsed block against the caller's visible tenant scopes and decide
 * whether the model is allowed to self-invoke it.
 *
 * - Unknown / not-visible / disabled slug → `allowed: false`, no instructions.
 * - `disable-model-invocation: true` skill → `allowed: false` (explicit-only),
 *   no instructions, but `disableModelInvocation: true` so the UI can explain.
 * - Otherwise → `allowed: true` with the authoritative `<skill>` block read
 *   from disk (NOT the model's own — which could be tampered with).
 */
export async function resolveSkillBlock(
  block: ParsedSkillBlock,
  tenant: SkillTenant,
): Promise<ResolvedSkillBlock> {
  const slug = block.name;
  const pkg = await resolveSkillPackageBySlug(slug, tenant);

  if (!pkg) {
    return {
      skillName: block.name,
      slug,
      skillPackageId: null,
      scope: null,
      disableModelInvocation: false,
      allowed: false,
      instructions: "",
    };
  }

  const disableModelInvocation = readDisableModelInvocation(pkg.filePath);
  if (disableModelInvocation) {
    return {
      skillName: block.name,
      slug: pkg.slug,
      skillPackageId: pkg.id,
      scope: pkg.scope,
      disableModelInvocation: true,
      allowed: false,
      instructions: "",
    };
  }

  const instructions = buildSkillBlock({
    name: pkg.name || pkg.slug,
    filePath: pkg.filePath,
    args: "",
  });

  return {
    skillName: block.name,
    slug: pkg.slug,
    skillPackageId: pkg.id,
    scope: pkg.scope,
    disableModelInvocation: false,
    allowed: true,
    instructions,
  };
}

/**
 * Detect and expand every model-decided `<skill>` block in an assistant
 * message.
 *
 * - Returns `null` when the text contains no blocks (caller forwards unchanged).
 * - For each ALLOWED block, the model's inline block is replaced by the
 *   authoritative instructions read from disk.
 * - For each DISALLOWED block (unknown, cross-tenant, or explicit-only), the
 *   block is stripped entirely so its untrusted body never reaches the model
 *   on the next turn. Surrounding prose is preserved.
 */
export async function expandModelSkillBlocks(
  text: string,
  tenant: SkillTenant,
): Promise<ExpandModelSkillBlocksResult | null> {
  const blocks = parseSkillBlocks(text);
  if (blocks.length === 0) return null;

  const resolved = await Promise.all(blocks.map((b) => resolveSkillBlock(b, tenant)));

  // Rebuild the text by replacing each block span. Work back-to-front so the
  // earlier blocks' offsets stay valid as we splice.
  let expandedText = text;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const res = resolved[i];
    const replacement = res.allowed ? res.instructions : "";
    expandedText = expandedText.slice(0, block.start) + replacement + expandedText.slice(block.end);
  }

  const detected: SkillBlockHint[] = resolved.map((res) => ({
    skillName: res.skillName,
    slug: res.slug,
    allowed: res.allowed,
    skillPackageId: res.skillPackageId,
    scope: res.scope,
  }));

  return { expandedText, detected };
}

/**
 * Produce lightweight visualization hints for every `<skill>` block in a
 * message, without reading or attaching skill bodies. Intended for the
 * frontend skill center (T6.7) / workbench chat (T6.4) to show which skills
 * the model reached for and whether each was permitted.
 */
export async function describeSkillBlocks(
  text: string,
  tenant: SkillTenant,
): Promise<SkillBlockHint[]> {
  const blocks = parseSkillBlocks(text);
  if (blocks.length === 0) return [];

  const resolved = await Promise.all(blocks.map((b) => resolveSkillBlock(b, tenant)));
  return resolved.map((res) => ({
    skillName: res.skillName,
    slug: res.slug,
    allowed: res.allowed,
    skillPackageId: res.skillPackageId,
    scope: res.scope,
  }));
}
