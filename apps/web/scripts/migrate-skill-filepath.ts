/**
 * P1.3 存量迁移脚本（change: skill-runtime-completeness）
 *
 * 修复历史 SkillPackage.filePath 为空 或 指向开发机绝对路径（不在 SKILLS_ROOT 内）
 * 的行。对每个坏行：按 slug 找 CuratedEntry 或回退到旧 filePath → materialize 到
 * SKILLS_ROOT 规范路径 → 回填 filePath。
 *
 * 幂等：可重复运行，已规范的行不会被改动。
 *
 * 运行：cd apps/web && npx tsx scripts/migrate-skill-filepath.ts
 */
import { prisma } from "../lib/prisma";
import {
  materializeSkill,
  isWithinSkillsRoot,
  type SkillScope,
} from "../lib/skill-materialize";

const VALID_SCOPES: ReadonlySet<string> = new Set(["global", "team", "user"]);

async function main(): Promise<void> {
  const all = await prisma.skillPackage.findMany({
    select: { id: true, slug: true, name: true, description: true, scope: true, teamId: true, userId: true, filePath: true },
  });
  const bad = all.filter((p) => !p.filePath || !isWithinSkillsRoot(p.filePath));

  console.log(`扫描 SkillPackage ${all.length} 个，需迁移 ${bad.length} 个\n`);
  if (bad.length === 0) {
    console.log("✓ 无需迁移，所有 filePath 均已规范。");
    return;
  }

  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (const pkg of bad) {
    const tag = `${pkg.slug} [${pkg.scope}]`;
    try {
      if (!VALID_SCOPES.has(pkg.scope)) {
        console.warn(`  SKIP ${tag}: 未知 scope "${pkg.scope}"`);
        skipped++;
        continue;
      }
      const scope = pkg.scope as SkillScope;

      // 定位源文件路径：优先 CuratedEntry.sourceFilePath，回退到旧 filePath
      const entry = await prisma.skillCuratedEntry.findUnique({
        where: { slug: pkg.slug },
        select: { sourceFilePath: true },
      });
      const sourcePath =
        entry?.sourceFilePath ||
        (pkg.filePath && !isWithinSkillsRoot(pkg.filePath) ? pkg.filePath : null);

      if (!sourcePath) {
        console.warn(`  SKIP ${tag}: 无 curated entry 且 filePath 为空，无法定位源`);
        skipped++;
        continue;
      }

      const m = await materializeSkill({
        source: { kind: "builtin", path: sourcePath },
        scope,
        slug: pkg.slug,
        teamId: pkg.teamId,
        userId: pkg.userId,
      });
      await prisma.skillPackage.update({
        where: { id: pkg.id },
        data: { filePath: m.filePath, name: pkg.name || m.name, description: pkg.description || m.description },
      });
      console.log(`  FIXED ${tag}: ${pkg.filePath || "(空)"} → ${m.filePath}`);
      fixed++;
    } catch (e) {
      console.error(`  FAIL ${tag}: ${e instanceof Error ? e.message : e}`);
      failed++;
    }
  }

  console.log(`\n完成：fixed=${fixed} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e: unknown) => {
    console.error("迁移脚本异常:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
