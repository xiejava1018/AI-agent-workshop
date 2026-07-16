# 任务清单：M3 Vue3 工作台 + 数字员工 + 多 Agent 编排 + 技能/MCP 按 Agent 绑定

> change: m3-vue3-workbench
> 日期：2026-07-16
> 状态：open（等待 brainstorming 确认设计方案）

---

## 0. Spike 与基线（必须先做）

- [x] T0.1 C1 Spike：验证 `pi-mcp-extension` 在 Node 22 + Pi Agent 0.80.6 下的安装、stdio/SSE/Streamable HTTP 三传输、许可证兼容性，输出结论到 `docs/spikes/2026-07-16-pi-mcp-extension.md`
- [x] T0.2 C2 Spike：验证 `apps/web` 现有 agent 流式端点（SSE/WS 事件格式）可被 Vue3 真实消费，确认 dashboard `src/mock` 占比，输出结论到 `docs/spikes/2026-07-16-vue3-api-spike.md`
- [x] T0.3 基线门禁：`pnpm install` 通过、`pnpm --filter @ai-agent-workshop/web build` 通过、`pnpm --filter @ai-agent-workshop/dashboard build` 通过（若基线已坏，先停下来确认是否仓库既有问题）

## 1. 数据模型（Prisma + PostgreSQL）

- [x] T1.1 新增 `Agent` 表（数字员工：`id / teamId(nullable) / ownerUserId / name / description / systemPrompt / model / scope(team|personal) / createdAt`）
- [x] T1.2 新增 `AgentSkillBinding` / `AgentMcpBinding` / `UserSkillBinding` 表（mode: inherit/include/exclude）
- [x] T1.3 新增 `SkillPackage` / `SkillInvocation` 表（scope: global/team/user）
- [x] T1.4 新增 `McpServer` 表（scope: global/team/user，config 加密存储）
- [x] T1.5 新增 `DelegationTree` 表（rootSessionId / parentSessionId / childSessionIds / mode / depth / status）
- [x] T1.6 新增 `InviteLink` 表（teamId / token / role / expiresAt / usedBy / requireAccount）
- [x] T1.7 新增 `PlatformApiKey` / `UserApiKey` 表（AES-256-GCM 加密，主密钥由环境变量持有）
- [x] T1.8 扩展 `Quota`（或并入 User/Team）：tokenDailyLimit / maxConcurrentSessions（=活跃会话数）
- [ ] T1.9 `Session` 确认已挂 `userId + projectId`（若缺 projectId 则补迁移）
- [ ] T1.10 编写并运行 `prisma migrate dev` 生成 PostgreSQL 迁移，回滚可复现

## 2. 后端：Agent 运行时与绑定接缝

- [ ] T2.1 修 `lib/rpc-manager.ts` 缓存键：从 `getOrCreateServices(cwd, agentDir)` 改为纳入技能/扩展作用域 hash（如 `getOrCreateServices(cwd, scopeHash)`），避免按 agentId 绑定被击穿
- [ ] T2.2 在 `lib/tool-presets.ts` 实现技能四层解析（global → team → user → agent），按 `agentId` 计算有效技能集
- [ ] T2.3 在 `lib/tool-presets.ts` 实现 MCP 四层解析（global → team → user → agent），按 `agentId` 计算有效 MCP Server 列表
- [ ] T2.4 在 `spawnSession(opts)` 中按 `agentId` 四层解析后，经 `createAgentSessionServices` 的 `resourceLoaderOptions` 注入技能（`skillsOverride` / `additionalSkillPaths` / `noSkills`）与 MCP 扩展（`extensionsOverride` / `additionalExtensionPaths`）
- [ ] T2.5 会话层工具级约束：经 `createAgentSessionFromServices` 的 `tools` / `customTools` / `excludeTools` 参数
- [ ] T2.6 每次 spawn 注入按租户的 `SettingsManager` 与 `AuthStorage`（InMemory，按请求注入 BYOK 密钥）

## 3. 后端：多 Agent 编排（Supervisor）

- [x] T3.1 实现 `DelegateAgentTool`（`defineTool`）：执行体内部创建子 `createAgentSessionFromServices` 并 `prompt()`，等待结果返回
- [x] T3.2 Supervisor 发现子 Agent：注入时按 `teamId`（个人按 `ownerUserId`）查出「可用数字员工目录」作为候选上下文
- [x] T3.3 三种委派模式：同步 / 并行（≤8）/ 异步（task_id + taskOutput 回填）
- [x] T3.4 委派护栏：深度 ≤ 3、子 Agent 结果截断 4000 字符、子 Agent 禁用清单（delegate*/remember*/setGoal*/create_employee 等）
- [x] T3.5 委派专用池：仅根 Supervisor 会话计入 per-user 上限；派生子会话独立计数、token 滚回根会话
- [x] T3.6 `DelegationTree` 持久化：记录委派父子树，支持断点恢复
- [x] T3.7 事件回流：子 Agent 的 tool_update/message 经 Supervisor 转发到根会话 SSE

## 4. 后端：API 端点

