/** P1 数据验证：查 DB + 磁盘，确认 seedFromBuiltin 产物（不依赖 pi SDK）。 */
import { existsSync } from "fs";
import { prisma } from "../lib/prisma";
import { isWithinSkillsRoot, getSkillsRoot } from "../lib/skill-materialize";

async function main(): Promise<void> {
  console.log(`SKILLS_ROOT = ${getSkillsRoot()}\n`);

  console.log("[CuratedEntry] sourceKind=builtin:");
  const entries = await prisma.skillCuratedEntry.findMany({
    where: { sourceKind: "builtin" },
    select: { slug: true, sourceFilePath: true },
  });
  for (const e of entries) {
    const ok = !!e.sourceFilePath && existsSync(e.sourceFilePath) && isWithinSkillsRoot(e.sourceFilePath);
    console.log(`  ${ok ? "✓" : "✗"} ${e.slug}: ${e.sourceFilePath}`);
  }

  console.log("\n[SkillPackage] scope=global:");
  const pkgs = await prisma.skillPackage.findMany({
    where: { scope: "global" },
    select: { slug: true, filePath: true, source: true },
  });
  let okCount = 0;
  for (const p of pkgs) {
    const ok = !!p.filePath && existsSync(p.filePath) && isWithinSkillsRoot(p.filePath);
    if (ok) okCount++;
    console.log(`  ${ok ? "✓" : "✗"} ${p.slug} [${p.source}]: ${p.filePath || "(空)"}`);
  }
  console.log(`\n→ ${okCount}/${pkgs.length} SkillPackage 规范且落盘`);
}
main().finally(() => prisma.$disconnect());
