// lib/skill-materialize.ts
//
// Skill 系统运行时分发管道核心（change: skill-runtime-completeness, P0）。
//
// 现状问题（design.md §2.3 三个断点）：
//   - install 只写 DB 不落盘
//   - curated seed 指向开发机绝对路径
//   - rpc-manager 只留 .pi/skills/{slug} 占位相对路径，从不复制文件
//   → pi SDK 在会话 cwd 下找不到 SKILL.md，静默忽略，agent 绑定的 skill 名存实亡
//
// 本模块补齐「来源 → 规范存储 → 会话 cwd」两段管道：
//   1. materializeSkill()  把任意来源的 SKILL.md 复制到 SKILLS_ROOT 规范路径
//   2. syncSkillToSessionCwd()  会话启动前把绑定 skill 铺到 <cwd>/.pi/skills/{slug}
//
// 设计原则：
//   - SKILLS_ROOT 是唯一可信存储（single source of truth）
//   - 全程幂等（内容 sha256 相同则跳过）
//   - 单个 skill 失败不阻断整体（sync 收集 failed[] 而非抛错）
//   - sync fs API + 正则解析 frontmatter，与现有 skill-invoke/skill-block 风格一致，易 mock

import { createHash } from "crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "fs";
import { resolve, join, dirname, relative, sep } from "path";
import { prisma } from "./prisma";

/** 规范存储根目录，与 skill-invoke.ts 保持一致（env 覆盖，默认 ./.skills）。 */
const SKILLS_ROOT = resolve(process.env.SKILLS_ROOT ?? "./.skills");

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** materialize 过程中的错误（源文件缺失 / frontmatter 非法 / 联网失败等）。 */
export class MaterializeError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "MaterializeError";
  }
}

// ---------------------------------------------------------------------------
// Skill 来源
// ---------------------------------------------------------------------------

/**
 * Skill 来源。所有来源最终都解析成「一段 SKILL.md 文本」交给 materializeSkill。
 * - builtin:  本机 ~/.pi/agent/skills/foo/SKILL.md（开发内置）
 * - curated:  指向 SkillCuratedEntry.sourceFilePath（运营精选库）
 * - uploaded: 已落盘的暂存 SKILL.md 路径（zip 解压后 / 表单上传）
 * - content:  直接给内容（测试 / 在线编辑器用）
 * - git/npm:  远程来源（P0 未实现，抛 NotImplemented）
 */
export type SkillSource =
  | { kind: "builtin"; path: string }
  | { kind: "curated"; entryId: string }
  | { kind: "uploaded"; filePath: string }
  | { kind: "content"; content: string }
  | { kind: "git"; url: string }
  | { kind: "npm"; pkg: string };

export type SkillScope = "global" | "team" | "user";

export interface SkillScopeContext {
  teamId?: string | null;
  userId?: string | null;
}

export interface MaterializeResult {
  /** SKILLS_ROOT 下的规范绝对路径，存入 SkillPackage.filePath。 */
  filePath: string;
  /** 从 frontmatter 解析出的展示名（必填字段）。 */
  name: string;
  /** 从 frontmatter 解析出的描述（可空）。 */
  description: string;
  /** frontmatter 里的 disable-model-invocation 标志（透传给上层）。 */
  disableModelInvocation: boolean;
}

// ---------------------------------------------------------------------------
// 规范路径
// ---------------------------------------------------------------------------

/**
 * 计算 SKILLS_ROOT 下的规范存储路径，按 scope 隔离：
 *   global → <SKILLS_ROOT>/global/<slug>/SKILL.md
 *   team   → <SKILLS_ROOT>/team/<teamId>/<slug>/SKILL.md
 *   user   → <SKILLS_ROOT>/user/<userId>/<slug>/SKILL.md
 */
export function canonSkillPath(
  scope: SkillScope,
  slug: string,
  ctx: SkillScopeContext = {},
): string {
  const base =
    scope === "global"
      ? join(SKILLS_ROOT, "global", slug)
      : scope === "team"
        ? join(SKILLS_ROOT, "team", ctx.teamId ?? "_unknown", slug)
        : join(SKILLS_ROOT, "user", ctx.userId ?? "_unknown", slug);
  return join(base, "SKILL.md");
}

