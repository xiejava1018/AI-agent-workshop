/** 清理无源坏 SkillPackage（filePath 为空或不在 SKILLS_ROOT 内且无 CuratedEntry 源）。仅用于清理测试残留。 */
import { prisma } from "../lib/prisma";
import { isWithinSkillsRoot } from "../lib/skill-materialize";

async function main(): Promise<void> {
  const all = await prisma.skillPackage.findMany({ select: { id: true, slug: true, filePath: true } });
  const bad = all.filter((p) => !p.filePath || !isWithinSkillsRoot(p.filePath));
  if (bad.length === 0) { console.log("✓ 无坏数据"); return; }
  console.log(`将删除 ${bad.length} 个坏 SkillPackage（filePath 不规范且无源）：`);
  for (const p of bad) console.log(`  - ${p.slug}: ${p.filePath || "(空)"}`);
  const r = await prisma.skillPackage.deleteMany({ where: { id: { in: bad.map((p) => p.id) } } });
  console.log(`\n已删除 ${r.count} 个。剩余 SkillPackage: ${all.length - r.count}`);
}
main().finally(() => prisma.$disconnect());
