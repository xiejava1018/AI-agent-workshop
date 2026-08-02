#!/usr/bin/env -S npx tsx
/**
 * SkillCuratedEntry 种子脚本(幂等 upsert by slug)
 *
 * 5 条示例精选条目,覆盖每种 sourceKind 各一,参考
 * ~/AIproject/tf-soc-agent/backend/marketplace-skills/{asset_query,code-viewer,
 * draw-diagram,threat-hunt,test-zip-import}
 *
 * 字段语义:design.md §2 / proposal.md §2
 *
 * 运行:cd apps/web && pnpm tsx prisma/seed/curated-skills.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface CuratedSeed {
  slug: string;
  name: string;
  description: string;
  summary: string;
  category: string;
  tags: string[];
  icon: string;
  version: string;
  author: string;
  sourceKind: "builtin" | "uploaded" | "generated" | "npm" | "git";
  sourceFilePath: string;
  sourceBuiltinPath: string;
  featured: boolean;
  enabled: boolean;
}

const SEEDS: CuratedSeed[] = [
  {
    slug: "draw-diagram",
    name: "Draw Diagram",
    description:
      "Generate production-quality SVG technical diagrams exported as PNG via rsvg-convert. Supports architecture, flowchart, sequence, agent/memory, concept-map styles.",
    summary: "生成 SVG 架构图 / 流程图,导出 PNG",
    category: "development",
    tags: ["svg", "diagram", "architecture", "flowchart"],
    icon: "📊",
    version: "1.0.0",
    author: "Skill Developer",
    sourceKind: "builtin",
    sourceFilePath: "",
    sourceBuiltinPath: "~/.pi/agent/skills/draw-diagram",
    featured: true,
    enabled: true,
  },
  {
    slug: "code-viewer",
    name: "Code Viewer",
    description:
      "Open and read source files in any cwd with syntax highlighting and chunked output. Useful for code review sessions.",
    summary: "在 Agent 会话中按需浏览源码片段",
    category: "development",
    tags: ["code-review", "reading", "syntax"],
    icon: "🔍",
    version: "1.0.0",
    author: "Skill Developer",
    sourceKind: "builtin",
    sourceFilePath: "",
    sourceBuiltinPath: "~/.pi/agent/skills/code-viewer",
    featured: false,
    enabled: true,
  },
  {
    slug: "asset-query",
    name: "Asset Query",
    description:
      "Asset provenance: search and trace the origin of an asset across the workspace. Supports queries by ID, tag, owner, time range.",
    summary: "资产溯源,跨工作区追踪来源",
    category: "productivity",
    tags: ["asset", "review", "trace"],
    icon: "📦",
    version: "1.0.0",
    author: "chenke",
    sourceKind: "generated",
    sourceFilePath: "",
    sourceBuiltinPath: "~/.pi/agent/skills/asset_query",
    featured: false,
    enabled: true,
  },
  {
    slug: "threat-hunt",
    name: "Threat Hunt",
    description:
      "Security-focused: hypothesis-driven hunt over logs, alerts, and asset data. Produces structured findings with confidence levels.",
    summary: "安全威胁狩猎,生成结构化发现",
    category: "security",
    tags: ["security", "threat-hunt", "siem"],
    icon: "🛡️",
    version: "1.0.0",
    author: "soc-team",
    sourceKind: "uploaded",
    sourceFilePath: "",
    sourceBuiltinPath: "~/.pi/agent/skills/threat-hunt",
    featured: true,
    enabled: true,
  },
  {
    slug: "test-zip-import",
    name: "Test Zip Import",
    description:
      "Test fixture: a synthetic skill used by the SkillMarketplace import-from-zip test plan. Not meant for production use.",
    summary: "测试夹具,验证 zip 上传导入流程",
    category: "general",
    tags: ["test", "fixture", "import"],
    icon: "🧪",
    version: "0.0.1",
    author: "QA Bot",
    sourceKind: "npm",
    sourceFilePath: "",
    sourceBuiltinPath: "~/.pi/agent/skills/test-zip-import",
    featured: false,
    enabled: false, // 软删示例
  },
];

async function upsert(seed: CuratedSeed): Promise<"created" | "updated"> {
  const existing = await prisma.skillCuratedEntry.findUnique({
    where: { slug: seed.slug },
    select: { id: true, updatedAt: true },
  });
  if (existing) {
    await prisma.skillCuratedEntry.update({
      where: { slug: seed.slug },
      data: { ...seed, createdBy: null },
    });
    return "updated";
  }
  await prisma.skillCuratedEntry.create({
    data: { ...seed, createdBy: null },
  });
  return "created";
}

async function main(): Promise<void> {
  let created = 0;
  let updated = 0;
  for (const seed of SEEDS) {
    const action = await upsert(seed);
    // eslint-disable-next-line no-console
    console.log(`[${action}] ${seed.slug} (${seed.sourceKind})`);
    if (action === "created") created++;
    else updated++;
  }
  const total = await prisma.skillCuratedEntry.count();
  const enabledCount = await prisma.skillCuratedEntry.count({
    where: { enabled: true },
  });
  const featuredCount = await prisma.skillCuratedEntry.count({
    where: { featured: true },
  });
  // eslint-disable-next-line no-console
  console.log("\n" + "=".repeat(60));
  // eslint-disable-next-line no-console
  console.log(
    `Curated skill seed done. created=${created} updated=${updated} ` +
      `total=${total} enabled=${enabledCount} featured=${featuredCount}`,
  );
  // eslint-disable-next-line no-console
  console.log("=".repeat(60));
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[FAIL]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());