// lib/skill-invoke.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Prisma is mocked so the resolver logic can be exercised without a DB. Each
// test seeds `skillRows` (SkillPackage) and asserts the tenant-scoped lookup.
// ---------------------------------------------------------------------------
const { skillRows, invocationCreate } = vi.hoisted(() => ({
  skillRows: [] as Array<Record<string, unknown>>,
  invocationCreate: vi.fn().mockResolvedValue({}),
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
    skillInvocation: {
      create: invocationCreate,
    },
  },
}));

import {
  parseSkillCommand,
  resolveSkillPackageBySlug,
  buildSkillBlock,
  invokeSkill,
} from "./skill-invoke";

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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "skill-invoke-test-"));
  skillRows.length = 0;
  invocationCreate.mockClear();
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseSkillCommand", () => {
  it("parses /skill:<slug> with no args", () => {
    expect(parseSkillCommand("/skill:commit")).toEqual({ slug: "commit", args: "" });
  });

  it("parses /skill:<slug> with trailing args", () => {
    expect(parseSkillCommand("/skill:commit fix the bug")).toEqual({
      slug: "commit",
      args: "fix the bug",
    });
  });

  it("returns null for non-skill slash commands", () => {
    expect(parseSkillCommand("/model gpt-4")).toBeNull();
    expect(parseSkillCommand("/compact")).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(parseSkillCommand("hello world")).toBeNull();
  });

  it("returns null for empty slug", () => {
    expect(parseSkillCommand("/skill:")).toBeNull();
  });
});

describe("resolveSkillPackageBySlug", () => {
  it("resolves a global skill visible to any tenant", async () => {
    skillRows.push({ id: "g1", slug: "commit", scope: "global", enabled: true, filePath: "/x", teamId: null, userId: null });
    const pkg = await resolveSkillPackageBySlug("commit", { userId: "u1", teamId: "t1" });
    expect(pkg?.id).toBe("g1");
  });

  it("prefers user scope over team and global for the same slug", async () => {
    skillRows.push({ id: "g1", slug: "commit", scope: "global", enabled: true, teamId: null, userId: null });
    skillRows.push({ id: "t1", slug: "commit", scope: "team", enabled: true, teamId: "team-1", userId: null });
    skillRows.push({ id: "u1", slug: "commit", scope: "user", enabled: true, teamId: null, userId: "user-1" });
    const pkg = await resolveSkillPackageBySlug("commit", { userId: "user-1", teamId: "team-1" });
    expect(pkg?.id).toBe("u1");
  });

  it("does not return another user's user-scoped skill", async () => {
    skillRows.push({ id: "u1", slug: "secret", scope: "user", enabled: true, teamId: null, userId: "other-user" });
    const pkg = await resolveSkillPackageBySlug("secret", { userId: "user-1", teamId: "team-1" });
    expect(pkg).toBeNull();
  });

  it("does not return another team's team-scoped skill", async () => {
    skillRows.push({ id: "t1", slug: "team-only", scope: "team", enabled: true, teamId: "team-2", userId: null });
    const pkg = await resolveSkillPackageBySlug("team-only", { userId: "user-1", teamId: "team-1" });
    expect(pkg).toBeNull();
  });

  it("ignores disabled skills", async () => {
    skillRows.push({ id: "g1", slug: "commit", scope: "global", enabled: false, teamId: null, userId: null });
    const pkg = await resolveSkillPackageBySlug("commit", { userId: "u1", teamId: null });
    expect(pkg).toBeNull();
  });
});

describe("buildSkillBlock", () => {
  it("wraps the SKILL.md body in a <skill> block with location + baseDir", () => {
    const file = writeSkill("commit");
    const block = buildSkillBlock({ name: "commit", filePath: file, args: "" });
    expect(block).toContain('<skill name="commit"');
    expect(block).toContain(`location="${file}"`);
    expect(block).toContain("References are relative to");
    expect(block).toContain("Do the commit thing.");
    expect(block).not.toContain("disable-model-invocation");
    expect(block.trimEnd().endsWith("</skill>")).toBe(true);
  });

  it("appends args after the block when provided", () => {
    const file = writeSkill("commit");
    const block = buildSkillBlock({ name: "commit", filePath: file, args: "fix the bug" });
    expect(block).toContain("</skill>");
    expect(block.trimEnd().endsWith("fix the bug")).toBe(true);
  });

  it("resolves a directory filePath to its SKILL.md", () => {
    const file = writeSkill("commit");
    const dir = join(tmpDir, "commit");
    const block = buildSkillBlock({ name: "commit", filePath: dir, args: "" });
    expect(block).toContain(`location="${file}"`);
    expect(block).toContain("Do the commit thing.");
  });
});

describe("invokeSkill", () => {
  it("returns null for non-skill input", async () => {
    const result = await invokeSkill({ text: "just a message", userId: "u1", teamId: "t1" });
    expect(result).toBeNull();
  });

  it("expands an explicitly invoked disableModelInvocation skill", async () => {
    const file = writeSkill("deep-review", { disableModelInvocation: true });
    skillRows.push({
      id: "s1",
      slug: "deep-review",
      name: "deep-review",
      scope: "global",
      enabled: true,
      filePath: file,
      teamId: null,
      userId: null,
    });
    const result = await invokeSkill({ text: "/skill:deep-review the auth module", userId: "u1", teamId: "t1" });
    expect(result).not.toBeNull();
    expect(result?.slug).toBe("deep-review");
    expect(result?.skillPackageId).toBe("s1");
    expect(result?.disableModelInvocation).toBe(true);
    expect(result?.expandedText).toContain('<skill name="deep-review"');
    expect(result?.expandedText.trimEnd().endsWith("the auth module")).toBe(true);
  });

  it("records the invocation when a sessionId is supplied", async () => {
    const file = writeSkill("commit");
    skillRows.push({
      id: "s1", slug: "commit", name: "commit", scope: "global",
      enabled: true, filePath: file, teamId: null, userId: null,
    });
    await invokeSkill({ text: "/skill:commit", userId: "u1", teamId: "t1", sessionId: "sess-1" });
    expect(invocationCreate).toHaveBeenCalledTimes(1);
    const arg = invocationCreate.mock.calls[0][0];
    expect(arg.data.skillPackageId).toBe("s1");
    expect(arg.data.sessionId).toBe("sess-1");
    expect(arg.data.userId).toBe("u1");
  });

  it("throws when the slug is unknown to the caller's tenant", async () => {
    await expect(
      invokeSkill({ text: "/skill:nope", userId: "u1", teamId: "t1" }),
    ).rejects.toThrow(/not found/i);
  });
});
