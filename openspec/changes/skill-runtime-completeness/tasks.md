# Tasks：Skill 系统运行时完善

> change: skill-runtime-completeness
> 设计依据：`design.md`
> 状态标记：`[ ]` 待办 / `[~]` 进行中 / `[x]` 完成

---

## 进度

- **P0 分发管道打通** ✅ 已完成（commit `605b389`）—— `materializeSkill` + install 改造 + `startRpcSession` sync；26 单测 + 真实 fs 冒烟通过。
- **P1 curated 数据规范化** ✅ 已完成（commit `25269ec`）—— `seedFromBuiltin` 落 SKILLS_ROOT + upsert global SkillPackage + 存量迁移脚本；dev server API 端到端验证通过。
- **P2 来源追溯** ✅ 已完成（commit `04b0f6e`）—— `GET /api/digital-employees/[id]` skillBindings enrich（slug/name/scope/source/curated）+ 前端编辑器来源徽标；curl 验证全字段。
- **P3 反馈闭环** ✅ 已完成（commit `04b0f6e`）—— `SkillInvocation` migration（triggerKind/outcome/...）+ skill-invoke/skill-block 写入 + `GET /api/skills/[id]/stats`；curl 验证 200。
- P4 治理规范 待实施。

> 注：P0.3.4「sync 失败写 SkillInvocation(outcome)」依赖 P3 的 schema 迁移（triggerKind/outcome 字段），P0 阶段先用 `console.warn` 替代，P3 补 DB 写入。
> 注：`openspec-*` 等 frontmatter 缺 `name` 的 builtin skill 会被 seed 跳过，其 CuratedEntry.sourceFilePath 仍为开发机路径（但文件存在时 install curated 仍可 materialize）。彻底规范化留 P4 frontmatter 治理。

---

## P0 — 分发管道打通（最高优先，最小可用闭环）

> 目标：让「数字员工绑定 skill → 会话真正加载执行」整条链路跑通。
> 验收：`design.md` §13 P0 两条。

### P0.1 `lib/skill-materialize.ts`（核心新模块）

- [ ] P0.1.1 实现 `canonSkillPath(scope, slug, ctx)` —— 规范化存储路径（global/team/user 三级隔离）
- [ ] P0.1.2 实现 `materializeSkill({source, scope, slug, teamId, userId})`：
  - 支持 source kind: `builtin` / `curated` / `uploaded`
  - 读取源 SKILL.md → 校验 frontmatter（name 必填）→ 复制到 canonSkillPath
  - 内容 hash 幂等（相同则跳过覆盖）
  - 返回 `{ filePath, name, description }`
- [ ] P0.1.3 实现 `syncSkillToSessionCwd({cwd, skills})`：
  - 把 SkillPackage.filePath 复制到 `<cwd>/.pi/skills/{slug}/SKILL.md`
  - 幂等（hash 比较）
  - 单个失败不抛错，收集到 `failed[]`
  - 返回 `{ synced: slug[], failed: [{slug,reason}] }`
- [ ] P0.1.4 单元测试 `__tests__/lib/skill-materialize.test.ts`：
  - canonSkillPath 三 scope 路径正确
  - materializeSkill 幂等 / frontmatter 缺失抛错 / builtin 源不存在抛错
  - syncSkillToSessionCwd 幂等 / 部分失败不影响其他

### P0.2 install 路由改造

- [ ] P0.2.1 `app/api/skills/install/route.ts` `handleScopedInstall`：插入 `materializeSkill` 调用，filePath 必非空且在 SKILLS_ROOT 内
- [ ] P0.2.2 Request body 改为 `source: {kind, ...}`（保留对旧 `filePath` 的兼容降级）
- [ ] P0.2.3 测试：install builtin → DB filePath 指向 SKILLS_ROOT + 磁盘文件存在

### P0.3 startRpcSession 改造

- [ ] P0.3.1 `lib/rpc-manager.ts` 新增 `resolveAgentSkillPackages(agentId, userId, teamId)` —— 返回 `SkillPackage[]`（含 filePath），替代现状只返回 slug 的 `resolveAgentSkills`（或在其上层包装）
- [ ] P0.3.2 `startRpcSession` 在 `buildResourceLoaderOptions` 前调 `syncSkillToSessionCwd`，传 `synced` slug 子集
- [ ] P0.3.3 加 env 灰度开关 `SKILL_SYNC_ENABLED`（默认 true，出问题可关）
- [ ] P0.3.4 sync 失败记 warn 日志 + 写 `SkillInvocation(outcome='error', triggerKind='auto')`
- [ ] P0.3.5 测试：agent 绑定 skill → mock 会话 → 断言 `<cwd>/.pi/skills/{slug}/SKILL.md` 存在 + loaderOpts 只含 synced slug

### P0.4 端到端验证