- [x] T4.1 `/api/digital-employees`：数字员工 CRUD + 绑定技能/MCP（避开现有 `/api/agent/*` 会话端点）
- [x] T4.2 `/api/admin/users` 扩展：停用/启用/重置密码/删除（现有仅创建）
- [ ] T4.3 `/api/admin/teams`：团队混合生命周期（创建/成员管理/配额/邀请链接）
- [ ] T4.4 `/api/admin/models`：模型清单 + 默认 + 回退顺序 + 平台密钥池（复用 `/api/models-config` 文件式配置）
- [x] T4.5 `/api/admin/mcp`：MCP Server CRUD + 按团队/Agent 绑定
- [ ] T4.6 `/api/admin/audit`：审计日志查询（身份/鉴权/配额/绑定变更 + MCP 调用 + 技能安装）
- [ ] T4.7 `/api/auth/refresh` 复用：Vue3 登录页对接 refresh 续期

## 5. 后端：技能系统多租户化

- [ ] T5.1 扩展 `/api/skills/install`：支持 global/team/user 作用域（现有仅 global/project）
- [ ] T5.2 扩展 `/api/skills/search`：返回作用域过滤后的技能列表
- [ ] T5.3 扩展 `/api/plugins`：按 global/team/user/agent 解析并强制按 tenant 过滤
- [ ] T5.4 对话中 `/<skill>` 显式调用：映射到 `disableModelInvocation` 技能
- [ ] T5.5 模型自决 `<skill>` 块：经 `parseSkillBlock` 解析并注入指令，前端可视化提示

## 6. 前端：Vue3 统一主界面（apps/dashboard）

- [ ] T6.1 单一入口 + RBAC 菜单渲染：工作区/我的资源（所有用户）、团队（OWNER）、平台管理（管理员）
- [ ] T6.2 登录页：用户名+密码登录，对接 refresh token 续期；新用户首次登录强制改密
- [ ] T6.3 工作空间屏：统计卡片（今日会话/Token/活跃 Agent/MCP/技能）、最近会话、快捷操作
- [ ] T6.4 Agent 工作台屏：会话列表 + 对话区（SSE 流式打字机）+ 当前 Agent/工具面板；支持 `/<skill>` 与 `@MCP` 提示
- [ ] T6.5 多 Agent 编排屏：任务输入 + 模式切换（同步/并行/异步）+ 编排树实时展示 + 执行日志/结果
- [ ] T6.6 数字员工屏：列表（团队预置只读继承 + 个人可编辑）+ 创建/编辑/克隆为个人 + 绑定技能/MCP 界面
- [ ] T6.7 技能中心屏：已安装列表（按作用域）+ 市场搜索 + 安装/启停
- [ ] T6.8 我的设置屏：个人资料 + BYOK API Key 管理 + 默认模型 + 故障回退开关 + 我的配额
- [ ] T6.9 团队管理屏（OWNER）：团队列表 + 创建团队 + 成员管理（角色/移除）+ 配额设置 + 邀请链接
- [ ] T6.10 平台管理屏（管理员）：用户管理 + 模型配置 + MCP 精选库 + 技能精选库 + 审计日志 + 监控大盘（ECharts）
- [ ] T6.11 状态管理：Pinia stores（auth / user / team / agent / skill / mcp / session）
- [ ] T6.12 路由守卫：未登录跳登录页；按角色过滤菜单；API 401 自动刷新 token

## 7. 安全与凭证

- [ ] T7.1 AES-256-GCM 加密模块：MCP / 模型 API Key 加密存储，主密钥由环境变量持有
- [ ] T7.2 租户上下文强制：所有 DB 查询与 Agent 调用带 `tenantId`，禁止客户端传入
- [ ] T7.3 会话正文隐私：平台管理员仅可看会话元数据（标题/时间/token 用量），不可读正文
- [ ] T7.4 级联删除：删除技能/MCP/Agent 时清理其绑定行
- [ ] T7.5 refresh token 置 httpOnly + CSRF 防护

## 8. 测试与验证

- [ ] T8.1 单元测试：技能/MCP 四层解析、委派护栏、配额计算、加密模块
- [ ] T8.2 集成测试：数字员工 CRUD + 绑定、多 Agent 编排端到端、SSE 流式、RBAC API 权限
- [ ] T8.3 E2E 测试（Playwright）：登录 → 创建数字员工 → 发起对话 → 发起多 Agent 任务 → 管理后台操作
- [ ] T8.4 覆盖率 ≥ 80%

## 9. 文档与收尾

- [ ] T9.1 更新 README / AGENTS.md（Vue3 主界面 + 数字员工 + 编排使用说明）
- [ ] T9.2 更新 `docs/plans/2026-07-15-ai-agent-workshop-personal-workspace-design.md` 状态为"已评审，由 M3 实现"
- [ ] T9.3 运行 `comet-guard m3-vue3-workbench open --apply` 确认三件套完整，进入 design 阶段

---

## 阶段依赖

```
T0 Spike/基线 → T1 数据模型 → T2 运行时接缝 → T3 编排 → T4 API → T5 技能 → T6 前端 → T7 安全 → T8 测试 → T9 文档
（T2/T3 可并行；T4/T5 可并行；T6 依赖 T2/T4/T5 的 API 契约）
```
