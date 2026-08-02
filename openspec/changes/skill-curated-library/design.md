# 设计：技能精选库（Skill Curated Library）

> change: skill-curated-library
> 日期：2026-07-26
> 配套：proposal.md、apps/web/prisma/seed/menus.ts:185-190

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/dashboard (Vue3 + Element Plus + Pinia)                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  /admin/skill (SkillCuratedView.vue)                          │ │
│  │    ├─ CuratedToolbar (搜索 + 类别 tab + view-toggle)         │ │
│  │    ├─ CuratedList (grid | table 视图)                        │ │
│  │    ├─ CuratedDetail (drawer: 描述 / tags / featured toggle)   │ │
│  │    └─ CuratedEditor (新增 / 编辑 modal, OWNER only)           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  Pinia store: useSkillCuratedStore                               │
│    ├─ entries, categories, loading, error                        │
│    ├─ filters: { category, tag, featured, q }                    │
│    └─ actions: fetchList / fetchDetail / create / update / delete │
└───────────────────────────┬─────────────────────────────────────┘
                            │  /api/admin/curated-skills/*
┌───────────────────────────▼─────────────────────────────────────┐
│  apps/web (Next.js 16 / Route Handlers + Prisma)                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  app/api/admin/curated-skills/route.ts                          │ │
│  │    ├─ GET   list?category=&tag=&featured=&q=                  │ │
│  │    └─ POST  create       (OWNER only)                         │ │
│  │  app/api/admin/curated-skills/[id]/route.ts                    │ │
│  │    ├─ GET   detail                                            │ │
│  │    ├─ PATCH update   (OWNER only)                              │ │
│  │    └─ DELETE soft-del (OWNER only, enabled=false)              │ │
│  │  app/api/admin/curated-skills/categories/route.ts              │ │
│  │    └─ GET   aggregated categories with counts                  │ │
│  │  app/api/admin/curated-skills/seed-from-builtin/route.ts       │ │
│  │    └─ POST  upsert from filesystem, idempotent (OWNER only)    │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  lib/curated-skills.ts (核心 service)                              │
│    ├─ listCuratedEntries({category?,tag?,featured?,q?})           │
│    ├─ getCuratedEntryBySlug(slug)                                 │
│    ├─ upsertCuratedEntry(input)                                   │
│    ├─ softDeleteCuratedEntry(id)                                  │
│    └─ seedFromBuiltin()                                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │  Prisma
┌───────────────────────────▼─────────────────────────────────────┐
│  PostgreSQL                                                      │
│  new table: SkillCuratedEntry                                    │
│    id / slug / name / description / summary / category / tags / │
│    icon / version / author / sourceBuiltinPath / sourceFilePath /│
│    sourceKind / visibility / featured / enabled / installCount /  │
│    createdAt / updatedAt                                         │
│  既有表保持不动: SkillPackage / SkillInvocation / McpServer       │
└─────────────────────────────────────────────────────────────────┘
```

数据流：

1. **首次** Owner 调 `POST /api/admin/curated-skills/seed-from-builtin` → service 扫 `apps/dashboard/skills/` + `~/.pi/agent/skills/`，解析每个 `SKILL.md` frontmatter → upsert by `sourceFilePath`
2. **浏览** dashboard `/admin/skill` → 前端 `GET /api/admin/curated-skills?category=development` → 后端 SQL 过滤 → 返回 entries 列表 → Vue 渲染
3. **运营** Owner 点编辑 → `PATCH /api/admin/curated-skills/[id]` body `{ featured: true, summary: "推荐" }` → 后端鉴权 + Prisma update → 200 OK + 新条目
4. **消费** apps/web `GET /api/skills?cwd=` 内部 join `SkillCuratedEntry` by `sourceFilePath` → `SkillsConfig.tsx` 渲染 curated summary/tags（如有）

## 2. 数据模型（Prisma）

```prisma
// M3.5 — SkillCuratedEntry: 平台精选的技能展示条目,独立于 SkillPackage。
// 一条 entry 可指向一个 builtin Skill、一个已上传 Skill、一个 git/npm
// 远程 Skill,或纯描述的"概念能力"(尚未实现 source 落盘)。
// 与 SkillPackage 不同:精选库是"运营/治理层",SkillPackage 是"运行时实际
// 加载的包";一个精选条目可被 0..N 个 SkillPackage 实际安装。
model SkillCuratedEntry {
  id                 String   @id @default(cuid())
  slug               String   @unique
  name               String
  description        String   @default("")
  summary            String   @default("")  // 卡片副标题,<= 200 字
  category           String   @default("general") // development|security|productivity|...
  tags               String[] @default([]) // Postgres text[]
  icon               String   @default("")  // emoji 或 icon 标识符
  version            String   @default("1.0.0")
  author             String   @default("")
  sourceKind         String   @default("builtin") // builtin|uploaded|generated|npm|git
  sourceFilePath     String   @default("")   // builtin / uploaded SKILL.md 绝对路径
  sourceBuiltinPath  String   @default("")   // builtin 类别(如 ~/.pi/agent/skills/foo/SKILL.md)
  sourceUrl          String   @default("")   // git/npm 来源 URL
  visibility         String   @default("global") // global(预留 team/user)
  featured           Boolean  @default(false) // 精选推荐位
  enabled            Boolean  @default(true)  // 软删/下架
  installCount       Int      @default(0)     // 累计安装计数(预留)
  createdBy          String?  // User.id
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([category])
  @@index([featured])
  @@index([enabled])
}
```

不引入关联表 `SkillCuratedTag`：tags 是 Postgres `text[]`，GIN index 由 Prisma `@@index([tags])` 不可用（`text[]` 不能直接 B-tree index 但 Gin index 需要 `@db.Text` + raw migration），本期先不索引，靠客户端 `WHERE tags @> ARRAY['x']` 简单过滤，必要时再上 GIN。

## 3. API 契约

### 3.1 `GET /api/admin/curated-skills`

Query 参数（全部可选）：
- `category` string — 类别过滤
- `tag` string — tags contains
- `featured` boolean — featured-only
- `enabled` boolean（默认 true）
- `q` string — name / slug / description 模糊匹配
- `limit` int（默认 50，上限 200）
- `offset` int（默认 0）

Response 200：

```json
{
  "entries": [
    {
      "id": "cur_xxx",
      "slug": "draw-diagram",
      "name": "Draw Diagram",
      "description": "Generate production-quality SVG technical diagrams ...",
      "summary": "生成 SVG 架构图/流程图,导出 PNG",
      "category": "development",
      "tags": ["svg", "diagram", "architecture"],
      "icon": "📊",
      "version": "1.0.0",
      "author": "Skill Developer",
      "sourceKind": "builtin",
      "sourceBuiltinPath": "/Users/xiejava/.pi/agent/skills/draw-diagram/SKILL.md",
      "visibility": "global",
      "featured": true,
      "enabled": true,
      "installCount": 0,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 5,
  "limit": 50,
  "offset": 0
}
```

### 3.2 `POST /api/admin/curated-skills`

Request：

```json
{
  "slug": "draw-diagram",
  "name": "Draw Diagram",
  "description": "...",
  "summary": "...",
  "category": "development",
  "tags": ["svg", "diagram"],
  "icon": "📊",
  "version": "1.0.0",
  "author": "...",
  "sourceKind": "builtin",
  "sourceFilePath": "...",
  "sourceBuiltinPath": "...",
  "featured": false,
  "enabled": true
}
```

Response 201：返回 entry；409：slug 冲突；403：非 OWNER。

### 3.3 `PATCH /api/admin/curated-skills/[id]`

Body 同 POST，但任意子集。仅 OWNER；404：id 不存在。

### 3.4 `DELETE /api/admin/curated-skills/[id]`

软删：`enabled = false, updatedAt = now()`。204；403：非 OWNER；404：不存在。

### 3.5 `GET /api/admin/curated-skills/categories`

Response：

```json
{
  "categories": [
    { "category": "development", "count": 3 },
    { "category": "security", "count": 1 },
    { "category": "general", "count": 1 }
  ]
}
```

### 3.6 `POST /api/admin/curated-skills/seed-from-builtin`

扫描路径（按顺序）：
1. `<dashboard>/skills/*/SKILL.md`（项目内置）
2. `~/.pi/agent/skills/*/SKILL.md`（user 全局）
3. `~/.claude/skills/*/SKILL.md`（Claude 兼容）

解析 frontmatter（YAML），按 `sourceFilePath` upsert。

Response 200：`{ created: 3, updated: 2, skipped: 0 }`。

### 3.7 改造 `GET /api/skills?cwd=`

在返回的 `skills[]` 每个元素新增可选字段：

```ts
{
  name: "draw-diagram",
  filePath: "/.../SKILL.md",
  baseDir: "...",
  disableModelInvocation: false,
  sourceInfo: { source: "builtin", scope: "global" },
  curated: {
    id: "cur_xxx",
    slug: "draw-diagram",
    summary: "生成 SVG 架构图/流程图,导出 PNG",
    tags: ["svg", "diagram"],
    category: "development",
    icon: "📊",
    featured: true
  } | null
}
```

`curated` join 策略：内存中用 `Map<sourceFilePath, SkillCuratedEntry>`，避免 N+1；不对 builtin 路径做 normalize（精确匹配）。

## 4. UI 设计（apps/dashboard）

### 4.1 `/admin/skill` 页面布局

```
┌─ SkillCuratedView ─────────────────────────────────────────────────┐
│ ┌─ CuratedToolbar ──────────────────────────────────────────────┐ │
│ │ [🔍 搜索...] [全部|dev|sec|prod] [☑ Featured] [Table | Card]   │ │
│ │                                       [+ 新增] [🔄 Seed] (OWNER)│ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ┌─ CuratedList (Card 视图) ──────────────────────────────────────┐ │
│ │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │ │
│ │ │ 📊       │ │ 🔍       │ │ 🖼       │ │ ⚠        │            │ │
│ │ │ draw-... │ │ code-vw  │ │ threat-..│ │ asset_q  │            │ │
│ │ │ 生SVG图  │ │ 看源码   │ │ 威胁狩猎 │ │ 资产溯源 │            │ │
│ │ │ ⭐Featured│ │          │ │          │ │          │            │ │
│ │ │ [toggle] │ │ [toggle] │ │ [toggle] │ │ [toggle] │            │ │
│ │ └──────────┘ └──────────┘ └──────────┘ └──────────┘            │ │
│ └────────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ 右侧点击卡片 → CuratedDetail drawer (Element Plus el-drawer)        │
│   ┌─ 详情 ─────────────────────────────────────────────┐          │
│   │ draw-diagram  v1.0.0  ⭐Featured                    │          │
│   │ 作者: Skill Developer                               │          │
│   │ 类别: development  · 标签: [svg][diagram]            │          │
│   │ ─────────────────────────────────────────────────── │          │
│   │ 简介: 生成 SVG 架构图/流程图,导出 PNG ...            │          │
│   │ 完整描述: ...                                       │          │
│   │ 路径: /Users/xxx/.pi/agent/skills/draw-diagram/SKILL.md│       │
│   │ ─────────────────────────────────────────────────── │          │
│   │ [开启 featured] [停用] [编辑]  [打开 apps/web SkillsConfig]│   │
│   └────────────────────────────────────────────────────┘          │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 复用 tf-soc-agent SkillMarketplace 的模式

