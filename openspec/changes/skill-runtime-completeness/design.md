# 设计：Skill 系统运行时完善（Skill Runtime Completeness）

> change: skill-runtime-completeness
> 日期：2026-08-02
> 配套：`proposal.md`、`tasks.md`
> 前置：`openspec/changes/skill-curated-library/`（运营层，已完成）

---

## 0. TL;DR

Skill 系统的**数据层**和**触发机制**都已完整，唯独缺了**SKILL.md 文件的物理分发链路**——文件从未被放到运行时能找到的地方，导致 agent 绑定的 skill 名存实亡。本设计以「打通分发管道」为核心，串联起数字员工与 Agent 工作台两个消费场景，并补齐反馈闭环与治理规范。

---

## 1. 背景与目标

### 1.1 两个核心使用场景

| 场景 | 入口 | 用户期望 |
|------|------|----------|
| **数字员工（Digital Employee）** | `/digital-employees` 创建/编辑 agent，在「Skill 配置」tab 绑定 | 这个 agent 在被（人或 Supervisor）调用时，自动具备绑定 skill 的能力 |
| **Agent 工作台（Workbench）** | `/agent-workbench` 以某数字员工身份（或临时身份）开会话 | 在对话里用 `/skill:slug` 显式触发，或让模型自动调用已启用 skill |

### 1.2 设计目标

- **G1 可用**：绑定到数字员工的 skill，在任何部署环境都能被真正加载执行（不依赖开发机绝对路径）。
- **G2 可移植**：`SKILLS_ROOT` 成为可移植的规范存储；curated/install/seed/git/npm/zip 所有来源最终都汇聚到这里。
- **G3 可追溯**：前端能清楚看到「这条 skill 从哪来（curated/ builtin/ uploaded/ git）、属于哪个 scope、被哪个 agent 绑定」。
- **G4 可治理**：有 frontmatter 规范、scope 组织约定、权限矩阵。
- **G5 可度量**：记录 skill 调用结果，支撑精选库排序。

### 1.3 非目标

见 `proposal.md`「不做什么」。

---

## 2. 现状分析

### 2.1 已经实现且稳定（不要重写）

```
数据层（schema.prisma）
  SkillPackage         运行时实际加载的包 (slug + scope + filePath)
  SkillCuratedEntry    运营精选库条目 (slug + sourceFilePath/sourceKind/...)
  AgentSkillBinding    agent↔skill 绑定 (mode: inherit|include|exclude)
  AgentMcpBinding      agent↔mcp 绑定
  SkillInvocation      调用审计 (仅 skillPackageId/userId/sessionId/createdAt)

触发层（lib/）
  skill-invoke.ts      显式 /skill:<slug> 或 @skill:<slug> → buildSkillInjection
  skill-block.ts       模型自决 <skill name=..> 块 → resolveSkillBlock + 权威替换
  安全：path-traversal 防护、多租户 scope(user>team>global)、
        disable-model-invocation 标志、磁盘权威内容替换(防篡改)
```

### 2.2 运行时驱动链（已实现）

```
Agent 行 (systemPrompt, model, scope)
   │
   │  startRpcSession(agentId, userId, teamId)
   ▼
resolveAgentSkills(agentId)        四层解析: agent.include ⊕ team ⊕ user ⊖ agent.exclude
   │  → string[] (slug 列表)
   ▼
buildResourceLoaderOptions(scope)  lib/rpc-manager.ts:124
   │  additionalSkillPaths = slug.map(s => `.pi/skills/${s}`)
   ▼
createAgentSessionServices(cwd, resourceLoaderOptions)
   │
   ▼
pi SDK DefaultResourceLoader 从 <cwd>/.pi/skills/{slug} 加载 SKILL.md
```

### 2.3 三个断点（核心问题所在）