- [ ] P0.4.1 准备 fixture skill（写一个最小 SKILL.md 到 builtin 目录）
- [ ] P0.4.2 e2e：seed → install(global) → 创建数字员工绑定 → 开会话 → `/skill:<slug>` 触发 → 断言响应含 skill 注入内容
- [ ] P0.4.3 跑全量回归：`pnpm test`（确保既有 324 测试不回归）

---

## P1 — curated 数据修正与存量迁移

> 目标：解决部署可移植性（G2）。新环境部署后 skill 全部可加载。

- [ ] P1.1 `seed-from-builtin` 路由改造：seed 时对每个 builtin 执行 `materializeSkill({scope:'global'})`，CuratedEntry.sourceFilePath 改存 SKILLS_ROOT 规范路径；同步 upsert global SkillPackage
- [ ] P1.2 `prisma/seed/curated-skills.ts` 改造：移除硬编码开发机绝对路径，sourceFilePath 留空或占位，由 seed-from-builtin 运行时填充
- [ ] P1.3 存量迁移脚本 `scripts/migrate-skill-filepath.ts`：
  - 扫所有 `SkillPackage` where filePath 为空或不在 SKILLS_ROOT 内
  - 按 slug 从 curated/builtin 重新 materialize 回填
  - 幂等，打印 `fixed/skipped/failed` 计数
- [ ] P1.4 SKILLS_ROOT 持久化部署约定：README/部署文档说明 env `SKILLS_ROOT` 指向持久卷；启动健康检查（目录可写）
- [ ] P1.5 测试：清空 SKILLS_ROOT → 跑迁移 → 所有 SkillPackage.filePath 可读

---

## P2 — 来源追溯 UI

> 目标：前端清楚展示 skill 来源（G3）。

- [ ] P2.1 `GET /api/digital-employees/[id]`：skillBindings[] 每项扩展 `{name, scope, source, curated?}`
- [ ] P2.2 `GET /api/skills?cwd=` 改为三来源分组返回 `{agentBound, user, local}`
- [ ] P2.3 前端 `digital-employees/index.vue`：Skill 列表项加来源徽标（scope + source + curated icon）
- [ ] P2.4 前端「+ 添加 Skill」picker：复用精选库列表，支持 scope/category 筛选
- [ ] P2.5 前端 `SkillsConfig.vue`：三来源分组展示 + 来源徽标
- [ ] P2.6 测试：mock 三来源数据 → 断言 UI 分组渲染正确

---

## P3 — 反馈闭环

> 目标：记录 skill 调用结果，支撑排序与「哪些真有用」（G5）。

- [ ] P3.1 Prisma migration `skill_invocation_outcome`：+triggerKind/outcome/errorMessage/durationMs/tokenIn/tokenOut + index
- [ ] P3.2 `skill-invoke.ts`：buildSkillInjection 写 invocation 时补 triggerKind='explicit'；会话结束/出错回调回填 outcome
- [ ] P3.3 `skill-block.ts`：resolveSkillBlock 命中时写 triggerKind='model'
- [ ] P3.4 `GET /api/skills/[id]/stats`：聚合 totalInvocations/successRate/last7d/lastUsedAt
- [ ] P3.5 前端：数字员工 skill 列表 + 精选库卡片展示「近 7 天 N 次 · 成功率 M%」
- [ ] P3.6 CuratedEntry.installCount 由 invocation 聚合物化（定时 or install 时 +1）
- [ ] P3.7 测试：触发 skill → 查 stats 返回正确；失败场景 outcome='error'

---

## P4 — 治理与规范

> 目标：可治理（G4）。

- [ ] P4.1 `materializeSkill` 强制校验 frontmatter（name/description 必填），缺失返回 422
- [ ] P4.2 撰写《SKILL.md 编写规范》文档（frontmatter 字段、disable-model-invocation 用法、scope 选择）
- [ ] P4.3 上传 skill 体积上限 + 基本 sanitize（防止超大/畸形文件）
- [ ] P4.4 权限矩阵复核（对照 design §6.3，补缺失的 RBAC 检查点）
- [ ] P4.5 文档：Skill vs MCP 心智模型说明（面向最终用户）

---

## 依赖与顺序

```
P0 ──▶ P1 ──▶ P2 ──┐
                   ├──▶ P4(随时)
        P3(可与P2并行)
```

- **P0 必须最先**：是可用性基线。
- P1 紧随 P0（同属"分发"主题）。
- P2/P3 可并行。
- P4 横向贯穿，可随时补文档。

---

## 风险检查点

- [ ] P0 前确认：容器内 `SKILLS_ROOT` 可写（部署侧）
- [ ] P0 后确认：既有 agent（无 skill 绑定）会话不回归
- [ ] P1 前备份生产 DB（迁移脚本涉及写 filePath）
- [ ] 每个 PR 跑全量 `pnpm test` + `vue-tsc`
