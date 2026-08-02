# skill-curated-library Specification

## Purpose
平台 Owner / 团队 Admin 通过 `/admin/skill` 页面浏览、筛选、新增、编辑、软删、置顶（featured）技能精选库条目；该库独立于 `SkillPackage` 表，作为「运营/治理层」把面向用户的 builtin / 上传 / 生成技能统一登记，提供 tags / category / summary / version / author 等元数据，并通过 join 机制透传到 `GET /api/skills?cwd=` 让 `SkillsConfig.tsx` 卡片显示更丰富的描述。

## Requirements

### Requirement: SkillCuratedEntry 表是精选库唯一存储

系统 SHALL 维护一张独立于 `SkillPackage` 的 `SkillCuratedEntry` 表，字段至少包含 `slug / name / description / summary / category / tags / icon / version / author / sourceKind / sourceFilePath / sourceBuiltinPath / sourceUrl / visibility / featured / enabled / installCount / createdAt / updatedAt`。`slug` 唯一。`enabled = false` 表示软删（下架），但行仍在表中可恢复。

#### Scenario: slug 冲突时 upsert 跳过
- **WHEN** 调用 `POST /api/admin/curated-skills` body `{slug: "draw-diagram", ...}`，且 DB 中已存在 `slug = "draw-diagram"` 行
- **THEN** 返回 409 `{ error: "slug already exists" }`
- **AND** 不修改 DB

#### Scenario: 软删后默认列表不返回
- **WHEN** 调用 `DELETE /api/admin/curated-skills/[id]` 成功
- **AND** 调用 `GET /api/admin/curated-skills`
- **THEN** 默认 `enabled=true` 过滤，软删条目不出现
- **AND** 调用 `GET /api/admin/curated-skills?enabled=false` 时仍可见

#### Scenario: tags 用 Postgres text[] 数组
- **WHEN** `upsertCuratedEntry({ tags: ["svg", "diagram", "architecture"] })`
- **THEN** DB 中 `tags` 列存为 `["svg", "diagram", "architecture"]`
- **AND** `listCuratedEntries({ tag: "svg" })` 返回该 entry（`WHERE tags @> ARRAY['svg']`）

### Requirement: 精选库 CRUD 鉴权矩阵

所有写操作（POST / PATCH / DELETE / seed-from-builtin） MUST 由 platform OWNER 调用；读操作（GET） MUST 至少 authed。错误码：401 unauthed / 403 non-OWNER / 404 不存在 / 409 slug 冲突 / 422 frontmatter 解析失败。

#### Scenario: 非 OWNER 调 POST 返回 403
- **WHEN** team ADMIN 调用 `POST /api/admin/curated-skills` 带有效 body
- **THEN** 返回 403 `{ error: "forbidden" }`
- **AND** DB 不写入

#### Scenario: 未登录调 POST 返回 401
- **WHEN** 无 session 调用 `POST /api/admin/curated-skills`
- **THEN** 返回 401 `{ error: "auth required" }`

#### Scenario: OWNER 调 POST 返回 201
- **WHEN** platform OWNER 调用 `POST /api/admin/curated-skills` body 含合法 slug / name / category
- **THEN** 返回 201 + 新创建的 entry JSON
- **AND** DB 行已存在

#### Scenario: frontmatter 解析失败返回 422
- **WHEN** `POST /api/admin/curated-skills/seed-from-builtin` 扫到一个 `SKILL.md` 但 frontmatter YAML 语法错
- **THEN** 该 skill 计入 `skipped` 而不报错
- **AND** 返回 200 `{ created, updated, skipped }`

### Requirement: 列表多维过滤

`GET /api/admin/curated-skills` MUST 支持 7 维过滤：`category`（精确）/ `tag`（contains）/ `featured`（boolean）/ `enabled`（boolean 默认 true）/ `q`（name/slug/description 模糊）/ `limit`（默认 50 上限 200）/ `offset`（默认 0）。返回 `{ entries, total, limit, offset }`。

#### Scenario: 类别过滤
- **WHEN** 调用 `GET /api/admin/curated-skills?category=development`
- **THEN** 仅返回 `category = "development"` 的 entries
- **AND** `total` 是该类别的总数（非全表）

#### Scenario: featured-only 过滤
- **WHEN** 调用 `GET /api/admin/curated-skills?featured=true`
- **THEN** 仅返回 `featured = true` 的 entries

#### Scenario: q 模糊匹配
- **WHEN** 调用 `GET /api/admin/curated-skills?q=diagram`
- **THEN** 返回 `name` / `slug` / `description` 任一字段包含 "diagram"（不区分大小写）的 entries

#### Scenario: 默认排除软删
- **WHEN** 调用 `GET /api/admin/curated-skills` 不带 `enabled` 参数
- **THEN** 默认 `enabled=true`，不返回软删条目

### Requirement: featured 优先级排序

列表 MUST 按 `featured DESC, updatedAt DESC` 排序，确保 featured 条目排在最前。

#### Scenario: featured 置顶
- **WHEN** PATCH `featured = true` 在 entry X 上
- **THEN** 下次 `GET /api/admin/curated-skills` 返回 X 在所有非 featured 条目之前

### Requirement: 透传到 GET /api/skills

`GET /api/skills?cwd=` 在返回的每个 skill 元素 MUST 新增可选 `curated` 字段：当 `SkillCuratedEntry` 存在匹配 `sourceFilePath`（精确字符串）时填入 `{ id, slug, summary, tags, category, icon, featured }`；否则 `curated = null`。join 走内存（一次性查全表构建 `Map<sourceFilePath, Entry>` 后 O(N) 命中）。