| # | 位置 | 现状 | 后果 |
|---|------|------|------|
| **断点 A** | `app/api/skills/install/route.ts` `handleScopedInstall` | 只 `prisma.skillPackage.create`，**不复制 SKILL.md**；`filePath` 可为空 | DB 里有绑定，磁盘上没有文件 |
| **断点 B** | `prisma/seed/curated-skills.ts` | `sourceFilePath` 硬编码 `/Users/xiejava/.pi/agent/skills/...`（开发机绝对路径，且**不在 SKILLS_ROOT 内**，会被 `isValidSkillFilePath` 拒绝） | 部署到别的机器/容器即失效 |
| **断点 C** | `lib/rpc-manager.ts` `buildResourceLoaderOptions` | 只产出相对路径 `.pi/skills/{slug}`，**从不复制文件到 `<cwd>`**；注释自承"missing paths are silently ignored by the SDK" | pi SDK 在会话 cwd 下找不到文件，静默忽略 → agent 绑定的 skill 实际不生效 |

**一句话**：A、B 让「源文件」进不了规范存储；C 让「规范存储」进不了「会话 cwd」。整条链路在中间断开。

---

## 3. 核心设计：SKILL.md 分发管道

### 3.1 总体架构（三层 + 管道）

```
┌─────────────────────────────────────────────────────────────────────┐
│  ① 来源层 (Sources)                                                  │
│   builtin(~/.pi/agent/skills)  curated(CuratedEntry)  uploaded(zip) │
│   git(url)  npm(pkg)  手写编辑器(future)                              │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  materializeSkill()  ← 本期新增(核心)
┌───────────────────────────▼─────────────────────────────────────────┐
│  ② 注册层 (Registry) —— 可移植规范存储 SKILLS_ROOT                    │
│   .skills/global/{slug}/SKILL.md                                     │
│   .skills/team/{teamId}/{slug}/SKILL.md                              │
│   .skills/user/{userId}/{slug}/SKILL.md                              │
│   ← SkillPackage.filePath 指向这里(规范相对/绝对路径)                  │
│   ← SkillCuratedEntry.sourceFilePath 仍是"来源指针",不直接消费         │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  syncSkillToSessionCwd()  ← 本期新增(核心)
┌───────────────────────────▼─────────────────────────────────────────┐
│  ③ 运行时层 (Runtime)                                                │
│   <session-cwd>/.pi/skills/{slug}/SKILL.md  ← pi SDK 真正加载这里      │
│   ↓                                                                   │
│   pi resourceLoader: frontmatter → system prompt (模型自决可见)       │
│   /skill:slug (显式)  /  <skill> 块 (模型自决) → 已有触发层接管        │
└─────────────────────────────────────────────────────────────────────┘
```

**关键原则**：`SKILLS_ROOT` 是**唯一可信存储**（single source of truth）。所有来源的 SKILL.md 最终都要 materialize 到这里；所有运行时消费都从这里读。

### 3.2 `materializeSkill()` —— 来源→规范存储（修复断点 A、B）

新增 `lib/skill-materialize.ts`，职责：把任意来源的 SKILL.md 复制/下载到 `SKILLS_ROOT` 规范路径，返回规范化 `filePath`。

```ts
// lib/skill-materialize.ts (NEW)

const SKILLS_ROOT = resolve(process.env.SKILLS_ROOT ?? "./.skills");

/** 规范化存储路径：按 scope 隔离 */
export function canonSkillPath(scope: "global" | "team" | "user", slug: string, ctx: {
  teamId?: string | null;
  userId?: string | null;
}): string {
  const base =
    scope === "global" ? join(SKILLS_ROOT, "global", slug)
    : scope === "team" ? join(SKILLS_ROOT, "team", ctx.teamId!, slug)
    : join(SKILLS_ROOT, "user", ctx.userId!, slug);
  return join(base, "SKILL.md");
}

export type SkillSource =
  | { kind: "builtin"; path: string }                 // 本机 ~/.pi/agent/skills/foo/SKILL.md
  | { kind: "curated"; entryId: string }              // 指向 CuratedEntry.sourceFilePath
  | { kind: "uploaded"; zipPath: string }             // 上传的 zip(暂存路径)
  | { kind: "git"; url: string }
  | { kind: "npm"; pkg: string };

/**
 * 把来源 SKILL.md materialize 到 SKILLS_ROOT 规范路径。
 * - 幂等：已存在且内容 hash 相同则跳过
 * - 校验 frontmatter 必填字段(name),缺失则抛错
 * - 返回规范 filePath(供 SkillPackage.filePath 存储与运行时消费)
 */
export async function materializeSkill(opts: {
  source: SkillSource;
  scope: "global" | "team" | "user";
  slug: string;
  teamId?: string | null;
  userId?: string | null;
}): Promise<{ filePath: string; name: string; description: string }>;
```