- view-toggle（表格 / 卡片）：ElButtonGroup + TIcon
- 卡片网格：`el-row` + `el-col :span="6"` 4 列
- 类别 tab：ElTabs + tab-change 触发 filter
- 状态切换：ElSwitch（`v-model="entry.enabled"`），`@change` 调 PATCH
- 详情弹层：ElDrawer（默认右侧 500px）

### 4.3 编辑 modal（OWNER only）

ElDialog：`slug / name / description / summary / category / tags(逗号分隔字符串) / icon / version / author / featured switch / enabled switch`。校验：
- slug 必须 `^[a-z0-9-]+$`，唯一
- summary ≤ 200 字
- 类别必须在已有 categories 列表中（自由输入则自动新增）

### 4.4 与 apps/web SkillsConfig 的关系

`CuratedDetail` 底部加跳转链接 "在 SkillsConfig 中打开" → `apps/web/skills-config?filePath=...`（现有 SkillsConfig.tsx 按 filePath 定位）。无需新组件，只用 `<a :href>`。

## 5. RBAC 矩阵

| 操作 | platform OWNER | team ADMIN | team MEMBER | user |
|---|---|---|---|---|
| 浏览 `/admin/skill` GET | ✅ | ✅ | ✅ | ❌ (前端 meta.roles) |
| 浏览 GET API | ✅ | ✅ | ✅ | ✅ (后端 auth-only) |
| 新增 POST | ✅ | ❌ 403 | ❌ | ❌ |
| 编辑 PATCH | ✅ | ❌ 403 | ❌ | ❌ |
| 软删 DELETE | ✅ | ❌ 403 | ❌ | ❌ |
| seed-from-builtin | ✅ | ❌ 403 | ❌ | ❌ |
| 切换 featured | ✅ | ❌ 403 | ❌ | ❌ |

