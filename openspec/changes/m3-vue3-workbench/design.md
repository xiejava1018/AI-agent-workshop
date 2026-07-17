# 设计：M3 Vue3 工作台 + 数字员工 + 多 Agent 编排 + 技能/MCP 按 Agent 绑定

> change: m3-vue3-workbench
> 日期：2026-07-16
> 配套：proposal.md、docs/design/产品设计文档.md、docs/ui-design/*.html

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  apps/dashboard (Vue3 + Element Plus + Pinia + Vue Router)    │
│  唯一面向用户的 UI：用户主界面 + 管理后台（单一入口，RBAC 渲染） │
│  通过 vite proxy '/api' → apps/web 后端                         │
└───────────────────────────┬─────────────────────────────────┘
                              │  /api  (REST + SSE 流式)
┌───────────────────────────▼─────────────────────────────────┐
│  apps/web (Next.js 16 / React 19)  =  后端 API + Agent 运行时   │
│  · Route Handlers 暴露 REST /api/* 与流式端点                   │
│  · lib/rpc-manager.ts：Pi Agent 会话工厂（spawnSession）        │
│  · lib/team-auth.ts：多租户上下文推导与隔离                      │
│  · lib/tool-presets.ts：技能/MCP 四层解析                       │
│  · Prisma + PostgreSQL（生产库已提供）                          │
│  · Pi Agent 0.80.6：AgentSession / SessionManager / defineTool   │
└─────────────────────────────────────────────────────────────┘
```

关键修正：Vue3 不再是"纯管理台"，而是**用户面对 Agent 的主界面 + 管理后台**；React 那层（apps/web）定位为后端 API 与 Agent 运行时宿主，自带 React UI 保留为开发/参考界面。

## 2. 技术栈

| 层 | 技术 | 版本/说明 |
|---|---|---|
| Agent 引擎 | `@earendil-works/pi-coding-agent` | 0.80.6 |
| 后端/运行时 | Next.js (React) | 16.2.9；Route Handlers 作 API + 流式 |
| 前端主界面 | Vue 3 + Element Plus + Pinia + Vue Router | apps/dashboard；Tailwind + ECharts |
| 持久化 | Prisma + PostgreSQL | 生产库已提供 PostgreSQL |
| 鉴权 | jose (JWT) + bcryptjs | access(15min)+refresh(7d) 双 token |
| 工具/扩展 | Pi Agent `defineTool` + `Extension` 系统 | 内置工具 + pi-mcp-extension（C1 Spike） |
| 技能系统 | Pi Agent `Skill` / `parseSkillBlock` + 现有 `/api/skills/*`、`/api/plugins` | 需补多租户作用域与前端 |
| 工程 | pnpm monorepo + OpenSpec | 变更以 proposal/spec/tasks 驱动 |

## 3. 多租户与隔离模型

- **模型**：沿用现有 `Team / TeamMember / Project / User / Role`；新增一等公民 **`Agent`（数字员工）**。
- **上下文推导**：所有请求经 `middleware.ts` + `lib/team-auth.ts` 解析出 `tenantId / userId / teamId`，后续 DB 查询与 Agent 调用强制带该上下文。
- **会话与项目目录绑定（B2 取舍）**：`Session` 同时挂 `userId`（会话隔离）+ `projectId`（`cwd` 指向团队共享项目目录）。本期不对文件并发写做应用层互斥，仅审计记录；M5 视情况引入文件锁。
- **配额**：`lib/session-cap.ts` 已实现 `Map<userId, count>`（每用户默认 5，全局 50 兜底）；并发数 = 活跃会话数（A1 拍板）。
- **防泄漏铁律**：tenantId 一律由服务端推导，绝不信任客户端传入；所有查询强制按 tenant 过滤。

### 3.1 Team 生命周期（混合模式）

- 用户自建团队（自动成为 OWNER）；管理员可拉人；团队可生成邀请链接（带时效/一次性 token，可选审批）。
- 邀请链接定位为"把已有平台账号的跨团队/跨组织成员拉入本团队"的自助入口，不面向全新外部人；全新外部人走"管理员开通账号 → OWNER 发邀请 → 用户接受加入"。

### 3.2 模型与凭证配置（双层）

- **管理员层**：通过 `ModelRegistry` + `modelsPath` 配置可用模型清单 + 默认模型 + 故障回退顺序；平台级 API Key 池供共享额度。本期补管理后台「模型配置」界面，复用 `/api/models-config` 文件式配置为单真相源。
- **用户层（BYOK）**：用户可在「我的设置」为各 provider 填 API Key；带个人密钥的厂商优先用个人 key，未填才走平台共享额度。
- **故障自动回退**：主模型不可用时按管理员配置的回退列表自动切换；用户侧可开关。

### 3.3 角色与权限矩阵

| 维度 | 平台管理员 | 团队 OWNER | 团队 ADMIN | 团队 MEMBER |
|---|---|---|---|---|
| 用户开通/停用 | ✅ | ❌ | ❌ | ❌ |
| 创建团队 | ✅ | ✅（自建即 OWNER） | ❌ | ❌ |
| 团队成员/角色管理 | 全部团队 | 仅本团队 | 仅本团队 | ❌ |
| 团队配额设置 | ✅ | ✅ | ❌ | ❌ |
| 安装全局精选技能 | ✅（仅无凭证） | ❌ | ❌ | ❌ |
| 配置带凭证 MCP | 平台级全局公共服务 ✅；团队级由 OWNER/ADMIN 在本团队配 | ✅本团队 | ✅本团队 | ❌ |
| 读其他团队会话/凭证 | ❌（仅治理视图，仅可看会话元数据：标题/时间/token 用量，不可读会话正文） | ❌ | ❌ | ❌ |
| 创建/使用数字员工 | 可 | 本团队+个人 | 本团队 | 个人+团队预置 |

> 铁律：任何角色均不可读其他团队的会话内容与 MCP 凭证；团队 ADMIN ≠ 平台管理员。

## 4. Agent 运行时层（接缝设计）

`apps/web/lib/rpc-manager.ts` 已是 Pi Agent 集成核心。本层设计要点：

- 会话工厂对外暴露统一接口 `spawnSession(opts)`，opts 内含 `tenantId / userId / teamId / agentId / systemPrompt / model`。**skills 与 MCP 工具不再在此硬编码**，而是由 `agentId` 经四层解析得出有效作用域后，通过 `resourceLoaderOptions` 注入。
- 注入机制（已对照 SDK 0.80.6 实际签名修正）：技能经 `createAgentSessionServices` 的 `resourceLoaderOptions.skillsOverride` / `additionalSkillPaths` / `noSkills` 注入；MCP 扩展经 `resourceLoaderOptions.extensionsOverride` / `additionalExtensionPaths` 注入；会话层 `createAgentSessionFromServices` 仅接受 `tools: string[]` / `customTools` / `excludeTools` 作工具级约束。
- **缓存键修正（避免 per-agent 绑定被击穿）**：现有 `getOrCreateServices(cwd, agentDir)` 按 `cwd` 缓存并复用同一 `resourceLoader`，同一 Project（cwd）下不同数字员工会拿到同一份技能/扩展。须把缓存键改为纳入「技能/扩展作用域 hash」或按作用域重建 services（如 `getOrCreateServices(cwd, scopeHash)`），否则绑定不生效。
- 每次 spawn 注入按租户的 `SettingsManager` 与 `AuthStorage`（InMemory 后端，按请求注入 BYOK 密钥）。
- 流式：会话事件经 `session.subscribe` 收集，由 Next.js SSE 端点推给 Vue3。

## 5. 多 Agent 编排设计（Supervisor）

### 5.1 现状

Pi Agent 无原生子 Agent / Supervisor，必须自建。

### 5.2 组件

```
User
  │ 发起「多 Agent 任务」
  ▼
Supervisor (协调者，本身是一个 AgentSession)
  │ 用 ReAct 或 Plan-and-Execute 拆解任务
  ▼
DelegateAgentTool (一个 defineTool)
  │ 内部调用 createAgentSessionFromServices 创建子 Agent
  ├─ 子 Agent A（如：调研）
  ├─ 子 Agent B（如：编码）   ← 支持 同步 / 并行 / 异步
  └─ 子 Agent C（如：审查）
  │ 子 Agent 结果经 session.subscribe 回流
  ▼
Supervisor 汇总 → 返回用户
```

### 5.3 关键设计决策

- **委派协议**：实现 `DelegateAgentTool`（标准 `defineTool`），执行体在 Node 端新建子 `createAgentSessionFromServices` 实例并 `prompt()`，等待结果后返回。
- **Supervisor 如何发现子 Agent**：`DelegateAgentTool` 注入时由 `spawnSession` 按当前 `teamId`（个人数字员工按 `ownerUserId`）查出「可用数字员工目录」作为候选上下文传给 Supervisor；LLM 据此涌现式决定委派给哪个数字员工。不可仅靠用户裸打字枚举 Agent。
- **深度限制**：委派树默认最深 3 层；Supervisor 在拆解时校验深度，超出则改为单 Agent 直答或报错。
- **委派模式**：同步 / 并行 / 异步三种；异步以 `task_id` + `taskOutput` 回填；并行上限 8。
- **状态与错误**：每个子 Agent 独立 try/catch；失败不影响兄弟节点；Supervisor 负责错误聚合与重试。
- **会话配额口径**：仅根 Supervisor 会话计入用户的 per-user 会话上限；派生子会话走「委派专用池」（独立计数、不计入 5/50、带 depth/owner 归属），其 token 用量滚回根会话统一计费。
- **持久化**：`SessionManager.branch()/fork()` 只是单会话内部历史分支，不能表达跨会话父子树。须自建 `DelegationTree` 记录 `rootSessionId / parentSessionId / childSessionIds / mode / depth / status`，支持界面树状展示与断点恢复。
- **可见性**：子 Agent 的执行事件经 Supervisor 转发，Vue3 以树状/时间线展示。

### 5.4 Agent（数字员工）实体：绑定的基本单元

- **实体**：新增 `Agent`（数字员工）一等公民——`id / teamId(nullable) / ownerUserId / name / description / systemPrompt / model / scope(team|personal) / createdAt`。**单一 `Agent` 表承载所有数字员工，不新增独立的 `AgentTemplate` 实体（A2 拍板）**。
  - 团队数字员工：`teamId` 必填、`scope=team`，成员通过所属 Team 间接使用；可"设为团队默认"。
  - 个人数字员工：`teamId` 可空、`ownerUserId` 必填、`scope=personal`，仅创建者自己可用。
- **绑定单元**：skills 与 MCP 绑定到 Agent（`AgentSkillBinding` / `AgentMcpBinding`），而非直接绑 Team。Team 层只做"预装/精选"。
- **有效作用域解析（四层继承）**：
  1. `global`（全站精选库）——仅管理员安装的无凭证通用能力；
  2. `team`（团队预装层）——团队默认继承；
  3. `user`（个人覆盖层，仅 personal 数字员工/个人会话生效）——个人安装的技能/MCP；纯指令型技能可完全 user 独立安装，若含凭证/绑定 MCP 仍受团队凭证隔离铁律约束；
  4. `agent`（数字员工最终绑定单元）——在此收敛。
  - 解析顺序：global → team → user → agent；`agent` 层的 mode 决定最终生效集（inherit=继承 / include=仅白名单 / exclude=显式禁用）。绝不跨 tenant 推导，禁止客户端指定目录。
- **与多 Agent 编排天然统一**：编排中的子 Agent 即一个 `Agent` 实体实例，自动获得其绑定的技能/MCP。
- **命名空间**：新增数字员工实体后端路由须避开现有的 `/api/agent/[id]`、`/api/agent/new`（它们是会话端点），用 `/api/digital-employees`。

## 6. 技能（Skill）系统

### 6.1 现状

- Pi Agent SDK 提供 `Skill` 类型、`loadSkills`、`parseSkillBlock`。
- 本仓库 `apps/web` 已有后端雏形：`/api/skills/install`、`/api/skills/search`、`/api/plugins`。
- **缺口**：① 多租户——现有按 `cwd` + global/project 装载，无 team/user 维度；② 运行时接合——技能目录尚未按 tenant 喂给会话工厂；③ 前端——无 Vue3 技能界面。

### 6.2 技能格式与作用域

- 格式：复用 OpenClaw / Claude 的 `SKILL.md`（YAML frontmatter + Markdown 指令体）。
- **隔离模型**：默认「团队隔离 + 全局精选」，绑定单元下探到 Agent。
  - `global`：仅管理员安装通用、无凭证风险的技能，全员可用；
  - `team`：管理员/OWNER 把团队常用技能预装到 Team 作用域，团队内所有 Agent 默认继承；
  - `agent`：每个 Agent 可在 team/global 基础上显式授予白名单或排除；
  - `user`：个人安装的技能仅自己可见，非默认开启；纯指令型技能可完全 user 独立安装，若含凭证/绑定 MCP 仍受铁律约束。
  - 某 Agent 的有效技能 = 四层继承后得出，绝不跨 tenant 分发。

### 6.3 多租户装载（接缝）

- 在 `lib/rpc-manager.ts` 的 `spawnSession(opts)` 中，按 `agentId` 四层解析出该 Agent 的有效技能集，再通过 `createAgentSessionServices` 的 `resourceLoaderOptions` 注入（`skillsOverride` / `additionalSkillPaths` / `noSkills`）。
- 复用现有 `DefaultPackageManager` 解析能力，但把"作用域"从 global/project 扩展到 global/team/user/agent，并强制按 tenant 过滤。

### 6.4 调用方式与界面（Vue3）

- **显式**：对话输入框支持 `/<skill>` 前缀，映射到 `disableModelInvocation` 技能。
- **模型自决**：Agent 识别需求后自动产出 `<skill>` 块，前端给出可视化提示。
- **技能中心页**：浏览/搜索市场、安装到团队/全局、启停、查看作用域与元信息。

## 7. MCP 工具生态设计

### 7.1 现状

`apps/web` 零 MCP；`pi-mcp-extension` 为社区包，未安装（C1 Spike：验证 Node22 + Pi Agent 0.80.6 兼容性、stdio/SSE/Streamable HTTP 三传输、许可证）。

### 7.2 引入方式

安装 `@earendil-works/pi-mcp-extension`（或社区等价包），通过 Pi Agent 的 `Extension` 系统注册 MCP Server。支持传输：stdio / SSE / Streamable HTTP。

### 7.3 per-team / per-agent 绑定

- Pi Agent 核心不自动隔离工具，由调用方控制某会话拿到哪些工具。
- **绑定单元 = Agent（数字员工）**：在 `lib/tool-presets.ts` 按 `agentId` 四层解析出该数字员工的有效 MCP Server 列表。MCP 扩展经 `createAgentSessionServices` 的 `resourceLoaderOptions.extensionsOverride` 注入；工具级约束经 `createAgentSessionFromServices` 的 `tools` 参数。
- 绑定关系存库（新增 `McpServer`、`AgentMcpBinding`），管理员/OWNER 在 Vue3 后台配置。
- **凭证隔离铁律**：带凭证的 MCP Server 严禁全局共享；一律 `team` 或 `user` 作用域绑定，按 tenant 过滤只注入本租户会话。全局层仅允许挂载无凭证的公共服务。

## 8. 鉴权与会话

- 已实现（M2.3）：`LocalPasswordAuthProvider`（移除自动注册）、`POST /api/admin/users`、`POST /api/auth/refresh`、双 token、jti 黑名单、`per-user session cap`。
- 本期复用并加固：Vue3 登录页对接 refresh 续期；管理操作需 OWNER/ADMIN scope。

## 9. 流式传输（到 Vue3）

- `apps/web` 已有 agent 流式端点（基于 Pi Agent 进程内事件）。需确认其传输方式（SSE 或 WS）与事件格式。
- Vue3 通过 vite proxy `/api` 同源转发；前端用 EventSource / WebSocket 消费流式，渲染打字机效果。
- **待验证（C2 Spike）**：dashboard 当前 `src/mock` 占比、SSE/WS 事件格式是否与 Pi Agent 进程内事件对齐。

## 10. 数据模型（Prisma + PostgreSQL）

已有：`User`、`Team`、`TeamMember`、`Role`(enum)、`Project`、`Session`（同时挂 `userId` + `projectId`）、`SessionShare`、`RefreshTokenBlacklist`、`AuditLog`。

本期新增（建议）：

- `Agent`（数字员工）：id、teamId(nullable)、ownerUserId、name、description、systemPrompt、model、scope(team|personal)、createdAt
- `McpServer`：id、name、transport、endpoint/command、config(含凭证，加密存储)、scope(global|team|user)、teamId(nullable)、userId(nullable)、enabled
- `AgentMcpBinding`：agentId、mcpServerId、mode(inherit/include/exclude)
- `SkillPackage`：id、slug、name、description、scope(global|team|user)、teamId(nullable)、userId(nullable)、source、filePath、enabled
- `AgentSkillBinding`：agentId、skillPackageId、mode(inherit/include/exclude)
- `UserSkillBinding`（可选）：userId、skillPackageId、mode
- `SkillInvocation`：id、skillSlug、userId、teamId、agentId、sessionId、createdAt（可并入 `AuditLog`）
- `InviteLink`：id、teamId、token、role、expiresAt、usedBy(nullable)、requireAccount(bool)
- `DelegationTree`：id、rootSessionId、parentSessionId、childSessionIds、mode(sync|parallel|async)、depth、status
- `Quota`：teamId/userId、tokenDailyLimit、maxConcurrentSessions（=并发数，即同时活跃会话数；可并入 User/Team 字段）
- `ModelConfig`：id、provider、modelId、baseUrl(nullable)、isDefault(bool)、fallbackOrder(int)、enabled（注意：本期复用文件式配置为单真相源，此表作为后续可迁 DB 的选项）
- `PlatformApiKey`：id、provider、secret(加密存储)、updatedAt
- `UserApiKey`（BYOK）：userId、provider、secret(加密)、updatedAt
- **凭证加密方式**：MCP / 模型 API Key 一律对称加密 `AES-256-GCM`，主密钥由环境变量持有；M5 迁移 KMS / Vault。绝不明文落库。

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| `pi-mcp-extension` 兼容性/许可证不明 | C1 Spike 先验证；审源码与协议 |
| Pi Agent 无原生多 Agent，Supervisor 自研复杂 | 复用 `DelegateAgentTool` + MateClaw 实测护栏（深度≤3、并行≤8、结果截断 4000、子 Agent 禁用递归/记忆/改目标、事件回流、配额滚回）|
| 通用工具审批钩子缺失 | 先白名单 + bash 钩子；完整审批留 M5 |
| Vue3 与后端流式对接未验证 | C2 Spike 最小对接，确认 `/api` 可被真实消费 |
| PostgreSQL 多租户隔离（应用层强制 tenant 过滤，RLS 留 M5） | 应用层强制 tenant 过滤兜底；Postgres+RLS 留 M5 |
| 技能/工具绑定需下探到 Agent | 新增 Agent 实体 + 绑定表；spawnSession 按 agentId 四层解析后经 `resourceLoaderOptions` 注入 |
| 配置被 AI 自动改导致死锁 | 配置走人工/受控流程，最小权限 |
| 凭证明文存储 / 级联删除缺失 | MCP / 模型 API Key 加密存储；删除技能/MCP/Agent 时级联清理其绑定行；refresh token 置 httpOnly + CSRF 防护 |

## 12. 与 OpenSpec 的衔接

- 本设计文档为高层产品/技术设计；具体实现以 OpenSpec change 推进。
- 已归档：M1（runnable）、M2.2（UI+加固）、M2.3（受控多用户）。
- 本 change 即 M3「Vue3 主界面 + 数字员工(Agent)管理 + 多 Agent 编排 + 技能/MCP 按 Agent 绑定」。团队混合生命周期（自建/邀请）并入 M3/M4。
