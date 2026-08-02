# 任务清单：技能精选库（Skill Curated Library）

> change: skill-curated-library
> 日期：2026-07-26
> 状态：open（等待 brainstorming 确认）

---

## 0. Spike 与基线

- [ ] T0.1 确认 `apps/dashboard` 当前已建有 `views/skill-center/`（已合并到 main 路径在 `.claude/worktrees/agent-a5507cec19e168fb2/apps/dashboard/src/views/skill-center/index.vue`），调研其与 `skill-curated` 的分工：前者是「用户级已安装技能」，后者是「平台级精选库」；两者关系为 `SkillCuratedEntry` → `SkillPackage`（可选安装关系）
- [ ] T0.2 调研 `tf-soc-agent` SkillMarketplace.vue 357 行模式，确认其 `view-toggle / tag chip / el-switch / drawer` 模式可直接借鉴到 CuratedList / CuratedDetail
- [ ] T0.3 调研 `apps/web/app/api/skills/route.ts` 现有 GET 链路，确认 join 入口在 `DefaultResourceLoader.getSkills()` 之后做内存 join 而非 SQL 层（避免污染 Pi Agent 库）
- [ ] T0.4 基线门禁：`pnpm install` 通过、`pnpm --filter @ai-agent-workshop/web build` 通过、`pnpm --filter @ai-agent-workshop/dashboard build` 通过、当前 main 上一次 `pnpm prisma migrate dev` 已落地（先停在这里确认仓库健康再动 schema）

## 1. 数据模型

- [ ] T1.1 `apps/web/prisma/schema.prisma` 新增 `model SkillCuratedEntry`（见 design.md §2）：slug 唯一 / tags text[] / featured + enabled 双开关 / 软删走 enabled
- [ ] T1.2 跑 `pnpm --filter @ai-agent-workshop/web prisma migrate dev --name skill-curated-entry` 生成 PostgreSQL 迁移 SQL，验证可向上 + 向下
- [ ] T1.3 `apps/web/prisma/seed/menus.ts` 已经登记 `platform-skill → /admin/skill → /skill-curated/index → skill:view`，**不修改**；但 seed 里加 5 条示例精选条目（参考 tf-soc-agent 的 asset_query / code-viewer / draw-diagram / threat-hunt / test-zip-import），覆盖每种 sourceKind
- [ ] T1.4 跑 `pnpm --filter @ai-agent-workshop/web prisma db seed` 验证 5 条 upsert 成功（slug 冲突走 skip）

## 2. 后端：service + API

- [ ] T2.1 `apps/web/lib/curated-skills.ts`：实现 5 个核心函数（list / getBySlug / upsert / softDelete / seedFromBuiltin），签名见 design.md §3
- [ ] T2.2 `listCuratedEntries` 支持 `category / tag / featured / enabled / q / limit / offset` 全部 7 维过滤；`tag` 用 Prisma `where: { tags: { has: tag } }`（Postgres text[] contains）
- [ ] T2.3 `seedFromBuiltin` 扫 3 个目录：`<dashboard>/skills/*/SKILL.md`（通过 `process.cwd()` + `path.resolve`）、`~/.pi/agent/skills/*/SKILL.md`、`~/.claude/skills/*/SKILL.md`，缺失路径静默跳过（logger.warn）
- [ ] T2.4 解析 SKILL.md frontmatter：复用 `apps/web/app/api/skills/route.ts` 已经在用的 `parseFrontmatter` from `@earendil-works/pi-coding-agent`（已在依赖里）
- [ ] T2.5 `apps/web/app/api/admin/curated-skills/route.ts`：`GET`（无鉴权）+ `POST`（OWNER 鉴权）
- [ ] T2.6 `apps/web/app/api/admin/curated-skills/[id]/route.ts`：`GET` + `PATCH`（OWNER）+ `DELETE`（OWNER 软删）
- [ ] T2.7 `apps/web/app/api/admin/curated-skills/categories/route.ts`：`GET` 返回按 category 聚合的 count 列表（无鉴权）
- [ ] T2.8 `apps/web/app/api/admin/curated-skills/seed-from-builtin/route.ts`：`POST`（OWNER）；返回 `{created, updated, skipped}`
- [ ] T2.9 鉴权统一走 `getUserHighestRole(callerId)` from `apps/web/lib/user-role.ts`（已有，避免重复造轮子）

## 3. 后端：把 curated 透传到 GET /api/skills

- [ ] T3.1 `apps/web/app/api/skills/route.ts` GET 末尾：`const curatedMap = await getCuratedEntriesBySourceFilePaths([...allSourceFilePaths])`，内存 join 后给每个 skill 元素加 `curated` 字段（无命中为 null）
- [ ] T3.2 性能边界：单 cwd 一般 ≤ 50 个 skill，O(N) 内存 join 完全够用；不引入新表索引
- [ ] T3.3 `apps/web/components/SkillsConfig.tsx`：`Skill` interface 加 `curated?: CuratedSkillMeta`（apps/web/lib/api-types.ts 新增 type），卡片 description 上方渲染 summary + tags chip（参考 tf-soc-agent 的 `skill-card-tags` 样式）

## 4. 前端 dashboard：精选库页面