/**
 * 校验路径是否在 SKILLS_ROOT 内（防 path traversal）。
 * 与 skill-invoke.safeReadSkillFile 同样的语义。
 */
export function isWithinSkillsRoot(filePath: string): boolean {
  if (!filePath) return false;
  const candidate = resolve(filePath);
  const rel = relative(SKILLS_ROOT, candidate);
  return !(rel.startsWith(`..${sep}`) || rel === ".." || rel.includes(`..${sep}`));
}

// ---------------------------------------------------------------------------
// Frontmatter 解析（与 skill-block.ts 风格一致的正则提取，不引入 yaml 依赖）
// ---------------------------------------------------------------------------

export interface ParsedFrontmatter {
  name?: string;
  description?: string;
  disableModelInvocation?: boolean;
}

/**
 * 从 SKILL.md 文本中提取 YAML frontmatter 中的 name / description /
 * disable-model-invocation。容错：无 frontmatter 或字段缺失时返回 {}。
 */
export function parseSkillFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm = match[1];
  return {
    name: extractYamlScalar(fm, "name"),
    description: extractYamlScalar(fm, "description"),
    disableModelInvocation: /disable-model-invocation:\s*true/i.test(fm),
  };
}

/** 提取 frontmatter 里的标量字段值（去引号、去首尾空白）。 */
function extractYamlScalar(fm: string, key: string): string | undefined {
  const re = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m");
  const m = fm.match(re);
  if (!m) return undefined;
  return m[1].replace(/^["']|["']$/g, "");
}

// ---------------------------------------------------------------------------
// 来源内容解析
// ---------------------------------------------------------------------------

/**
 * 把 SkillSource 解析成原始 SKILL.md 文本。
 * - builtin / uploaded: 直接读磁盘
 * - curated: 查 SkillCuratedEntry.sourceFilePath 后读磁盘
 * - content: 直接返回
 * - git / npm: P0 未实现
 */
async function resolveSourceContent(source: SkillSource): Promise<string> {
  switch (source.kind) {
    case "builtin":
      return readOrThrow(source.path, "builtin source path");
    case "uploaded":
      return readOrThrow(source.filePath, "uploaded filePath");
    case "content":
      return source.content;
    case "curated": {
      const entry = await prisma.skillCuratedEntry.findUnique({
        where: { id: source.entryId },
        select: { sourceFilePath: true, slug: true },
      });
      if (!entry) {
        throw new MaterializeError(
          `curated entry not found: ${source.entryId}`,
          "CURATED_NOT_FOUND",
        );
      }
      if (!entry.sourceFilePath) {
        throw new MaterializeError(
          `curated entry ${source.entryId} has no sourceFilePath`,
          "CURATED_NO_PATH",
        );
      }
      return readOrThrow(entry.sourceFilePath, "curated sourceFilePath");
    }
    case "git":
    case "npm":
      throw new MaterializeError(
        `${source.kind} source not implemented yet`,
        "NOT_IMPLEMENTED",
      );
    default:
      throw new MaterializeError(
        `unknown source kind: ${(source as { kind: string }).kind}`,
        "UNKNOWN_SOURCE",
      );
  }
}

/** 读取文件，失败抛带上下文的 MaterializeError。 */
function readOrThrow(path: string, label: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    throw new MaterializeError(
      `failed to read ${label}: ${path}`,
      "SOURCE_UNREADABLE",
    );
  }
}

// ---------------------------------------------------------------------------
// materializeSkill —— 来源 → SKILLS_ROOT 规范存储
// ---------------------------------------------------------------------------

export interface MaterializeOptions {
  source: SkillSource;
  scope: SkillScope;
  slug: string;
  teamId?: string | null;
  userId?: string | null;
}

/**
 * 把来源 SKILL.md 复制到 SKILLS_ROOT 规范路径。
 *
 * 步骤：读源 → 校验 frontmatter(name 必填) → 计算目标路径 → 幂等检查(sha256) → 落盘。
 *
 * @returns 规范 filePath + 解析出的元数据，供 SkillPackage.filePath 存储
 * @throws {MaterializeError} 源不可读 / frontmatter 缺 name / 落盘失败
 */
export async function materializeSkill(
  opts: MaterializeOptions,
): Promise<MaterializeResult> {
  const { source, scope, slug, teamId = null, userId = null } = opts;

  const rawContent = await resolveSourceContent(source);
  const fm = parseSkillFrontmatter(rawContent);
  if (!fm.name) {
    throw new MaterializeError(
      `SKILL.md for slug "${slug}" missing required frontmatter field: name`,
      "FRONTMATTER_MISSING_NAME",
    );
  }

  const targetPath = canonSkillPath(scope, slug, { teamId, userId });
  const sourceHash = sha256(rawContent);

  // 幂等：目标已存在且内容一致 → 跳过写盘
  if (existsSync(targetPath)) {
    try {
      const existing = readFileSync(targetPath, "utf-8");
      if (sha256(existing) === sourceHash) {
        return {
          filePath: targetPath,
          name: fm.name,
          description: fm.description ?? "",
          disableModelInvocation: !!fm.disableModelInvocation,
        };
      }
    } catch {
      // 目标读失败 → 继续走覆盖写
    }
  }

  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, rawContent, "utf-8");
  } catch (err) {
    throw new MaterializeError(
      `failed to write skill to ${targetPath}: ${err instanceof Error ? err.message : String(err)}`,
      "WRITE_FAILED",
    );
  }

  return {
    filePath: targetPath,
    name: fm.name,
    description: fm.description ?? "",
    disableModelInvocation: !!fm.disableModelInvocation,
  };
}