#### Scenario: builtin skill 命中 curated
- **WHEN** cwd 下扫到 skill `draw-diagram` 的 `filePath = /Users/xiejava/.pi/agent/skills/draw-diagram/SKILL.md`
- **AND** DB 存在 `SkillCuratedEntry` 行 `sourceFilePath = /Users/xiejava/.pi/agent/skills/draw-diagram/SKILL.md`
- **THEN** 该 skill 的 `curated` 字段为非 null 对象，含 summary / tags / featured 等

#### Scenario: 未登记 skill 的 curated 为 null
- **WHEN** cwd 下扫到 skill `unknown-tool` 且 DB 无对应 SkillCuratedEntry
- **THEN** `curated = null`，前端渲染降级为仅显示 description

#### Scenario: 回归兼容
- **WHEN** SkillsConfig.tsx 旧版本（未升级）调用 `GET /api/skills?cwd=`
- **THEN** 多出的 `curated` 字段不影响既有字段，旧前端忽略即可

### Requirement: seed-from-builtin 幂等

`POST /api/admin/curated-skills/seed-from-builtin` MUST 扫描 3 个目录：`<dashboard>/skills/`、`~/.pi/agent/skills/`、`~/.claude/skills/`；每个 `*/SKILL.md` 解析 frontmatter 后按 `sourceFilePath` upsert 到 `SkillCuratedEntry`。返回 `{ created, updated, skipped }` 计数。同一 `sourceFilePath` 多次调用 MUST 幂等（不重复创建）。

#### Scenario: 第一次 seed
- **WHEN** OWNER 首次调用 `POST /api/admin/curated-skills/seed-from-builtin`
- **THEN** 返回 `{ created: 5, updated: 0, skipped: 0 }`（假设 5 个 builtin）

#### Scenario: 第二次 seed 幂等
- **WHEN** OWNER 再次调用同一端点
- **THEN** 返回 `{ created: 0, updated: 5, skipped: 0 }`
- **AND** DB 行数不变

#### Scenario: builtin 路径不存在静默跳过
- **WHEN** `~/.pi/agent/skills/` 在该部署不存在
- **THEN** 该目录跳过，不计入 skipped
- **AND** 日志 logger.warn 一条
- **AND** 返回 200

### Requirement: 前端 dashboard /admin/skill 页面

`apps/dashboard/src/views/skill-curated/index.vue` MUST 渲染：toolbar（搜索 + 类别 tab + view-toggle）+ 主区（table 或 card 视图）+ 点击卡片打开 ElDrawer 详情。路由 `meta.roles = ["OWNER"]`，非 OWNER 访问重定向到 401 页面。

#### Scenario: mount 触发 fetchList
- **WHEN** OWNER 进入 `/admin/skill`
- **THEN** 调 `GET /api/admin/curated-skills` 一次
- **AND** 渲染返回的 entries 到 CuratedList

#### Scenario: 类别 tab 切换触发 fetchList
- **WHEN** OWNER 点击「development」tab
- **THEN** 调 `GET /api/admin/curated-skills?category=development`
- **AND** 列表刷新

#### Scenario: featured 切换触发 PATCH
- **WHEN** OWNER 在 CuratedDetail 点 featured toggle 开关
- **THEN** 调 `PATCH /api/admin/curated-skills/[id]` body `{featured: true}`
- **AND** 乐观更新 entry.featured
- **AND** 列表按 featured DESC 重排

#### Scenario: 软删立即从列表消失
- **WHEN** OWNER 在 CuratedDetail 点「停用」按钮
- **THEN** 调 `DELETE /api/admin/curated-skills/[id]` 204
- **AND** 关闭 drawer
- **AND** 该 entry 从当前列表移除

### Requirement: SkillsConfig.tsx 渲染 curated 字段

`apps/web/components/SkillsConfig.tsx` MUST 在每个 skill 卡片的 description 上方渲染 `curated.summary`（如有）+ `tags` chip（参考 tf-soc-agent 的 `skill-card-tags` 样式）。`curated = null` 时降级为仅显示 description。

#### Scenario: 有 curated 的 skill 渲染 summary + tags
- **WHEN** skill `draw-diagram` 的 `curated.summary = "生成 SVG 架构图"`
- **AND** `curated.tags = ["svg", "diagram"]`
- **THEN** 卡片顶部显示 "生成 SVG 架构图" 副标题 + 2 个 chip 标签

#### Scenario: 无 curated 的 skill 降级
- **WHEN** skill `unknown-tool` 的 `curated = null`
- **THEN** 卡片不显示 summary 行与 tags chip，仅显示 description

### Requirement: 与 tf-soc-agent Skill 广场差异化

精选库是「运营/治理层」，不复用 tf-soc-agent 的 filesystem `marketplace-skills/*/SKILL.md` 模型。本项目精选库 MUST 以 DB `SkillCuratedEntry` 为单一存储真相源，前端展示走 API；不暴露文件系统路径给最终用户。

#### Scenario: 路径不暴露给普通用户
- **WHEN** team MEMBER 进入 `/admin/skill`
- **THEN** 前端路由守卫拒绝（重定向 401）
- **AND** 即便绕过前端，API 也仅 GET 可见列表

### Requirement: 错误码统一约定

API MUST 使用：200 OK / 201 Created / 204 No Content / 400 Bad Request / 401 Unauthorized / 403 Forbidden / 404 Not Found / 409 Conflict / 422 Unprocessable Entity。所有 4xx 错误体格式 `{ error: string }`。

#### Scenario: slug 格式非法 400
- **WHEN** POST body `slug = "Draw Diagram"` （含空格 + 大写）
- **THEN** 返回 400 `{ error: "slug must match ^[a-z0-9-]+$" }`

#### Scenario: 详情 id 不存在 404
- **WHEN** PATCH `/api/admin/curated-skills/nonexistent_id`
- **THEN** 返回 404 `{ error: "entry not found" }`