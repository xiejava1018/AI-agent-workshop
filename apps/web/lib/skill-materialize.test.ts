// lib/skill-materialize.test.ts
//
// change: skill-runtime-completeness P0.1.4
// 内存 fs mock 测试 canonSkillPath / materializeSkill / syncSkillToSessionCwd。

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- 内存 fs mock（vi.hoisted 让 factory 可安全引用 memfs / fsImpl）--------
// skill-materialize.ts 用命名导入 `import { readFileSync } from "fs"`，
// 故 mock factory 必须把函数同时放在「命名导出」和 default 上。
const { memfs, fsImpl } = vi.hoisted(() => {
  const memfs = new Map<string, string>();
  const fsImpl = {
    readFileSync: vi.fn((p: string) => {
      const key = String(p);
      if (!memfs.has(key)) {
        const err = new Error(`ENOENT: ${p}`) as Error & { code: string };
        err.code = "ENOENT";
        throw err;
      }
      return memfs.get(key)!;
    }),
    writeFileSync: vi.fn((p: string, data: string) => {
      memfs.set(String(p), String(data));
    }),
    existsSync: vi.fn((p: string) => memfs.has(String(p))),
    mkdirSync: vi.fn(() => undefined),
  };
  return { memfs, fsImpl };
});

vi.mock("fs", () => ({ ...fsImpl, default: fsImpl }));

vi.mock("./prisma", () => ({
  prisma: {
    skillCuratedEntry: {
      findUnique: vi.fn(),
    },
  },
}));

import {
  canonSkillPath,
  isWithinSkillsRoot,
  parseSkillFrontmatter,
  materializeSkill,
  syncSkillToSessionCwd,
  MaterializeError,
  getSkillsRoot,
} from "./skill-materialize";
import { prisma } from "./prisma";

beforeEach(() => {
  memfs.clear();
  vi.clearAllMocks();
});

