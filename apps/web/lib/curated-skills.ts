// lib/curated-skills.ts
//
// 技能精选库 service layer (运营/治理层)
//
// 设计:openspec/changes/skill-curated-library/design.md §2 / §3
// 与 SkillPackage 分离:精选库是"运营/治理视图",SkillPackage 是"运行时实际安装的包"
//
// API 路由统一在此实现 5 个核心操作,Route Handlers 只做参数校验 + 鉴权 + 调 service,
// 避免在路由里写 SQL。
import fs from "fs";
import os from "os";
import path from "path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { prisma } from "./prisma";

// -----------------------------------------------------------------------------
// Types (公共 API 出口)
// -----------------------------------------------------------------------------

export type SourceKind = "builtin" | "uploaded" | "generated" | "npm" | "git";

export interface CuratedSkillMeta {
  id: string;
  slug: string;
  name: string;
  description: string;
  summary: string;
  category: string;
  tags: string[];
  icon: string;
  version: string;
  author: string;
  sourceKind: SourceKind;
  sourceBuiltinPath: string;
  sourceFilePath: string;
  sourceUrl: string;
  visibility: string;
  featured: boolean;
  enabled: boolean;
  installCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListCuratedFilters {
  category?: string;
  tag?: string;
  featured?: boolean;
  enabled?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ListCuratedResult {
  entries: CuratedSkillMeta[];
  total: number;
  limit: number;
  offset: number;
}

export interface UpsertCuratedInput {
  slug: string;
  name: string;
  description?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  icon?: string;
  version?: string;
  author?: string;
  sourceKind?: SourceKind;
  sourceFilePath?: string;
  sourceBuiltinPath?: string;
  sourceUrl?: string;
  visibility?: string;
  featured?: boolean;
  enabled?: boolean;
  installCount?: number;
}

export interface SeedFromBuiltinResult {
  created: number;
  updated: number;
  skipped: number;
  total: number;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const SLUG_RE = /^[a-z0-9-]+$/;

const VALID_SOURCE_KINDS: ReadonlyArray<SourceKind> = [
  "builtin",
  "uploaded",
  "generated",
  "npm",
  "git",
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function toMeta(row: {
  id: string;
  slug: string;
  name: string;
  description: string;
  summary: string;
  category: string;
  tags: string[];
  icon: string;
  version: string;
  author: string;
  sourceKind: string;
  sourceFilePath: string;
  sourceBuiltinPath: string;
  sourceUrl: string;
  visibility: string;
  featured: boolean;
  enabled: boolean;
  installCount: number;
  createdAt: Date;
  updatedAt: Date;
}): CuratedSkillMeta {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    summary: row.summary,
    category: row.category,
    tags: row.tags,
    icon: row.icon,
    version: row.version,
    author: row.author,
    sourceKind: (VALID_SOURCE_KINDS as readonly string[]).includes(
      row.sourceKind,
    )
      ? (row.sourceKind as SourceKind)
      : "builtin",
    sourceFilePath: row.sourceFilePath,
    sourceBuiltinPath: row.sourceBuiltinPath,
    sourceUrl: row.sourceUrl,
    visibility: row.visibility,
    featured: row.featured,
    enabled: row.enabled,
    installCount: row.installCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertValidSlug(slug: string): void {
  if (!slug || !SLUG_RE.test(slug)) {
    throw new CuratedSkillError(400, "slug must match ^[a-z0-9-]+$");
  }
}

function assertValidSourceKind(kind: string | undefined): void {
  if (kind === undefined) return;
  if (!(VALID_SOURCE_KINDS as readonly string[]).includes(kind)) {
    throw new CuratedSkillError(
      400,
      `sourceKind must be one of: ${VALID_SOURCE_KINDS.join(", ")}`,
    );
  }
}

export class CuratedSkillError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// -----------------------------------------------------------------------------
// Public service API
// -----------------------------------------------------------------------------

/**
 * 列表 + 多维过滤。
 * 默认 enabled=true (不返回软删);默认按 featured DESC, updatedAt DESC 排序。
 */
export async function listCuratedEntries(
  filters: ListCuratedFilters = {},
): Promise<ListCuratedResult> {
  const limit = Math.min(
    Math.max(filters.limit ?? DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const offset = Math.max(filters.offset ?? 0, 0);

  const where: Record<string, unknown> = {};
  if (filters.category) where.category = filters.category;
  if (typeof filters.featured === "boolean") where.featured = filters.featured;
  if (typeof filters.enabled === "boolean") {
    where.enabled = filters.enabled;
  } else {
    where.enabled = true;
  }
  if (filters.tag) where.tags = { has: filters.tag };
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: "insensitive" } },
      { slug: { contains: filters.q, mode: "insensitive" } },
      { description: { contains: filters.q, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.skillCuratedEntry.findMany({
      where,
      orderBy: [{ featured: "desc" }, { updatedAt: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.skillCuratedEntry.count({ where }),
  ]);

  return {
    entries: rows.map(toMeta),
    total,
    limit,
    offset,
  };
}

/** 按 slug 取详情(单条,允许 enabled=false 用于软删后回看)。 */
export async function getCuratedEntryBySlug(
  slug: string,
): Promise<CuratedSkillMeta | null> {
  const row = await prisma.skillCuratedEntry.findUnique({ where: { slug } });
  return row ? toMeta(row) : null;
}

/** 按 id 取详情。 */
export async function getCuratedEntryById(
  id: string,
): Promise<CuratedSkillMeta | null> {
  const row = await prisma.skillCuratedEntry.findUnique({ where: { id } });
  return row ? toMeta(row) : null;
}

/** 按 sourceFilePath 批量取(供 GET /api/skills join 用)。 */
export async function getCuratedEntriesBySourceFilePaths(
  paths: string[],
): Promise<Map<string, CuratedSkillMeta>> {
  if (paths.length === 0) return new Map();
  const rows = await prisma.skillCuratedEntry.findMany({
    where: {
      sourceFilePath: { in: paths },
      enabled: true,
    },
  });
  const map = new Map<string, CuratedSkillMeta>();
  for (const row of rows) {
    if (row.sourceFilePath) map.set(row.sourceFilePath, toMeta(row));
  }
  return map;
}

/** Upsert by slug;若有同 sourceFilePath 但不同 slug,409 冲突。 */
export async function upsertCuratedEntry(
  input: UpsertCuratedInput,
  createdBy: string | null = null,
): Promise<CuratedSkillMeta> {
  // 兼容保留 (seed-from-builtin 内部仍可调用)。实际路由层用 createCuratedEntry /
  // updateCuratedEntry 显式区分语义。
  return createCuratedEntry(input, createdBy);
}

/** 严格 create: slug 已存在 → 409。 */
export async function createCuratedEntry(
  input: UpsertCuratedInput,
  createdBy: string | null = null,
): Promise<CuratedSkillMeta> {
  assertValidSlug(input.slug);
  assertValidSourceKind(input.sourceKind);

  const existing = await prisma.skillCuratedEntry.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  });
  if (existing) {
    throw new CuratedSkillError(409, `slug "${input.slug}" already exists`);
  }

  if (input.sourceFilePath) {
    const collide = await prisma.skillCuratedEntry.findFirst({
      where: { sourceFilePath: input.sourceFilePath },
      select: { id: true, slug: true },
    });
    if (collide) {
      throw new CuratedSkillError(
        409,
        `sourceFilePath already bound to entry "${collide.slug}"`,
      );
    }
  }

  const data = {
    slug: input.slug,
    name: input.name,
    description: input.description ?? "",
    summary: input.summary ?? "",
    category: input.category ?? "general",
    tags: input.tags ?? [],
    icon: input.icon ?? "",
    version: input.version ?? "1.0.0",
    author: input.author ?? "",
    sourceKind: input.sourceKind ?? "builtin",
    sourceFilePath: input.sourceFilePath ?? "",
    sourceBuiltinPath: input.sourceBuiltinPath ?? "",
    sourceUrl: input.sourceUrl ?? "",
    visibility: input.visibility ?? "global",
    featured: input.featured ?? false,
    enabled: input.enabled ?? true,
    installCount: input.installCount ?? 0,
    createdBy,
  };

  const row = await prisma.skillCuratedEntry.create({ data });
  return toMeta(row);
}

/** 按 id 更新;未提供字段保留原值。 */
export async function updateCuratedEntry(
  id: string,
  patch: Partial<UpsertCuratedInput>,
): Promise<CuratedSkillMeta> {
  const existing = await prisma.skillCuratedEntry.findUnique({
    where: { id },
    select: { id: true, sourceFilePath: true },
  });
  if (!existing) throw new CuratedSkillError(404, "entry not found");

  if (patch.sourceKind !== undefined) assertValidSourceKind(patch.sourceKind);

  if (
    patch.sourceFilePath !== undefined &&
    patch.sourceFilePath &&
    patch.sourceFilePath !== existing.sourceFilePath
  ) {
    const collide = await prisma.skillCuratedEntry.findFirst({
      where: {
        sourceFilePath: patch.sourceFilePath,
        NOT: { id: existing.id },
      },
      select: { id: true, slug: true },
    });
    if (collide) {
      throw new CuratedSkillError(
        409,
        `sourceFilePath already bound to entry "${collide.slug}"`,
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.summary !== undefined) data.summary = patch.summary;
  if (patch.category !== undefined) data.category = patch.category;
  if (patch.tags !== undefined) data.tags = patch.tags;
  if (patch.icon !== undefined) data.icon = patch.icon;
  if (patch.version !== undefined) data.version = patch.version;
  if (patch.author !== undefined) data.author = patch.author;
  if (patch.sourceKind !== undefined) data.sourceKind = patch.sourceKind;
  if (patch.sourceFilePath !== undefined)
    data.sourceFilePath = patch.sourceFilePath;
  if (patch.sourceBuiltinPath !== undefined)
    data.sourceBuiltinPath = patch.sourceBuiltinPath;
  if (patch.sourceUrl !== undefined) data.sourceUrl = patch.sourceUrl;
  if (patch.visibility !== undefined) data.visibility = patch.visibility;
  if (patch.featured !== undefined) data.featured = patch.featured;
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.installCount !== undefined) data.installCount = patch.installCount;

  const row = await prisma.skillCuratedEntry.update({
    where: { id: existing.id },
    data,
  });
  return toMeta(row);
}

/** 软删:enabled=false,不删行。返回更新后的 entry;不存在则 404。 */
export async function softDeleteCuratedEntry(id: string): Promise<CuratedSkillMeta> {
  const existing = await prisma.skillCuratedEntry.findUnique({ where: { id } });
  if (!existing) throw new CuratedSkillError(404, "entry not found");
  const row = await prisma.skillCuratedEntry.update({
    where: { id },
    data: { enabled: false },
  });
  return toMeta(row);
}

// -----------------------------------------------------------------------------
// seed-from-builtin
// -----------------------------------------------------------------------------

interface ParsedSkill {
  slug: string;
  name: string;
  description: string;
  sourceFilePath: string;
  sourceBuiltinPath: string;
}

function builtinRoots(): string[] {
  const roots: string[] = [
    path.resolve(process.cwd(), "..", "dashboard", "skills"),
    path.join(os.homedir(), ".pi", "agent", "skills"),
    path.join(os.homedir(), ".claude", "skills"),
  ];
  return roots.filter((root) => {
    try {
      return fs.existsSync(root);
    } catch {
      return false;
    }
  });
}

function* walkSkills(root: string): Generator<ParsedSkill> {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[curated-skills] builtin root unreadable, skip ${root}:`, err);
    return;
  }
  for (const entry of entries) {
    const skillDir = path.join(root, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(skillDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    let content: string;
    try {
      content = fs.readFileSync(skillFile, "utf8");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[curated-skills] unreadable ${skillFile}:`, err);
      continue;
    }
    const parsed = parseFrontmatter(content);
    if ("error" in parsed) {
      // eslint-disable-next-line no-console
      console.warn(
        `[curated-skills] frontmatter parse failed at ${skillFile}:`,
        parsed.error,
      );
      continue;
    }
    const fm = parsed.frontmatter as Record<string, unknown>;
    const name = typeof fm.name === "string" ? fm.name : entry;
    const description =
      typeof fm.description === "string" ? fm.description : "";
    yield {
      slug: entry,
      name,
      description,
      sourceFilePath: skillFile,
      sourceBuiltinPath: skillDir,
    };
  }
}

/** 内部用:seed-from-builtin 的 upsert by sourceFilePath。slug 已存在则跳过不重写 (slug 是治理标识)。 */
async function upsertBySourceFilePath(parsed: {
  slug: string;
  name: string;
  description: string;
  sourceFilePath: string;
  sourceBuiltinPath: string;
}): Promise<"created" | "updated"> {
  const existing = await prisma.skillCuratedEntry.findFirst({
    where: { sourceFilePath: parsed.sourceFilePath },
    select: { id: true },
  });
  if (existing) {
    await prisma.skillCuratedEntry.update({
      where: { id: existing.id },
      data: {
        name: parsed.name,
        description: parsed.description,
      },
    });
    return "updated";
  }
  await prisma.skillCuratedEntry.create({
    data: {
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      summary: "",
      category: "general",
      tags: [],
      icon: "",
      version: "1.0.0",
      author: "",
      sourceKind: "builtin",
      sourceFilePath: parsed.sourceFilePath,
      sourceBuiltinPath: parsed.sourceBuiltinPath,
      visibility: "global",
      featured: false,
      enabled: true,
      installCount: 0,
    },
  });
  return "created";
}

/** 扫 3 个 builtin 目录,按 sourceFilePath 幂等 upsert。 */
export async function seedFromBuiltin(): Promise<SeedFromBuiltinResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let total = 0;

  for (const root of builtinRoots()) {
    for (const parsed of walkSkills(root)) {
      total++;
      try {
        const action = await upsertBySourceFilePath(parsed);
        if (action === "created") created++;
        else updated++;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[curated-skills] seed-from-builtin upsert failed for ${parsed.slug}:`,
          err,
        );
        skipped++;
      }
    }
  }

  return { created, updated, skipped, total };
}

/** 取分类聚合(带计数),仅统计 enabled=true。 */
export async function getCategoriesWithCounts(): Promise<
  Array<{ category: string; count: number }>
> {
  const rows = await prisma.skillCuratedEntry.groupBy({
    by: ["category"],
    where: { enabled: true },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ category: r.category, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}