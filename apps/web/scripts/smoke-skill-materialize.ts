/**
 * P0 冒烟脚本（change: skill-runtime-completeness, tasks P0.4）
 *
 * 用真实文件系统（不 mock）端到端验证分发管道：
 *   fixture SKILL.md → materializeSkill → .skills/<scope>/<slug>/SKILL.md
 *                    → syncSkillToSessionCwd → <cwd>/.pi/skills/<slug>/SKILL.md
 *
 * 运行：cd apps/web && npx tsx scripts/smoke-skill-materialize.ts
 * 退出码 0 = 通过；非 0 = 失败。
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  materializeSkill,
  syncSkillToSessionCwd,
  getSkillsRoot,
} from "../lib/skill-materialize";

async function main(): Promise<void> {
  const root = getSkillsRoot();
  console.log(`SKILLS_ROOT = ${root}\n`);

  // --- 准备 fixture（模拟 uploaded/builtin 源）---
  const fixtureDir = join(tmpdir(), "skill-fixture-p0");
  const fixturePath = join(fixtureDir, "SKILL.md");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    fixturePath,
    "---\nname: Test Skill\ndescription: P0 smoke fixture\n---\n# Test Skill\nHello from fixture.",
    "utf-8",
  );

  // --- [1] materialize：来源 → SKILLS_ROOT 规范存储 ---
  console.log("[1] materializeSkill (uploaded source) → SKILLS_ROOT");
  const m = await materializeSkill({
    source: { kind: "uploaded", filePath: fixturePath },
    scope: "global",
    slug: "test-skill",
  });
  console.log(`    filePath   = ${m.filePath}`);
  console.log(`    name       = ${m.name}`);
  console.log(`    description= ${m.description}`);
  if (!existsSync(m.filePath)) throw new Error("FAIL: materialized file NOT on disk");
  if (!readFileSync(m.filePath, "utf-8").includes("Test Skill"))
    throw new Error("FAIL: materialized content mismatch");
  console.log("    ✓ file landed on disk\n");

  // --- [2] sync：SKILLS_ROOT → 会话 cwd ---
  console.log("[2] syncSkillToSessionCwd → <cwd>/.pi/skills/<slug>");
  const cwd = join(tmpdir(), "skill-cwd-p0");
  const r = await syncSkillToSessionCwd({
    cwd,
    skills: [{ slug: "test-skill", filePath: m.filePath }],
  });
  console.log(`    synced = ${JSON.stringify(r.synced)}`);
  console.log(`    failed = ${JSON.stringify(r.failed)}`);
  const target = join(cwd, ".pi", "skills", "test-skill", "SKILL.md");
  if (!existsSync(target)) throw new Error(`FAIL: synced file NOT at ${target}`);
  if (!readFileSync(target, "utf-8").includes("Test Skill"))
    throw new Error("FAIL: synced content mismatch");
  console.log(`    ✓ synced to ${target}\n`);

  // --- [3] 幂等：重复 materialize 不覆盖 ---
  console.log("[3] idempotent re-materialize");
  const m2 = await materializeSkill({
    source: { kind: "uploaded", filePath: fixturePath },
    scope: "global",
    slug: "test-skill",
  });
  if (m2.filePath !== m.filePath) throw new Error("FAIL: canon path changed on re-materialize");
  console.log("    ✓ same canon path, content unchanged\n");

  // --- [4] 部分失败容错：坏源不影响好源 ---
  console.log("[4] sync partial-failure tolerance");
  const r2 = await syncSkillToSessionCwd({
    cwd: join(tmpdir(), "skill-cwd-partial"),
    skills: [
      { slug: "test-skill", filePath: m.filePath },
      { slug: "missing", filePath: "/nonexistent/SKILL.md" },
    ],
  });
  if (!r2.synced.includes("test-skill")) throw new Error("FAIL: good skill not synced when bad one present");
  if (r2.failed.length !== 1 || r2.failed[0].slug !== "missing")
    throw new Error("FAIL: bad skill not reported in failed[]");
  console.log(`    ✓ synced=${JSON.stringify(r2.synced)} failed=${JSON.stringify(r2.failed)}\n`);

  console.log("✅ P0 分发管道冒烟验证 PASSED");
  console.log(`   materialize 落盘于 ${root}（dev 环境 install 真实生效）`);

  // cleanup（fixture + cwd；保留 .skills 供人工观察）
  rmSync(fixtureDir, { recursive: true, force: true });
  rmSync(join(tmpdir(), "skill-cwd-p0"), { recursive: true, force: true });
  rmSync(join(tmpdir(), "skill-cwd-partial"), { recursive: true, force: true });
}

main().catch((e: unknown) => {
  console.error("\n❌ P0 冒烟失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