**调用点改造**：

| 调用点 | 改造 |
|--------|------|
| `POST /api/skills/install`（slug 模式） | `handleScopedInstall` 内：先 `materializeSkill` 得到 filePath，再 `skillPackage.create`。filePath 必非空且在 SKILLS_ROOT 内。 |
| `seed-from-builtin` | 扫描 builtin 路径，对每个 `materializeSkill({scope:'global'})`，并把 CuratedEntry.sourceFilePath **改存 SKILLS_ROOT 规范路径**（不再存开发机绝对路径）。 |
| `POST /api/skills/install`（zip 上传） | 解压暂存 → `materializeSkill`。 |

### 3.3 `syncSkillToSessionCwd()` —— 规范存储→会话 cwd（修复断点 C）

在 `startRpcSession` 解析出 agent 绑定的 `SkillPackage[]` 后、`buildResourceLoaderOptions` 之前，把每个 skill 文件铺到 cwd：

```ts
// lib/skill-materialize.ts (续)

/**
 * 会话启动前，把 agent 绑定的 skill 文件复制到 <cwd>/.pi/skills/{slug}/SKILL.md。
 * 必须在 createAgentSessionServices 之前调用，否则 pi 加载时文件还不存在。
 * - 源：SkillPackage.filePath（已在 SKILLS_ROOT 内，规范路径）
 * - 幂等：内容 hash 相同跳过
 * - 失败：单个 skill 失败不阻断会话，记 warn + 记 SkillInvocation(outcome=error)
 */
export async function syncSkillToSessionCwd(opts: {
  cwd: string;
  skills: Array<{ slug: string; filePath: string }>;
}): Promise<{ synced: string[]; failed: Array<{ slug: string; reason: string }> }>;
```

`startRpcSession` 改造（伪代码）：

```ts
// lib/rpc-manager.ts  startRpcSession(...)
const resolvedPackages = await resolveAgentSkillPackages(agentId, userId, teamId);
// ↓ 新增：铺文件到 cwd
const { synced } = await syncSkillToSessionCwd({
  cwd,
  skills: resolvedPackages.map(p => ({ slug: p.slug, filePath: p.filePath })),
});
const loaderOpts = buildResourceLoaderOptions({
  skills: synced,  // 只把成功铺好的 slug 传给 pi
  mcpServers: resolvedMcp,
});
```

> **注意**：`buildResourceLoaderOptions` 现状参数是 `skills: string[]`（slug），改造后传 `synced`（已铺文件的 slug 子集），避免 pi 拿到不存在的路径。

### 3.4 Skill 全生命周期

```
        创建/获取                 注册(materialize)        绑定                运行(sync+触发)         度量
┌──────────────────┐        ┌─────────────────┐    ┌──────────────┐    ┌──────────────────┐    ┌──────────┐
│ builtin/curated/ │──来源──▶│  SKILLS_ROOT    │──▶│ AgentSkill   │──▶│ <cwd>/.pi/skills │──▶│Outcome   │
│ uploaded/git/npm │        │  SkillPackage   │    │ Binding      │    │ pi 加载+触发      │    │写回      │
└──────────────────┘        │  .filePath      │    └──────────────┘    └──────────────────┘    │Invocation│
                            └─────────────────┘           ▲                                      └──────────┘
                                     ▲                    │ 也可被 UserSkillBinding 绑定到用户
                                     │                    │   (工作台「我的 skill」)
                            SkillCuratedEntry            │
                            (运营展示, sourceFilePath     │
                             仍指来源; install 时触发    │
                             materialize 并记 installCount)│
```

