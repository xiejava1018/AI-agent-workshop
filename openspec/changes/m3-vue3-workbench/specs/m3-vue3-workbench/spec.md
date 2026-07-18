# Delta Spec：M3 Vue3 工作台 + 数字员工 + 多 Agent 编排 + 技能/MCP 按 Agent 绑定

> Change: m3-vue3-workbench
> Date: 2026-07-16
> 基于 proposal.md / design.md / tasks.md，并补齐 brainstorming 中发现的验收场景缺口。

---

## ADDED Requirements

### Requirement: Vue3 统一前端主界面（apps/dashboard）

系统 SHALL 提供基于 Vue3 + Element Plus + Pinia + Vue Router 的统一前端 `apps/dashboard`，作为用户面对 Agent 的主界面与管理后台。前端 SHALL 通过 Vite proxy `/api` 同源转发到 `apps/web` 后端，并 SHALL 按 RBAC 权限矩阵渲染菜单。

#### Scenario: 登录后按角色渲染菜单

- **GIVEN** 用户已登录
- **WHEN** 用户角色为普通 MEMBER
- **THEN** 菜单仅显示「工作区」「我的资源」等基础项
- **AND** 不显示「团队管理」「平台管理」入口

- **WHEN** 用户角色为团队 OWNER
- **THEN** 菜单额外显示「团队管理」
- **WHEN** 用户角色为平台管理员
- **THEN** 菜单额外显示「平台管理」（用户/模型/MCP/技能/审计/监控）

#### Scenario: Vue3 发起 Agent 对话并流式展示

- **GIVEN** 用户已登录且有可用数字员工
- **WHEN** 在 Agent 工作台屏选择一个数字员工并发送消息
- **THEN** 前端通过 SSE 连接到 `/api/agent/[id]/events`
- **AND** 对话区以打字机效果流式渲染响应
- **AND** 会话可持久化并在会话列表中切换

---

### Requirement: 数字员工（Agent）一等公民实体

系统 SHALL 提供 `Agent` 表作为数字员工的唯一存储，支持 `scope ∈ {team, personal}`，不引入独立的 `AgentTemplate` 表。后端路由 SHALL 使用 `/api/digital-employees`，避开现有 `/api/agent/*` 会话端点。

#### Scenario: 创建团队数字员工

- **WHEN** 团队 OWNER/ADMIN 调用 `POST /api/digital-employees` 创建 `scope=team` 的数字员工
- **THEN** 系统创建记录，团队成员可通过所属 Team 使用
- **AND** 该数字员工对团队成员只读继承，仅创建者/管理员可编辑

#### Scenario: 创建个人数字员工

- **WHEN** 用户调用 `POST /api/digital-employees` 创建 `scope=personal` 的数字员工
- **THEN** 系统创建记录，仅创建者自己可用
- **AND** 其他用户不可见、不可调用

#### Scenario: 克隆团队数字员工为个人

- **GIVEN** 存在团队数字员工
- **WHEN** 团队成员选择「克隆为个人」
- **THEN** 系统复制一份 `scope=personal` 副本，归该成员所有
- **AND** 副本可独立修改，不影响团队原数字员工

---

### Requirement: 技能/MCP 按 Agent 四层绑定与实时解析

系统 SHALL 实现技能与 MCP 的四层作用域解析（global → team → user → agent），绑定单元为 Agent。解析 SHALL 在每次 `spawnSession` 时实时查库完成，不缓存解析结果。

#### Scenario: 按 Agent 解析有效技能集

- **GIVEN** 某 Agent 的 `AgentSkillBinding` 含 `mode=include` 白名单，且团队/global 层有默认技能
- **WHEN** 调用 `spawnSession(agentId)` 创建会话
- **THEN** 系统按 global → team → user → agent 顺序解析
- **AND** 最终生效技能 = 白名单指定集合（`include`）或继承后移除黑名单（`exclude`）
- **AND** 解析结果立即注入 `resourceLoaderOptions.skillsOverride`

#### Scenario: 绑定修改后新会话立即生效

- **GIVEN** 某 Agent 当前绑定了技能 S
- **WHEN** 管理员/用户修改该 Agent 的绑定，移除技能 S
- **AND** 用户随后新建会话
- **THEN** 新会话中技能 S 不再可用

#### Scenario: 已撤销绑定不再被新会话使用

- **GIVEN** 某 Agent 曾绑定技能 S，且已有历史会话使用过 S
- **WHEN** 管理员撤销该绑定
- **AND** 用户新建会话
- **THEN** 新会话中技能 S 不可用

---

### Requirement: 凭证隔离铁律

系统 SHALL 禁止带凭证的 MCP Server 以 `global` 作用域注册。所有凭证类字段（MCP config、平台/用户 API Key）SHALL 采用 AES-256-GCM 加密存储，主密钥由环境变量 `APP_ENCRYPTION_KEY` 持有。