const SKILL_MD = (name: string, description = "a skill") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\nSkill body.`;

// ---------------------------------------------------------------------------
// canonSkillPath
// ---------------------------------------------------------------------------

describe("canonSkillPath", () => {
  it("global scope → <SKILLS_ROOT>/global/<slug>/SKILL.md", () => {
    const p = canonSkillPath("global", "draw-diagram");
    expect(p).toBe(`${getSkillsRoot()}/global/draw-diagram/SKILL.md`);
  });

  it("team scope → <SKILLS_ROOT>/team/<teamId>/<slug>/SKILL.md", () => {
    const p = canonSkillPath("team", "threat-hunt", { teamId: "team_123" });
    expect(p).toBe(`${getSkillsRoot()}/team/team_123/threat-hunt/SKILL.md`);
  });

  it("user scope → <SKILLS_ROOT>/user/<userId>/<slug>/SKILL.md", () => {
    const p = canonSkillPath("user", "my-skill", { userId: "user_456" });
    expect(p).toBe(`${getSkillsRoot()}/user/user_456/my-skill/SKILL.md`);
  });
});

// ---------------------------------------------------------------------------
// isWithinSkillsRoot
// ---------------------------------------------------------------------------

describe("isWithinSkillsRoot", () => {
  it("accepts path inside SKILLS_ROOT", () => {
    expect(isWithinSkillsRoot(`${getSkillsRoot()}/global/x/SKILL.md`)).toBe(true);
  });
  it("rejects path outside SKILLS_ROOT", () => {
    expect(isWithinSkillsRoot("/etc/passwd")).toBe(false);
    expect(isWithinSkillsRoot("/Users/xiejava/.pi/agent/skills/foo/SKILL.md")).toBe(false);
  });
  it("rejects empty", () => {
    expect(isWithinSkillsRoot("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseSkillFrontmatter
// ---------------------------------------------------------------------------

describe("parseSkillFrontmatter", () => {
  it("extracts name + description", () => {
    const fm = parseSkillFrontmatter(SKILL_MD("Draw Diagram", "生成 SVG 图"));
    expect(fm.name).toBe("Draw Diagram");
    expect(fm.description).toBe("生成 SVG 图");
  });
  it("reads disable-model-invocation: true", () => {
    const raw = `---\nname: X\ndisable-model-invocation: true\n---\nbody`;
    expect(parseSkillFrontmatter(raw).disableModelInvocation).toBe(true);
  });
  it("disable-model-invocation defaults falsy when absent", () => {
    expect(parseSkillFrontmatter(SKILL_MD("X")).disableModelInvocation).toBeFalsy();
  });
  it("returns {} when no frontmatter", () => {
    expect(parseSkillFrontmatter("just prose, no frontmatter")).toEqual({});
  });
  it("strips quotes around scalar values", () => {
    const raw = `---\nname: "Quoted Name"\ndescription: '单引号'\n---\nx`;
    const fm = parseSkillFrontmatter(raw);
    expect(fm.name).toBe("Quoted Name");
    expect(fm.description).toBe("单引号");
  });
});

// ---------------------------------------------------------------------------
// materializeSkill
// ---------------------------------------------------------------------------

describe("materializeSkill", () => {
  it("content source: writes to canon path + returns filePath/meta", async () => {
    const res = await materializeSkill({
      source: { kind: "content", content: SKILL_MD("Draw Diagram", "svg") },
      scope: "global",
      slug: "draw-diagram",
    });
    expect(res.name).toBe("Draw Diagram");
    expect(res.description).toBe("svg");
    expect(res.filePath).toBe(canonSkillPath("global", "draw-diagram"));
    expect(memfs.has(res.filePath)).toBe(true);
    expect(fsImpl.writeFileSync).toHaveBeenCalled();
  });

  it("builtin source: reads from given path then copies", async () => {
    const src = "/builtin/draw-diagram/SKILL.md";
    memfs.set(src, SKILL_MD("Draw Diagram"));
    const res = await materializeSkill({
      source: { kind: "builtin", path: src },
      scope: "team",
      slug: "draw-diagram",
      teamId: "t1",
    });
    expect(res.filePath).toBe(canonSkillPath("team", "draw-diagram", { teamId: "t1" }));
    expect(memfs.has(res.filePath)).toBe(true);
  });

  it("curated source: resolves entry.sourceFilePath via prisma", async () => {
    const src = "/curated/foo/SKILL.md";
    memfs.set(src, SKILL_MD("Foo"));
    (prisma.skillCuratedEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceFilePath: src,
      slug: "foo",
    });
    const res = await materializeSkill({
      source: { kind: "curated", entryId: "cur_x" },
      scope: "user",
      slug: "foo",
      userId: "u1",
    });
    expect(res.filePath).toBe(canonSkillPath("user", "foo", { userId: "u1" }));
    expect(res.name).toBe("Foo");
  });

  it("curated source: entry not found → CURATED_NOT_FOUND", async () => {
    (prisma.skillCuratedEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      materializeSkill({
        source: { kind: "curated", entryId: "nope" },
        scope: "global",
        slug: "x",
      }),
    ).rejects.toMatchObject({ code: "CURATED_NOT_FOUND" });
  });

  it("throws FRONTMATTER_MISSING_NAME when name absent", async () => {
    await expect(
      materializeSkill({
        source: { kind: "content", content: "---\ndescription: no name\n---\nbody" },
        scope: "global",
        slug: "x",
      }),
    ).rejects.toMatchObject({ code: "FRONTMATTER_MISSING_NAME" });
  });

  it("throws FRONTMATTER_MISSING_DESCRIPTION when description absent (P4.1)", async () => {
    await expect(
      materializeSkill({
        source: { kind: "content", content: "---\nname: NoDesc\n---\nbody" },
        scope: "global",
        slug: "x",
      }),
    ).rejects.toMatchObject({ code: "FRONTMATTER_MISSING_DESCRIPTION" });
  });

  it("throws SKILL_TOO_LARGE when content exceeds size limit (P4.3)", async () => {
    const huge = "---\nname: Big\ndescription: big\n---\n" + "x".repeat(600 * 1024);
    await expect(
      materializeSkill({
        source: { kind: "content", content: huge },
        scope: "global",
        slug: "big",
      }),
    ).rejects.toMatchObject({ code: "SKILL_TOO_LARGE" });
  });

  it("builtin source unreadable → SOURCE_UNREADABLE", async () => {
    await expect(
      materializeSkill({
        source: { kind: "builtin", path: "/nonexistent/SKILL.md" },
        scope: "global",
        slug: "x",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_UNREADABLE" });
  });

  it("git/npm source → NOT_IMPLEMENTED", async () => {
    await expect(
      materializeSkill({
        source: { kind: "git", url: "https://example/x.git" },
        scope: "global",
        slug: "x",
      }),
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });

  it("idempotent: same content → skip write", async () => {
    const content = SKILL_MD("Dup");
    await materializeSkill({
      source: { kind: "content", content },
      scope: "global",
      slug: "dup",
    });
    fsImpl.writeFileSync.mockClear();
    await materializeSkill({
      source: { kind: "content", content },
      scope: "global",
      slug: "dup",
    });
    expect(fsImpl.writeFileSync).not.toHaveBeenCalled();
  });

  it("overwrite when content changed", async () => {
    await materializeSkill({
      source: { kind: "content", content: SKILL_MD("V1") },
      scope: "global",
      slug: "ver",
    });
    const res = await materializeSkill({
      source: { kind: "content", content: SKILL_MD("V2") },
      scope: "global",
      slug: "ver",
    });
    expect(res.name).toBe("V2");
    expect(memfs.get(res.filePath)).toContain("V2");
  });
});

// ---------------------------------------------------------------------------
// syncSkillToSessionCwd
// ---------------------------------------------------------------------------

describe("syncSkillToSessionCwd", () => {
  it("copies each skill to <cwd>/.pi/skills/<slug>/SKILL.md", async () => {
    const cwd = "/session/workdir";
    const skillPath = canonSkillPath("global", "a");
    memfs.set(skillPath, SKILL_MD("A"));
    const skillPath2 = canonSkillPath("global", "b");
    memfs.set(skillPath2, SKILL_MD("B"));

    const res = await syncSkillToSessionCwd({
      cwd,
      skills: [
        { slug: "a", filePath: skillPath },
        { slug: "b", filePath: skillPath2 },
      ],
    });
    expect(res.synced).toEqual(["a", "b"]);
    expect(res.failed).toEqual([]);
    expect(memfs.has(`${cwd}/.pi/skills/a/SKILL.md`)).toBe(true);
    expect(memfs.has(`${cwd}/.pi/skills/b/SKILL.md`)).toBe(true);
  });

  it("empty skills → empty result", async () => {
    const res = await syncSkillToSessionCwd({ cwd: "/x", skills: [] });
    expect(res.synced).toEqual([]);
    expect(res.failed).toEqual([]);
  });

  it("missing source file → failed, others still sync", async () => {
    const cwd = "/s";
    const good = canonSkillPath("global", "good");
    memfs.set(good, SKILL_MD("Good"));
    const res = await syncSkillToSessionCwd({
      cwd,
      skills: [
        { slug: "good", filePath: good },
        { slug: "bad", filePath: "/missing/SKILL.md" },
      ],
    });
    expect(res.synced).toEqual(["good"]);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].slug).toBe("bad");
    expect(res.failed[0].reason).toMatch(/unreadable/);
  });

  it("empty filePath → failed with 'not materialized' reason", async () => {
    const res = await syncSkillToSessionCwd({
      cwd: "/s",
      skills: [{ slug: "x", filePath: "" }],
    });
    expect(res.synced).toEqual([]);
    expect(res.failed[0].reason).toMatch(/not materialized/);
  });

  it("idempotent: identical target → no rewrite", async () => {
    const cwd = "/s";
    const skillPath = canonSkillPath("global", "idem");
    memfs.set(skillPath, SKILL_MD("Idem"));
    await syncSkillToSessionCwd({ cwd, skills: [{ slug: "idem", filePath: skillPath }] });
    fsImpl.writeFileSync.mockClear();
    await syncSkillToSessionCwd({ cwd, skills: [{ slug: "idem", filePath: skillPath }] });
    expect(fsImpl.writeFileSync).not.toHaveBeenCalled();
  });

  it("MaterializeError is an Error subclass", () => {
    const e = new MaterializeError("x", "CODE");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("CODE");
  });
});