---

## 4. 两个消费场景的落地方案

### 4.1 数字员工场景

**绑定（已有 UI）**：`digital-employees/index.vue`「Skill 配置」tab 多选 `SkillPackage` → `POST /api/digital-employees` 带 `skillBindings` → 创建 `AgentSkillBinding(mode='inherit')`（现状默认 inherit；解析时非 exclude 即生效）。

**运行（本期修复）**：数字员工被调用（人工开会话 或 Supervisor 委托）→ `startRpcSession` → §3.3 `syncSkillToSessionCwd` 铺文件 → pi 加载 → 模型可见 skill frontmatter。

**统一来源展示（本期增强）**：`GET /api/digital-employees/[id]` 返回的 `skillBindings` 扩展，每个绑定带 `{ slug, name, scope, source, curated?: {...} }`，让 UI 能标注来源。

```
┌─ 数字员工详情 · Skill 配置 tab ─────────────────────────────┐
│ ┌────────────────────────────────────────────────────────┐ │
│ │ 📊 draw-diagram        [global] [builtin]    ⚙ 解除绑定  │ │
│ │    生成 SVG 架构图/流程图                                 │ │
│ ├────────────────────────────────────────────────────────┤ │
│ │ 🛡 threat-hunt         [team: Default] [uploaded] ⚙    │ │
│ │    安全威胁狩猎                                           │ │
│ └────────────────────────────────────────────────────────┘ │
│ [+ 添加 Skill]  ← 弹出精选库 picker(可按 scope/category 筛) │
└────────────────────────────────────────────────────────────┘
```

### 4.2 Agent 工作台场景

**现状**：`SkillsConfig.vue` 读 `<cwd>/.pi/skills/` 本地文件列表（即 §3.3 铺好的文件），可勾选启用。

**统一视图（本期增强）**：工作台 skill 面板展示**三来源合并**：

| 来源 | 含义 | 可操作 |
|------|------|--------|
| **数字员工绑定** | 当前会话身份（某 agent）绑定的 skill，已自动 sync 到 cwd | 只读（在数字员工页改） |
| **用户 skill** | `UserSkillBinding`，用户级常驻 | 启用/禁用 |
| **cwd 本地** | 会话 cwd 下手工放的 SKILL.md | 启用/禁用 |

每条标注来源徽标，避免「为什么这个 skill 自动出现了」的困惑。

**触发**（已有，无需改）：输入框 `/skill:draw-diagram <prompt>` 显式；或模型自决 `<skill>` 块。

### 4.3 Skill vs MCP 的边界（心智模型）

| 维度 | Skill | MCP |
|------|-------|-----|
| 本质 | 给 LLM 的**指令/流程知识** | 给 LLM 的**工具/外部能力** |
| 形态 | SKILL.md（文本） | 运行的 server（stdio/sse/http） |
| 改变 | 它**怎么想/怎么做** | 它**能调什么** |
| 配置入口 | 数字员工「Skill 配置」tab | 数字员工「MCP 配置」tab |
| 示例 | code-review 流程、threat-hunt 方法论 | filesystem 读写、数据库查询 |

UI 保持两个 tab 分离（现状已对），文档与提示文案统一用此心智模型。

---

## 5. 反馈闭环（修复度量缺口）

### 5.1 `SkillInvocation` 扩展

现状 `SkillInvocation` 只记 `skillPackageId/userId/sessionId/createdAt`，无结果。扩展：