#### Scenario: 带凭证 MCP 绑定到 global 被拒绝

- **WHEN** 管理员尝试创建 `scope=global` 且 config 包含凭证字段的 MCP Server
- **THEN** 系统返回 400/403，拒绝创建
- **AND** 在 `AuditLog` 中记录 `mcp.credential_global_denied` 事件

#### Scenario: 凭证不跨租户泄漏

- **GIVEN** 团队 A 配置了带凭证的 MCP Server
- **WHEN** 团队 B 的用户创建会话
- **THEN** 该会话的 MCP 解析结果中不包含团队 A 的带凭证 MCP
- **AND** 任何尝试读取团队 A 凭证的请求返回 403

---

### Requirement: 多 Agent 编排（Supervisor）

系统 SHALL 提供 `DelegateAgentTool`（`defineTool`），支持 Supervisor 在 Node 进程内创建子 Agent 会话并同步/并行委派任务。M3 阶段 SHALL 支持深度 ≤2、并行 ≤8；异步以 `task_id` 占位，真正后台队列留待 M4。

#### Scenario: Supervisor 同步委派子 Agent

- **GIVEN** Supervisor 已注入可用数字员工目录
- **WHEN** Supervisor 调用 `DelegateAgentTool` 传入 `{ agentId, task, mode: "sync" }`
- **THEN** 系统创建子 Agent 会话并执行 `prompt(task)`
- **AND** 子 Agent 结果经 `session.subscribe` 回流到 Supervisor
- **AND** 子 Agent 结果截断为 4000 字符后返回给 Supervisor

#### Scenario: 并行委派上限与失败隔离

- **WHEN** Supervisor 同时发起 8 个并行子 Agent
- **THEN** 8 个任务同时执行
- **WHEN** 其中 1 个失败
- **THEN** 其余 7 个正常完成，失败结果在聚合中标记为 error

#### Scenario: 委派深度护栏

- **WHEN** 当前委派深度已达 2
- **AND** 子 Agent 尝试再次调用 `DelegateAgentTool`
- **THEN** 系统拒绝该调用，返回错误提示深度超限

#### Scenario: 委派专用池与配额滚回

- **GIVEN** 用户当前已有 5 个活跃会话（达到 per-user 上限）
- **WHEN** 用户发起一个 Supervisor 多 Agent 任务
- **THEN** 根 Supervisor 会话计入配额（若超限则拒绝）
- **AND** 其派生的子会话不计入 per-user 上限
- **AND** 子会话的 token 用量滚回根会话统一计费

---

## MODIFIED Requirements

### Requirement: 会话元数据入库（Session 表）

现有基于 `.jsonl` 文件的会话机制 SHALL 扩展为「元数据入库 + 正文仍走文件」。`Session` 表 SHALL 包含 `id / userId / teamId / projectId / title / status / tokenUsage / jsonlPath / createdAt / updatedAt`。

#### Scenario: 创建会话时同时写文件和元数据

- **WHEN** 用户通过 Vue3 或 API 创建新会话
- **THEN** 系统在 `Session` 表插入元数据记录
- **AND** 在文件系统创建对应 `.jsonl` 文件
- **AND** 两者通过 `jsonlPath` 关联

#### Scenario: 会话列表查询走数据库

- **WHEN** Vue3 请求当前用户的会话列表
- **THEN** 后端查询 `Session` 表按 `userId + teamId` 过滤并分页返回
- **AND** 不扫描文件系统

### Requirement: rpc-manager 缓存键按作用域 hash 重建

`lib/rpc-manager.ts` 的 `getOrCreateServices(cwd, agentDir)` SHALL 改为 `getOrCreateServices(cwd, scopeHash)`，其中 `scopeHash` 由该 Agent 的有效技能集与 MCP Server 列表计算得出，避免同一 Project 下不同 Agent 的绑定被缓存击穿。

#### Scenario: 同一 Project 下不同 Agent 获得不同技能集

- **GIVEN** 同一 Project（相同 cwd）下有 Agent A（绑定技能 X）和 Agent B（绑定技能 Y）
- **WHEN** 先后为 Agent A 和 Agent B 创建会话
- **THEN** Agent A 的会话仅注入技能 X
- **AND** Agent B 的会话仅注入技能 Y
- **AND** 两者 `resourceLoader` 不复用

### Requirement: 技能/插件 API 多租户扩展

现有 `/api/skills/*` 和 `/api/plugins` SHALL 扩展支持 `global/team/user` 作用域过滤，并按 tenant 强制隔离。

#### Scenario: 用户仅看到本团队可见技能

- **WHEN** 团队 A 用户调用 `GET /api/skills/search`
- **THEN** 返回结果仅包含 `scope=global`、`scope=team AND teamId=A`、`scope=user AND userId=当前用户` 的技能
- **AND** 不包含其他团队的技能

---

## REMOVED Requirements

无。本期不删除既有能力，React UI 保留为开发/参考界面。
