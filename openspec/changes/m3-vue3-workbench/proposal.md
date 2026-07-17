# 提案：M3 Vue3 工作台 + 数字员工 + 多 Agent 编排 + 技能/MCP 按 Agent 绑定

> change: m3-vue3-workbench
> 类型：full workflow（brainstorming 必经）
> 日期：2026-07-16
> 依据：docs/prd/产品需求规格说明书.md §7 M3、docs/design/产品设计文档.md、docs/ui-design/*.html、docs/review-clarifications.md

---

## 1. 为什么做

当前 AI-agent-workshop 已完成 M1/M2.2/M2.3（多用户认证、团队/项目、会话·配额级隔离、admin 用户管理），但：

- 前端主界面仍是 Next.js React，不是 PRD 要求的 Vue3 统一前端；
- 没有"数字员工（Agent）"一等公民，技能/MCP 无法按具体 Agent 精细化绑定；
- 没有多 Agent 编排（Supervisor 拆解/委派/汇总）；
- 技能系统只有后端雏形，缺多租户作用域与 Vue3 技能中心；
- `lib/rpc-manager.ts` 按 `cwd` 缓存 services，按 agentId 的绑定会被击穿（设计文档 §4 点名）。

## 2. 做什么（In Scope）

按 PRD §7 M3 交付：

1. **Vue3 统一前端主界面**（apps/dashboard，13 屏）：
   - 单一入口、按 RBAC 权限矩阵渲染菜单（工作区/我的资源/团队 OWNER/平台管理）；
   - 登录（对接 refresh 续期）、工作空间、Agent 对话（SSE 流式）、多 Agent 编排、数字员工、技能中心、我的设置（BYOK）、团队管理（OWNER）、平台管理（用户/模型/审计/监控）。
2. **数字员工（Agent）一等公民实体**：
   - 新增 `Agent` 表（`scope ∈ {team, personal}`，单一表，不新增 AgentTemplate）；
   - `AgentSkillBinding` / `AgentMcpBinding`（绑定单元）；
   - 四层继承解析（global → team → user → agent）；
   - 后端路由 `/api/digital-employees`（避开现有 `/api/agent/*` 会话端点）。
3. **多 Agent 编排（Supervisor）**：
   - `DelegateAgentTool`（defineTool）实现同步/并行/异步三种委派；
   - 深度 ≤ 3 层、并行 ≤ 8、子 Agent 结果截断 4000 字符、委派专用池（仅根会话计入配额）；
   - `DelegationTree` 表持久化委派父子树；
   - 子 Agent 事件经 Supervisor 回流，Vue3 树状/时间线展示。
4. **技能（Skill）系统多租户化 + Vue3 技能中心**：
   - 复用现有 `/api/skills/*`、`/api/plugins`；
   - 扩展 global/team/user 作用域 + agent 绑定；
   - `spawnSession` 按 agentId 四层解析后经 `resourceLoaderOptions` 注入技能/扩展；
   - 对话中支持 `/<skill>` 显式调用与模型自决 `<skill>` 块。
5. **MCP 工具生态按 Agent 绑定**：
   - 引入 `pi-mcp-extension`（C1 Spike 先做）；
   - `McpServer`（scope global/team/user）+ `AgentMcpBinding`；
   - 凭证隔离铁律：带凭证 MCP 绝不全局共享；
   - `rpc-manager.ts` 缓存键修正（按作用域 hash 重建 services）。
6. **管理后台治理**：
   - 用户全生命周期（创建/停用/改密/重置/删除）；
   - 团队混合生命周期（自建/拉人/邀请链接）；
   - 模型配置（复用 `/api/models-config` 文件式单真相源 + 平台密钥池 + BYOK）；
   - 审计日志与监控大盘（ECharts）。

## 3. 不做什么（Out of Scope）

- MateClaw 全套（工作流 DSL、触发器、知识库、多模态、多渠道 IM、企业级 RBAC/信创）；
- 全栈独立文件系统级隔离（每人独立 cwd）——沿用会话·配额级隔离；
- Postgres + RLS 硬隔离、商业许可证审查——留 M5；
- 生产加固（Tool Guard 完整审批流、监控完善）——留 M5。

## 4. 关键口径（已拍板 2026-07-16）

- **A1 并发数**：本期"并发数即同时活跃会话数"，单一维度，不新增独立并发列；UI 中的"并发数"字段改为"活跃会话数"别名。
- **A2 数字员工**：单一 `Agent` 表，`scope ∈ {team, personal}`；团队模板 = `scope=team` 只读继承；克隆为个人 = 复制 `scope=personal` 副本。不新增 `AgentTemplate` 实体。
- **A3 登录入口**：单一登录页，按 RBAC 渲染差异；删除独立管理员登录页。

## 5. 成功标准（Definition of Done）

1. 多用户独立：会话、配额、文件互不干扰，无法越权读取他人数据。
2. Vue3 主界面：用户可在 Vue3 发起 Agent 对话，流式展示，会话可持久化与切换。
3. 多 Agent 编排：Supervisor 正确拆解/委派/汇总，委派树可持久化，界面可见。
4. MCP 工具：管理员可配置并绑定到团队/Agent；子 Agent 能调用绑定工具，不跨团队泄漏。
5. 管理后台：管理员可管理用户/团队/配额，查看审计与监控大盘。
6. 安全基线：双 token 续期正常；per-user session cap 生效；危险操作有审计留痕。
7. 技能能力：界面可浏览/安装/启用技能；对话中可 `/<skill>` 或模型自决触发；按团队隔离不跨租户泄漏。
8. 模型与凭证：管理员可维护模型清单/默认/回退/平台密钥池；用户可 BYOK 优先于平台密钥；主模型故障自动回退生效。

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| `pi-mcp-extension` 兼容性/许可证不明 | C1 Spike 先验证 Node22 + Pi Agent 0.80.6 |
| Vue3 与后端流式对接未验证 | C2 Spike 最小对接，确认 `/api` 可被真实消费 |
| Supervisor 自研复杂 | 复用 `DelegateAgentTool` + MateClaw 实测护栏 |
| 缓存键击穿按 agentId 绑定 | 修 `rpc-manager.ts` 按作用域 hash 重建 services |
| 凭证明文存储 | AES-256-GCM 加密，主密钥由环境变量持有 |
| 配置被 AI 自动改导致死锁 | 配置走人工/受控流程，最小权限 |

## 7. 里程碑衔接

- 本 change 即 PRD §7 的 **M3**。
- M4（MCP 工具生态 + 团队混合生命周期完整版）在本 change 基础上扩展。
- M5（生产加固）后续再议。