理由：精选库是平台治理层，与 `model:view` / `model:edit` 同一原则（参考 `apps/web/app/api/admin/models/route.ts`）。

## 6. 关键文件清单

```
apps/web/prisma/schema.prisma                                       [MOD]
  + SkillCuratedEntry 表

apps/web/prisma/seed/menus.ts                                       [MOD]
  + 5 个示例精选条目(只在 seed 时插入,生产空库也跑通)

apps/web/lib/curated-skills.ts                                      [NEW]
  service: list / get / upsert / softDelete / seedFromBuiltin

apps/web/app/api/admin/curated-skills/route.ts                       [NEW]
apps/web/app/api/admin/curated-skills/[id]/route.ts                 [NEW]
apps/web/app/api/admin/curated-skills/categories/route.ts           [NEW]
apps/web/app/api/admin/curated-skills/seed-from-builtin/route.ts    [NEW]

apps/web/app/api/skills/route.ts                                    [MOD]
  GET join SkillCuratedEntry

apps/web/components/SkillsConfig.tsx                                [MOD]
  新增 curated 字段渲染

apps/web/__tests__/admin/curated-skills.test.ts                     [NEW]

apps/dashboard/src/views/skill-curated/index.vue                    [NEW]
apps/dashboard/src/views/skill-curated/modules/CuratedList.vue      [NEW]
apps/dashboard/src/views/skill-curated/modules/CuratedDetail.vue    [NEW]
apps/dashboard/src/views/skill-curated/modules/CuratedEditor.vue    [NEW]
apps/dashboard/src/views/skill-curated/modules/CategoryFilter.vue   [NEW]
apps/dashboard/src/api/curated-skills.ts                            [NEW]

apps/dashboard/src/router/modules/system.ts                        [MOD]
  + skill-curated 子路由

apps/dashboard/src/views/skill-curated/__tests__/curated-page.test.ts [NEW]

docs/design/skill-curated-library.md                                [NEW]
  接口契约 + RBAC 矩阵 + 与 /api/skills 关系

openspec/specs/skill-curated-library/spec.md                        [NEW]
```

