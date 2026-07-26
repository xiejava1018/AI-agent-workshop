# 提案：技能精选库（Skill Curated Library）

> change: skill-curated-library
> 类型：full workflow（brainstorming 必经）
> 日期：2026-07-26
> 依据：apps/web/prisma/seed/menus.ts:185-190 已规划 `/admin/skill` 菜单项 `platform-skill → /skill-curated/index → 技能精选库`；本 change 完成该菜单的实质落地
> 参考：`~/AIproject/tf-soc-agent`（backend/marketplace-skills + frontend-vue/.../SkillMarketplace.vue）、apps/web/components/SkillsConfig.tsx、apps/web/app/api/skills/{,install,search}

---

## 1. 为什么做

AI-agent-workshop 当前（M3 已落地）已具备数字员工（Agent）、多 Agent 编排、技能多租户作用域（`global` / `team` / `user`）、AgentSkillBinding 与 UserSkillBinding 等基础，但「技能精选库」— 一个面向平台 Owner / 团队 Admin 的"可筛选、可批量管理、可推广"的技能治理层 — 尚未实现。后果：

- **菜单已经定义但页面缺失**：seed/menus.ts:185-190 已经把 `/admin/skill` 路由 + `skill:view` 权限点写进 DB，但 `apps/dashboard/src/views/skill-curated/index.vue` 不存在、`router/modules/system.ts` 没注册 → 平台 Owner 进入管理后台点击"技能精选库"会再次遇到 "组件未找到" 错误（这是上一轮 `/admin/models` 同型问题）。
- **技能发现完全靠 filesystem 扫描**：`GET /api/skills?cwd=` 调用 `DefaultResourceLoader.reload()`，返回当前 cwd 下可被 Agent 注入的全部技能，平台 Owner 无法做「哪些技能值得官方推荐」之类的治理。
- **技能元信息（tags / category / summary / 推荐位）无处登记**：tf-soc-agent 在 `marketplace-skills/*/SKILL.md` frontmatter 里登记 `tags / version / author / description`；apps/web 当前只把 `name / filePath / disableModelInvocation` 等运行时字段暴露给前端，**完全丢失**了面向运营的元数据。
- **没有"广场/精选"概念**：现存的 `GET /api/skills/search?q=` 走全文模糊匹配，结果无分类、无推荐位、无热度排序、不区分 builtin 与用户上传。

参考 tf-soc-agent 实现：「Skill 广场」=「由平台预置 + 团队/用户上传的技能集合的可筛选浏览面板，含 toggle / install / uninstall / 详情 / 上传 / 导入 zip / AI 生成」。

## 2. 做什么（In Scope）

1. **DB schema：新增 `SkillCuratedEntry` 与 `SkillCuratedTag` 表**（PostgreSQL + Prisma）
   - `SkillCuratedEntry` 登记一个"广场条目"，每条对应一个具体技术能力的展示位（不一定 1:1 映射 SkillPackage，可指向 builtin 或任意 source）
   - 字段：`id / slug(unique) / name / description / summary(short) / category / tags(string[]) / icon / version / author / sourceBuiltinPath / sourceFilePath / sourceKind(builtin|uploaded|generated|npm|git) / visibility(global|team|user) / featured / enabled / installCount / createdAt / updatedAt`
   - `SkillCuratedTag` 辅助表（可选，本期不做，先用 `tags: string[]` in-DB 数组）
   - 审计字段复用 M3 既有约定