```prisma
model SkillInvocation {
  id             String   @id @default(cuid())
  skillPackageId String
  userId         String?
  sessionId      String?
  // ↓ 新增
  triggerKind    String   @default("explicit")   // explicit(/skill:) | model(<skill>块) | auto(session-start)
  outcome        String   @default("pending")     // pending | success | error | timeout
  errorMessage   String   @default("")
  durationMs     Int      @default(0)
  tokenIn        Int      @default(0)
  tokenOut       Int      @default(0)
  createdAt      DateTime @default(now())

  @@index([skillPackageId])
  @@index([outcome])
}
```

### 5.2 写入点

| 时机 | 写法 |
|------|------|
| `/skill:` 显式触发 | `skill-invoke.buildSkillInjection` 内已写 `SkillInvocation`，扩展 outcome 字段，会话结束/出错时回填 |
| 模型自决 `<skill>` 块 | `skill-block.resolveSkillBlock` 内新增写入 |
| 会话 sync 失败 | §3.3 `syncSkillToSessionCwd` 失败时写 `outcome='error'` |

### 5.3 消费

- `SkillCuratedEntry.installCount` 由「成功 invocation 计数」+「install 计数」聚合，定期物化（避免 N+1）。
- 工作台/数字员工页展示「最近 7 天调用 N 次，成功率 M%」。

---

## 6. 治理与规范

### 6.1 SKILL.md frontmatter 约定

```yaml
---
name: draw-diagram              # 必填，展示名
description: 生成 SVG 架构图...   # 必填，给 LLM 看的 skill 摘要(进 system prompt)
version: 1.0.0
author: skill-team
category: development            # development|security|productivity|general
tags: [svg, diagram]
disable-model-invocation: false  # true = 只能 /skill: 显式触发,禁止模型自调
---
# 正文：给 LLM 的详细指令（pi 风格）
```

- `materializeSkill` 校验 `name`/`description` 必填，缺失拒绝（400/422）。
- `disable-model-invocation: true` 用于敏感/不可控 skill，强制人工显式触发。

### 6.2 Scope 组织约定

| Scope | 用途 | 谁能创建 |
|-------|------|----------|
| `global` | 平台通用 skill，所有团队复用 | platform OWNER |
| `team` | 团队私有 skill（业务领域知识） | team OWNER/ADMIN |
| `user` | 个人实验性 skill | 任何用户（仅自己） |

解析优先级（已有）：`user > team > global`，同名时高优先级覆盖。

### 6.3 权限矩阵（沿用现有 + 明确）

| 操作 | platform OWNER | team ADMIN | team MEMBER | 普通 user |
|------|---------------|------------|-------------|-----------|
| 浏览 curated 精选库 | ✅ | ✅ | ✅ | ✅ |
| install global skill | ✅ | ❌ | ❌ | ❌ |
| install team skill | ✅ | ✅(本队) | ❌ | ❌ |
| install user skill | ✅ | ✅ | ✅ | ✅(仅自己) |
| 绑定到数字员工 | ✅ | ✅(本队 agent) | ✅(本队 agent) | ✅(个人 agent) |
| seed-from-builtin | ✅ | ❌ | ❌ | ❌ |
| 删除/下架 curated | ✅ | ❌ | ❌ | ❌ |

---

## 7. 数据模型变更总览

```prisma
// schema.prisma 改动

// 1. SkillInvocation 扩展（§5.1）—— migration
model SkillInvocation { ... +triggerKind +outcome +errorMessage +durationMs +tokenIn +tokenOut }

// 2. SkillPackage —— 无 schema 改动,仅约束 filePath 必须在 SKILLS_ROOT 内(应用层校验)
//    现有 filePath String @default("") 保留,但 install 时强制非空

// 3. SkillCuratedEntry —— 无 schema 改动,seed 数据把 sourceFilePath 改为 SKILLS_ROOT 规范路径
```

迁移文件：`prisma/migrations/{ts}_skill_invocation_outcome/migration.sql`