- [ ] T4.1 新建 `apps/dashboard/src/views/skill-curated/index.vue`（恢复路由，参考 AGENTS.md「组件未找到 /system/models/index」同型修复模式）：page-header 含 toolbar，主区 CuratedList，ElDrawer 挂 CuratedDetail
- [ ] T4.2 新建 `apps/dashboard/src/views/skill-curated/modules/CuratedList.vue`：复用 tf-soc-agent 的 view-toggle（table / card）+ ElRow ElCol 4 列布局
- [ ] T4.3 新建 `apps/dashboard/src/views/skill-curated/modules/CuratedDetail.vue`：ElDrawer 默认右侧 500px，含 description / tags / featured / enabled / source 路径 + 「在 SkillsConfig 中打开」跳转链接
- [ ] T4.4 新建 `apps/dashboard/src/views/skill-curated/modules/CuratedEditor.vue`：ElDialog，slug 唯一性前端校验（debounce 调 GET 检查），tags 用 ElInput 逗号分隔
- [ ] T4.5 新建 `apps/dashboard/src/views/skill-curated/modules/CategoryFilter.vue`：ElTabs + tab-change 触发 filter 同步到 Pinia
- [ ] T4.6 新建 `apps/dashboard/src/api/curated-skills.ts`：fetchList / fetchDetail / create / update / softDelete / seedFromBuiltin / fetchCategories，签名对齐后端 §3
- [ ] T4.7 新建 `apps/dashboard/src/store/modules/skill-curated.ts`（Pinia）：state = { entries, categories, loading, error, filters }；actions = fetchList / fetchDetail / updateEntry / toggleFeatured / createEntry / softDeleteEntry / seedFromBuiltin

## 5. 前端 dashboard：路由 + 权限

- [ ] T5.1 `apps/dashboard/src/router/modules/system.ts` 加 `skill-curated` 子路由（参考上一轮 `/admin/models` 的恢复模式）：`meta: { title: '技能精选库', icon: 'CollectionTag', roles: ['OWNER'] }`
- [ ] T5.2 `apps/dashboard/src/router/routesAlias.ts` 加 `RoutesAlias.SkillCurated = '/skill-curated'`（如 component path alias 需要，参考上一轮 `RoutesAlias.Models`）
- [ ] T5.3 验证 `apps/dashboard/src/views/system/admin/index.vue`（或类似父菜单）已挂 `/admin/skill` 入口——若没有则补一个 admin-section wrapper
- [ ] T5.4 菜单 DB row 已是 `component=/skill-curated/index`；菜单不修改（参考上一轮「菜单 component 已规划好」原则）

## 6. 测试

- [ ] T6.1 `apps/web/__tests__/lib/curated-skills.test.ts`：覆盖 upsert 幂等 + 列表过滤 7 维 + 软删不再出现在默认列表 + seedFromBuiltin fixture 计数
- [ ] T6.2 `apps/web/__tests__/api/admin/curated-skills.test.ts`：覆盖 GET / POST / PATCH / DELETE / seed 的鉴权矩阵（OWNER 200/201/204 vs 非 OWNER 403 vs 未登录 401）+ slug 冲突 409 + frontmatter 错 422
- [ ] T6.3 `apps/web/__tests__/api/skills-curated-join.test.ts`：集成测 fixture skill + 对应 SkillCuratedEntry row → `GET /api/skills?cwd=` 返回含正确 `curated` 字段
- [ ] T6.4 `apps/dashboard/src/views/skill-curated/__tests__/curated-page.test.ts`：mount 触发 fetchList / category tab 切换 → fetchList({category}) / search 输入 debounce → fetchList({q}) / featured toggle → PATCH / 软删 → 立即从列表消失
- [ ] T6.5 `apps/web/tests/integration/skills-install.test.ts`：回归测，确保新加的 `curated` join 不破坏既有 skill 安装 / 启用流程
- [ ] T6.6 跑全套：`pnpm --filter @ai-agent-workshop/web test` + `pnpm --filter @ai-agent-workshop/dashboard test`，全绿

## 7. 文档

- [ ] T7.1 新建 `docs/design/skill-curated-library.md`：接口契约 + RBAC 矩阵 + 与 `/api/skills` 的 join 关系 + 与 tf-soc-agent Skill 广场的差异（设计文档层，与本 change 的 design.md 不重叠：design.md 给开发者、docs/design 给产品/架构 review）
- [ ] T7.2 `apps/web/app/api/admin/curated-skills/route.ts` 顶部注释：RBAC 表 + 与 `/api/skills` 的边界（注释即文档）
- [ ] T7.3 `apps/dashboard/src/views/skill-curated/index.vue` 顶部注释：组件未找到修复来源（参考上一轮 `apps/dashboard/src/views/system/models/index.vue` 的注释风格）

## 8. 发布

- [ ] T8.1 `pnpm --filter @ai-agent-workshop/web lint && build` 通过
- [ ] T8.2 `pnpm --filter @ai-agent-workshop/dashboard lint && build` 通过
- [ ] T8.3 `pnpm --filter @ai-agent-workshop/web typecheck` 通过
- [ ] T8.4 手动验证：本地 `pnpm dev` + 访问 `http://localhost:3006/#/admin/skill`，跑：浏览列表 → 切换类别 → 搜索 → featured toggle → 软删 → 「Seed from builtin」→ 「在 SkillsConfig 中打开」跨应用跳转
- [ ] T8.5 提交：commit message `feat(dashboard): 技能精选库 + 后台治理 API`；单独 push 前缀 `feat(web)` for 后端 commit
- [ ] T8.6 merge 后 `openspec/changes/skill-curated-library/` 归档到 `openspec/changes/archive/`，specs/skill-curated-library/spec.md 升级为正式 spec

---

## 9. 反向任务（防回归，**本期不做**）

- [ ] T9.X **不做** "AI 自动生成 Skill" 面板，留 M4+
- [ ] T9.X **不做** "npm/git URL 安装 Skill"，留 M4+
- [ ] T9.X **不做** installCount 实时统计；本期字段就位，初始 0，靠脚本回填
- [ ] T9.X **不做** team-scope 精选库；visibility 字段预留，单一 global
- [ ] T9.X **不动** `SkillPackage / SkillInvocation / McpServer` 既有表；本期只加 `SkillCuratedEntry`