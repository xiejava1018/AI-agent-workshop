// lib/skill-block.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Prisma is mocked so resolution against the multi-tenant SkillPackage table
// can be exercised without a DB. Each test seeds `skillRows` and asserts the
// tenant-scoped, disable-model-invocation-aware behaviour.
// ---------------------------------------------------------------------------
const { skillRows } = vi.hoisted(() => ({
  skillRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("./prisma", () => ({
  prisma: {
    skillPackage: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return skillRows.filter((row) => {
          for (const [k, v] of Object.entries(where)) {
            if (row[k] !== v) return false;
          }
          return true;
        });
      }),
    },
  },
}));

import {
  parseSkillBlock,
  parseSkillBlocks,
  resolveSkillBlock,
  expandModelSkillBlocks,
  describeSkillBlocks,
} from "./skill-block";

let tmpDir: string;

function writeSkill(slug: string, opts: { disableModelInvocation?: boolean; body?: string } = {}): string {
  const dir = join(tmpDir, slug);
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---",
    `name: ${slug}`,
    `description: The ${slug} skill`,
    ...(opts.disableModelInvocation ? ["disable-model-invocation: true"] : []),
    "---",
  ].join("\n");
  const file = join(dir, "SKILL.md");
  writeFileSync(file, `${fm}\n${opts.body ?? `# ${slug}\nDo the ${slug} thing.`}\n`);
  return file;
}

/** Reconstruct the exact `<skill>` block the SDK/model emits. */
function skillBlock(name: string, location: string, content = `Do the ${name} thing.`): string {
  return `<skill name="${name}" location="${location}">\nReferences are relative to /tmp.\n\n${content}\n</skill>`;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "skill-block-test-"));
  skillRows.length = 0;
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseSkillBlock", () => {
  it("parses a whole-message skill block (SDK-compatible)", () => {
    const block = skillBlock("commit", "/skills/commit/SKILL.md");
    const parsed = parseSkillBlock(block);
    expect(parsed?.name).toBe("commit");
    expect(parsed?.location).toBe("/skills/commit/SKILL.md");
    expect(parsed?.content).toContain("Do the commit thing.");
  });

  it("parses a trailing user message after the block", () => {
    const block = `${skillBlock("commit", "/x/SKILL.md")}\n\nnow do it`;
    const parsed = parseSkillBlock(block);
    expect(parsed?.name).toBe("commit");
    expect(parsed?.userMessage).toBe("now do it");
  });

  it("finds a block embedded in surrounding assistant prose", () => {
    const text = `Sure, I'll use a skill.\n${skillBlock("review", "/x/SKILL.md")}\nDone.`;
    const parsed = parseSkillBlock(text);
    expect(parsed?.name).toBe("review");
  });

  it("returns null when there is no skill block", () => {
    expect(parseSkillBlock("just a plain assistant reply")).toBeNull();
  });
});

describe("parseSkillBlocks", () => {
  it("returns every block emitted in one message", () => {
    const text = `${skillBlock("a", "/a/SKILL.md")}\nmiddle\n${skillBlock("b", "/b/SKILL.md")}`;
    const blocks = parseSkillBlocks(text);
    expect(blocks.map((b) => b.name)).toEqual(["a", "b"]);
  });

  it("returns an empty array when none are present", () => {
    expect(parseSkillBlocks("nothing here")).toEqual([]);
  });
});