```sql
ALTER TABLE "SkillInvocation"
  ADD COLUMN "triggerKind" TEXT NOT NULL DEFAULT 'explicit',
  ADD COLUMN "outcome"     TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "errorMessage" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "durationMs"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tokenIn"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tokenOut"    INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "SkillInvocation_outcome_idx" ON "SkillInvocation"("outcome");
```

回滚：`DROP COLUMN ...`（新列全有 default，回滚安全）。

---

## 8. API 契约变更

### 8.1 `POST /api/skills/install`（改造）

Request 增加来源字段（替代裸 filePath）：

```json
{
  "slug": "draw-diagram",
  "scope": "global",
  "source": { "kind": "curated", "entryId": "cur_xxx" }
  // 或 { "kind": "builtin", "path": "/..." }
  // 或 { "kind": "uploaded", "zipPath": "/tmp/xxx.zip" }
}
```

Response 201：

```json
{
  "skill": {
    "id": "...", "slug": "...", "filePath": ".skills/global/draw-diagram/SKILL.md", ...
  },
  "materialized": true
}
```

后端：`materializeSkill(source) → filePath → skillPackage.create`。

### 8.2 `POST /api/admin/curated-skills/seed-from-builtin`（改造）

seed 时对每个 builtin skill 执行 `materializeSkill({scope:'global'})`，CuratedEntry.sourceFilePath 改存规范路径；同时 upsert 对应 global SkillPackage（让 builtin 直接可绑）。

### 8.3 `GET /api/digital-employees/[id]`（增强）

`skillBindings[]` 每项扩展：

```json
{
  "skillPackageId": "...", "slug": "draw-diagram", "mode": "include",
  "name": "Draw Diagram", "scope": "global", "source": "builtin",
  "curated": { "icon": "📊", "summary": "...", "category": "development" } | null
}
```

### 8.4 `GET /api/skills?cwd=`（增强，工作台三来源合并）

返回结构分组：

```json
{
  "agentBound": [ {slug,name,agentId,agentName,...} ],   // 来自会话身份 agent
  "user":       [ {...} ],                                // UserSkillBinding
  "local":      [ {...} ]                                 // cwd 本地文件
}
```

### 8.5 `GET /api/skills/[id]/stats`（新增，度量）

```json
{ "totalInvocations": 42, "successRate": 0.93, "last7d": 12, "lastUsedAt": "..." }
```

---

## 9. 安全模型（沿用 + 强化）

| 威胁 | 防护（现状） | 本期强化 |
|------|-------------|----------|
| Path traversal | `safeReadSkillFile` 校验 filePath 在 SKILLS_ROOT 内 | install 时 `materializeSkill` 只写规范路径，杜绝越界 |
| 跨租户访问 | `resolveSkillPackageBySlug` 按 user>team>global 过滤 | 不变 |
| 模型篡改 skill 内容 | `skill-block` 用磁盘权威内容替换模型 `<skill>` 块 | 不变（权威内容现在来自 SKILLS_ROOT） |
| 不可信 skill 静默自调 | `disable-model-invocation` 标志 | 不变 |
| 上传恶意 SKILL.md | — | `materializeSkill` 校验 frontmatter + 体积上限 + 内容 sanitize（future） |

---

## 10. 分阶段实施路线

> 详见 `tasks.md`。阶段间可独立交付、独立回滚。

| 阶段 | 主题 | 核心交付 | 价值 |
|------|------|----------|------|
| **P0** | 分发管道打通 | `materializeSkill` + install 改造 + `syncSkillToSessionCwd` + startRpcSession 改造 | **让绑定的 skill 真正生效**（解决 G1，最高优先） |
| **P1** | curated 数据修正 | 重跑 seed-from-builtin 落到 SKILLS_ROOT + 提供存量数据迁移脚本 | 解决部署可移植性（G2） |
| **P2** | 来源追溯 UI | digital-employees 详情 + 工作台三来源合并视图 | G3 |
| **P3** | 反馈闭环 | SkillInvocation 扩展 + 写入 + stats API + UI 展示 | G5 |
| **P4** | 治理规范 | frontmatter 校验落地 + 文档 + 权限矩阵复核 | G4 |