// ---------------------------------------------------------------------------
// syncSkillToSessionCwd —— 规范存储 → 会话 cwd（修复断点 C）
// ---------------------------------------------------------------------------

export interface SyncSkill {
  slug: string;
  /** SKILLS_ROOT 下的规范路径（SkillPackage.filePath）。 */
  filePath: string;
}

export interface SyncResult {
  /** 成功铺到 cwd 的 slug 列表（按输入顺序）。 */
  synced: string[];
  /** 失败项及原因。单个失败不阻断其他 skill。 */
  failed: Array<{ slug: string; reason: string }>;
}

/**
 * 会话启动前，把 agent 绑定的 skill 文件复制到 <cwd>/.pi/skills/<slug>/SKILL.md。
 * 必须在 createAgentSessionServices 之前调用，否则 pi 加载时文件还不存在。
 *
 * 行为：
 *   - 源文件缺失/不可读 → 记 failed，不抛错
 *   - 幂等：目标内容 sha256 一致则跳过写盘
 *   - 返回 synced slug 子集，调用方只把 synced 的 slug 传给 pi
 *
 * @param cwd 会话工作目录（pi 在此加载 .pi/skills）
 */
export async function syncSkillToSessionCwd(opts: {
  cwd: string;
  skills: SyncSkill[];
}): Promise<SyncResult> {
  const synced: string[] = [];
  const failed: Array<{ slug: string; reason: string }> = [];

  for (const s of opts.skills) {
    try {
      if (!s.filePath) {
        failed.push({ slug: s.slug, reason: "empty filePath (skill not materialized?)" });
        continue;
      }
      const sourceContent = readOrThrowSync(s.filePath);
      const target = join(opts.cwd, ".pi", "skills", s.slug, "SKILL.md");

      // 幂等：内容一致跳过
      if (existsSync(target)) {
        try {
          const existing = readFileSync(target, "utf-8");
          if (sha256(existing) === sha256(sourceContent)) {
            synced.push(s.slug);
            continue;
          }
        } catch {
          // 目标读失败 → 继续覆盖写
        }
      }

      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, sourceContent, "utf-8");
      synced.push(s.slug);
    } catch (err) {
      failed.push({
        slug: s.slug,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { synced, failed };
}

/** 读文件，失败抛 Error（sync 内部捕获为 failed 项）。 */
function readOrThrowSync(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    throw new Error(`source unreadable: ${path}`);
  }
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** 暴露 SKILLS_ROOT 给外部（install 路由校验 / 健康检查）。 */
export function getSkillsRoot(): string {
  return SKILLS_ROOT;
}