describe("resolveSkillBlock", () => {
  it("resolves a model-decided block against a visible enabled skill and injects instructions", async () => {
    const file = writeSkill("commit");
    skillRows.push({
      id: "s1", slug: "commit", name: "commit", scope: "global",
      enabled: true, filePath: file, teamId: null, userId: null,
    });
    const block = parseSkillBlock(skillBlock("commit", file))!;
    const resolved = await resolveSkillBlock(block, { userId: "u1", teamId: "t1" });
    expect(resolved.allowed).toBe(true);
    expect(resolved.skillPackageId).toBe("s1");
    expect(resolved.slug).toBe("commit");
    expect(resolved.disableModelInvocation).toBe(false);
    expect(resolved.instructions).toContain('<skill name="commit"');
    expect(resolved.instructions).toContain("Do the commit thing.");
  });

  it("blocks a disable-model-invocation skill from being self-invoked by the model", async () => {
    const file = writeSkill("deep-review", { disableModelInvocation: true });
    skillRows.push({
      id: "s2", slug: "deep-review", name: "deep-review", scope: "global",
      enabled: true, filePath: file, teamId: null, userId: null,
    });
    const block = parseSkillBlock(skillBlock("deep-review", file))!;
    const resolved = await resolveSkillBlock(block, { userId: "u1", teamId: "t1" });
    expect(resolved.allowed).toBe(false);
    expect(resolved.disableModelInvocation).toBe(true);
    expect(resolved.instructions).toBe("");
  });

  it("marks a block as not allowed when the skill is not visible to the tenant", async () => {
    skillRows.push({
      id: "s3", slug: "secret", name: "secret", scope: "user",
      enabled: true, filePath: "/x", teamId: null, userId: "other-user",
    });
    const block = parseSkillBlock(skillBlock("secret", "/x/SKILL.md"))!;
    const resolved = await resolveSkillBlock(block, { userId: "u1", teamId: "t1" });
    expect(resolved.allowed).toBe(false);
    expect(resolved.skillPackageId).toBeNull();
  });
});

describe("expandModelSkillBlocks", () => {
  it("returns null when the assistant text contains no skill blocks", async () => {
    const result = await expandModelSkillBlocks("plain reply", { userId: "u1", teamId: "t1" });
    expect(result).toBeNull();
  });

  it("injects authoritative instructions for an allowed model-decided skill", async () => {
    const file = writeSkill("commit");
    skillRows.push({
      id: "s1", slug: "commit", name: "commit", scope: "global",
      enabled: true, filePath: file, teamId: null, userId: null,
    });
    const text = skillBlock("commit", file);
    const result = await expandModelSkillBlocks(text, { userId: "u1", teamId: "t1" });
    expect(result).not.toBeNull();
    expect(result?.detected).toHaveLength(1);
    expect(result?.detected[0]).toMatchObject({ skillName: "commit", allowed: true, skillPackageId: "s1" });
    expect(result?.expandedText).toContain("Do the commit thing.");
  });

  it("strips a disallowed disable-model-invocation block and flags it", async () => {
    const file = writeSkill("deep-review", { disableModelInvocation: true });
    skillRows.push({
      id: "s2", slug: "deep-review", name: "deep-review", scope: "global",
      enabled: true, filePath: file, teamId: null, userId: null,
    });
    const text = `before\n${skillBlock("deep-review", file)}\nafter`;
    const result = await expandModelSkillBlocks(text, { userId: "u1", teamId: "t1" });
    expect(result?.detected[0]).toMatchObject({ skillName: "deep-review", allowed: false });
    expect(result?.expandedText).not.toContain("</skill>");
    expect(result?.expandedText).toContain("before");
    expect(result?.expandedText).toContain("after");
  });
});

describe("describeSkillBlocks", () => {
  it("returns lightweight visualization metadata for the frontend", async () => {
    const file = writeSkill("commit");
    skillRows.push({
      id: "s1", slug: "commit", name: "commit", scope: "global",
      enabled: true, filePath: file, teamId: null, userId: null,
    });
    const text = skillBlock("commit", file);
    const hints = await describeSkillBlocks(text, { userId: "u1", teamId: "t1" });
    expect(hints).toEqual([
      { skillName: "commit", slug: "commit", allowed: true, skillPackageId: "s1", scope: "global" },
    ]);
  });

  it("returns an empty array when no blocks are present", async () => {
    const hints = await describeSkillBlocks("plain reply", { userId: "u1", teamId: "t1" });
    expect(hints).toEqual([]);
  });
});