## 7. 与参考项目的差异化

| 维度 | tf-soc-agent Skill 广场 | apps/web SkillsConfig（现状） | 本方案（精选库） |
|---|---|---|---|
| 存储 | filesystem `marketplace-skills/*/SKILL.md` | DB `SkillPackage` + filesystem 扫描 | **DB `SkillCuratedEntry`**（治理层） |
| 主要消费方 | 同进程 Pi Agent session | 用户的 AgentWorkbench session | **平台 Owner / Team Admin 的运营面板** |
| 元数据 | YAML frontmatter | 运行时字段（name/filePath） | **完整元数据（tags / category / featured / installCount）** |
| 鉴权 | 单进程无鉴权 | RBAC（install 需 OWNER） | **OWNER-only CRUD, 全员可读** |
| 多租户 | 单租户 | global/team/user scope | **本期 global-only，预留字段** |
| 范围 | 内部 marketplace | 用户视角管理 | **平台视角的精选 + 推荐位 + 软删** |

关键差异：**精选库 ≠ 技能本身**。它是一层"运营/治理视图"，让平台 Owner 能回答：
- 我们应该向用户推荐哪些 builtin Skill？
- 哪些 Skill 已经下架（`enabled=false`）但用户本地还能跑？
- 哪些 Skill 有 `summary` 让 `SkillsConfig` 卡片更丰富？