2. **后端：精选库 CRUD + 浏览 API**（apps/web/app/api/admin/curated-skills/*）
   - `GET  /api/admin/curated-skills?category=&tag=&featured=&q=` — 列表（可筛选）
   - `GET  /api/admin/curated-skills/[slug]` — 详情
   - `POST /api/admin/curated-skills` — 新增（platform OWNER only）
   - `PATCH /api/admin/curated-skills/[id]` — 改（OWNER only，可改 featured / enabled / category / tags / 描述）
   - `DELETE /api/admin/curated-skills/[id]` — 删（OWNER only，软删 `enabled=false`）
   - `POST /api/admin/curated-skills/seed-from-builtin` — 一次性把 `apps/dashboard/skills/` + `~/.pi/agent/skills/` 下的 builtin 技能反查到精选库（幂等 upsert by `sourceFilePath`）
   - `GET  /api/admin/curated-skills/categories` — 类别聚合（带计数）

3. **后端：种子脚本**
   - 在 prisma seed 里登记 5 个示例精选条目（参考 tf-soc-agent 的 asset_query / draw-diagram / threat-hunt / code-viewer / test-zip-import），覆盖每种 `sourceKind` 各一
   - 脚本可重跑（upsert by slug）

4. **apps/web：把 `name / description / tags / category / version / author` 透传到前端**
   - 改造现有 `GET /api/skills?cwd=` 返回结构，新增 `curated?: SkillCuratedEntry` 字段（join `SkillCuratedEntry` 表 by `sourceFilePath` / `sourceBuiltinPath`）
   - 改造 `SkillsConfig.tsx`：在每个 skill 行的 description 上方显示 curated summary（如有）+ tags chip

5. **apps/dashboard：精选库页面**
   - 新建 `apps/dashboard/src/views/skill-curated/index.vue`（恢复路由让 `/admin/skill` 不再 404）
   - 新建 `apps/dashboard/src/views/skill-curated/modules/{CuratedList,CuratedDetail,CuratedEditor,CategoryFilter}.vue`
   - 复用 `SkillMarketplace.vue` 的 UI 模式：toolbar（搜索 + 类别 tab + view toggle）→ grid/table 视图 → 单击进详情 drawer
   - 详情面板含：标题 / 描述 / tags / 版本 / 作者 / source 路径 / 累计 install 计数 / 状态切换（enabled / featured） / "打开 Skill" 跳转 `apps/web` 的 `SkillsConfig.tsx`

6. **apps/dashboard：路由 + 菜单（已规划）落地**
   - `router/modules/system.ts` 加 `skill-curated` 子路由
   - `router/routesAlias.ts` 加 `RoutesAlias.SkillCurated = '/skill-curated'`（如果有 component path alias 需要）
   - menu DB row 已存在（`platform-skill → /admin/skill → /skill-curated/index → skill:view`），无需改 seed

7. **权限**
   - 后端：所有 `POST / PATCH / DELETE` 必须 platform OWNER（`getUserHighestRole === "OWNER"`）；`GET` 全员（authed）
   - 前端：路由 `meta.roles = ["OWNER"]`（从 AGENTS.md 已确立的 RBAC 模式沿用）
   - 错误码：401 unauthed / 403 not OWNER / 404 slug 缺失 / 409 slug 冲突 / 422 frontmatter parse failed

8. **测试**
   - 后端：单元测 精选库 CRUD 鉴权 + 列表筛选 + featured toggle；集成测 `seed-from-builtin` 幂等性
   - 前端 dashboard：`__tests__/skill-curated/index.test.ts` 覆盖 mount + filter + featured toggle 调 API 路径

9. **文档**
   - 在 `docs/design/` 新增 `skill-curated-library.md`：接口契约 + 角色矩阵 + 与 `/api/skills` 的关系

## 3. 不做什么（Out of Scope）

- 不做"AI 自动生成 Skill"面板（tf-soc-agent 的 `SkillGenerateModal`）— 留 M4+。
- 不做"从 npm / git URL 安装 Skill"（tf-soc-agent 有但 M3 apps/web 不需要，留 M4+）。
- 不做"广场条目按租户动态过滤"（本轮全平台可见；多租户过滤留 M4+ skill:scope 精细化）。
- 不做 `installCount` 的实时统计（用 trigger / application-level increment；本期保留字段，手动或后台脚本回填）。
- 不动 `SkillPackage` / `SkillInvocation` / `McpServer` 既有表（仅新增 `SkillCuratedEntry`）。
- 不动数字员工（Agent）侧的能力绑定逻辑。
- 不做平台级 vs 团队级精选库拆分（一期就 platform 级）。

## 4. 关键口径（待 brainstorm 拍板）

> 这些是实现细节选择题，不是架构决策点；执行时按 team 默认值推进，遇到分歧再回头改。

| # | 议题 | 备选 | 默认倾向 |
|---|---|---|---|
| Q1 | `SkillCuratedEntry` 是否独立于 `SkillPackage`？ | (a) 独立（精选库即"运营层"） / (b) 复用 SkillPackage 加字段 | (a) — SkillPackage 含义是"某租户实际安装的包"，不适合做"全平台可见的精选条目" |
| Q2 | `tags: string[]` 字段类型 | (a) Postgres `text[]` / (b) 关联表 `SkillCuratedTag` | (a) — 第一期精简；标签数预计 <20，关联表过度工程 |
| Q3 | 是否从 `apps/web/app/api/skills/route.ts` 现有 GET 里 join 精选信息？ | (a) 是（一次取齐）/ (b) 否（前端两次取） | (a) — join by `sourceFilePath`，命中率高；不命中返回 `curated: null` 即可 |
| Q4 | "seed-from-builtin" 何时触发？ | (a) prisma seed 自动调一次 / (b) 仅暴露 API，运维手动触发 | (b) — builtin 路径依赖部署环境（`~/.pi/agent/skills` 未必存在），自动触发会让 seed 在 CI 漂移 |
| Q5 | featured 排序在前？ | (a) featured 优先 / (b) installCount 优先 | (a) — 运营手动置顶表达"推荐位"，比统计更可控 |
| Q6 | 删除是软删还是硬删？ | (a) 软删 `enabled=false` / (b) 硬删 | (a) — 防误删；与 SkillPackage / McpServer 既有约定一致 |
| Q7 | SkillsConfig.tsx 是否也消费 curated 信息？ | (a) 是 / (b) 否 | (a) — 用户视角看 builtin 详情能更丰富，体验更一致 |