**建议先做 P0**：它是最小可用闭环，做完即可验证「数字员工绑定 skill → 工作台触发」整条链路。P1-P4 可并行/增量。

---

## 11. 风险与回滚

| 风险 | 缓解 |
|------|------|
| P0 改 `startRpcSession` 影响所有会话 | `syncSkillToSessionCwd` 失败不阻断会话（只 warn）；可加 env flag `SKILL_SYNC_ENABLED` 灰度 |
| 存量 SkillPackage.filePath 为空或为开发机路径 | P1 提供迁移脚本：对每条空 filePath，按 slug 从 curated/builtin 重新 materialize 回填 |
| SKILLS_ROOT 在容器内不可写 | 部署文档约定挂载持久卷；env `SKILLS_ROOT` 指向卷；P0 加启动健康检查 |
| skill 文件同步到 cwd 造成 cwd 污染 | 文件放在 `<cwd>/.pi/skills/`（pi 约定目录），会话结束可选清理（`cleanupSessionCwd`，future） |
| 回滚 | P0 改动集中在 `skill-materialize.ts`(新文件) + 3 处调用点；回滚 = 还原调用点 + 删新文件。DB 无破坏性改动（P3 才有 migration，独立） |

---

## 12. 关键文件清单（本期涉及）

```
apps/web/lib/skill-materialize.ts                    [NEW] 核心:materializeSkill + syncSkillToSessionCwd + canonSkillPath
apps/web/lib/rpc-manager.ts                          [MOD] startRpcSession 调 syncSkillToSessionCwd;buildResourceLoaderOptions 收敛 synced slugs
apps/web/app/api/skills/install/route.ts             [MOD] handleScopedInstall 调 materializeSkill
apps/web/app/api/admin/curated-skills/seed-from-builtin/route.ts [MOD] seed 落 SKILLS_ROOT + sourceFilePath 规范化
apps/web/prisma/seed/curated-skills.ts               [MOD] sourceFilePath 改规范路径(或改由 seed 路由运行时生成)
apps/web/prisma/migrations/{ts}_skill_invocation_outcome/ [NEW] P3
apps/web/lib/skill-invoke.ts                         [MOD] P3:写 outcome
apps/web/lib/skill-block.ts                          [MOD] P3:写 outcome
apps/web/app/api/skills/route.ts                     [MOD] P2:三来源合并
apps/web/app/api/skills/[id]/stats/route.ts          [NEW] P3
apps/web/app/api/digital-employees/[id]/route.ts     [MOD] P2:skillBindings 扩展来源

apps/dashboard/src/views/digital-employees/index.vue [MOD] P2:来源徽标 + skill picker
apps/dashboard/src/views/agent-workbench/components/SkillsConfig.vue [MOD] P2:三来源分组

docs/design/skill-system.md                          [NEW] 本文档对外版(可选)
```

---

## 13. 验收标准（Definition of Done）

- [ ] **P0**：创建一个数字员工，绑定 `draw-diagram` skill → 开会话 → 输入 `/skill:draw-diagram 画个登录流程` → 模型按 SKILL.md 指令产出。e2e 测试覆盖。
- [ ] **P0**：新环境（无开发机路径）部署后，seed-from-builtin 跑完，skill 全部可加载。
- [ ] **P1**：迁移脚本对存量空 filePath 的 SkillPackage 全部回填成功。
- [ ] **P2**：数字员工详情 + 工作台均能正确展示 skill 来源徽标。
- [ ] **P3**：触发 skill 后，`GET /api/skills/[id]/stats` 返回正确计数与成功率。
- [ ] 全部新测通过；既有 324 测试不回归。