## 8. 错误码约定

| HTTP | 含义 | 触发条件 |
|---|---|---|
| 200 | OK | 列表 / 详情 / seed 成功 |
| 201 | Created | POST 新增成功 |
| 204 | No Content | DELETE 软删成功 |
| 400 | Bad Request | body 解析失败 / slug 格式非法 |
| 401 | Unauthorized | 未登录 |
| 403 | Forbidden | 非 OWNER 调 POST/PATCH/DELETE/seed |
| 404 | Not Found | slug / id 不存在 |
| 409 | Conflict | slug 重复 / sourceFilePath 已绑定到不同 entry |
| 422 | Unprocessable Entity | frontmatter 解析失败 / 必填字段缺失 |

## 9. 测试策略

### 9.1 后端 (vitest)

- `apps/web/__tests__/lib/curated-skills.test.ts`
  - upsert 幂等性（同 slug 同 sourceFilePath）
  - 列表过滤：category / featured / tag / q
  - 软删：`enabled=false` 后 list 默认不返回
  - seedFromBuiltin：扫描 fixture 目录 → 创建/更新/跳过计数正确
- `apps/web/__tests__/api/admin/curated-skills.test.ts`
  - GET 列表：无需鉴权 / 筛选 / 分页
  - POST：OWNER 201 / 非 OWNER 403 / 未登录 401 / slug 重复 409 / frontmatter 错 422
  - PATCH：OWNER 200 / 非 OWNER 403
  - DELETE：OWNER 204 / 非 OWNER 403 / 不存在 404
- 集成测：seed-from-builtin 跑后 `GET /api/skills?cwd=` 内 curated join 返回一致

### 9.2 前端 (vitest + @vue/test-utils)

- `apps/dashboard/src/views/skill-curated/__tests__/curated-page.test.ts`
  - mount: 调 `fetchList` 一次
  - 类别 tab 切换 → `fetchList({category})`
  - search 输入 → 500ms debounce → `fetchList({q})`
  - 卡片 toggle → 调 PATCH → 乐观更新 enabled
  - featured toggle → 调 PATCH → 立即重排到顶部
  - "Seed" 按钮 → 调 seed-from-builtin → 弹 ElMessage + refresh 列表

## 10. 迁移与回滚

### 10.1 迁移

```bash
cd apps/web
pnpm prisma migrate dev --name skill-curated-entry
pnpm prisma db seed     # 写入示例 5 条
```

新表独立，**不动**既有 `SkillPackage / SkillInvocation / McpServer`。

### 10.2 回滚

```sql
DROP TABLE "SkillCuratedEntry";
```

`apps/web` 与 `apps/dashboard` 需同步 revert 对应代码 commit。`GET /api/skills?cwd=` 加 `curated` 字段是无侵入式（前端缺失时降级为不渲染），回滚安全。