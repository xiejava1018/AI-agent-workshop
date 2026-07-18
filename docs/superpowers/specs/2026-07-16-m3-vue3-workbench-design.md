---
comet_change: m3-vue3-workbench
role: technical-design
canonical_spec: openspec
---

# 技术设计：M3 Vue3 工作台 + 数字员工 + 多 Agent 编排 + 技能/MCP 按 Agent 绑定

> 日期：2026-07-16
> 上游：`openspec/changes/m3-vue3-workbench/`（proposal / design / tasks / specs delta）
> 本文档是 open 阶段 `design.md` 的深度技术细化：实现方案、风险、测试策略、边界条件。

---

## 0. Build 入口门控（必须先做）

在进入任何实现前，以下三项必须通过：

| 门控 | 内容 | 产出 |
|------|------|------|
| T0.1 C1 Spike | 验证 `pi-mcp-extension` 在 Node 22 + Pi Agent 0.80.6 下安装、stdio/SSE/Streamable HTTP 三传输、许可证兼容 | `docs/spikes/2026-07-16-pi-mcp-extension.md` |
| T0.2 C2 Spike | 验证 `apps/web` 现有 SSE 端点可被 Vue3 经 Vite proxy + `EventSource` 真实消费；确认 dashboard `src/mock` 占比 | `docs/spikes/2026-07-16-vue3-api-spike.md` |
| T0.3 基线门禁 | `pnpm install`、`pnpm --filter @ai-agent-workshop/web build`、`pnpm --filter @ai-agent-workshop/dashboard build` 全通过 | 终端输出 |

**降级策略**：若 C1 Spike 判定 `pi-mcp-extension` 不兼容，M3 降级为「预留 MCP 扩展点 + DB 表结构」，不实际接入 MCP 扩展包，其余范围不变。

---

## 1. 前端：Vue3 统一主界面（减法改造）

**决策**：保留 `apps/dashboard` 现有模板基底（vue-pure-admin 风格），做减法改造，不推倒重建。React UI（apps/web）保留为开发/参考界面。

**减法清单**：
- 删除模板自带演示页（article/comment/地图/工作流/图表 demo 等）与 `src/mock` 数据。
- 保留并复用：登录页骨架、RBAC 动态菜单、Pinia、路由守卫、Element Plus 布局、工程化（husky/eslint/stylelint）。

**13 屏**（单一入口、按 RBAC 渲染）：登录、工作空间、Agent 工作台、多 Agent 编排、数字员工、技能中心、我的设置（BYOK）、团队管理（OWNER）、平台管理（用户/模型/MCP/技能/审计/监控）。

**对接契约**：Vite proxy `/api` → `apps/web`；SSE 用 `EventSource` 消费 `/api/agent/[id]/events`；401 自动刷新 token（`POST /api/auth/refresh`）。

**权限契约**：菜单渲染与后端权限点对齐——MEMBER（工作区/我的资源）、OWNER（+团队管理）、平台管理员（+平台管理）。前端隐藏 ≠ 后端放行，所有 API 仍由服务端强制鉴权。

---

## 2. 数据模型（Prisma + PostgreSQL）

**provider 修正**：`datasource db { provider = "postgresql" }`（当前 schema 误写 sqlite），基于现有 4 个 migration 生成 PG baseline。

**新增表**：

```
Agent(id, teamId?, ownerUserId?, name, description, systemPrompt, model, scope[team|personal], createdAt)
SkillPackage(id, slug, name, description, scope[global|team|user], teamId?, userId?, source, filePath, enabled)
AgentSkillBinding(agentId, skillPackageId, mode[inherit|include|exclude])
UserSkillBinding(userId, skillPackageId, mode)
McpServer(id, name, transport[stdio|sse|http], endpoint/command, configEnc, scope[global|team|user], teamId?, userId?, enabled)
AgentMcpBinding(agentId, mcpServerId, mode)
Session(id, userId, teamId, projectId?, title, status, tokenUsage, jsonlPath, createdAt, updatedAt)
DelegationTree(id, rootSessionId, parentSessionId?, childSessionId, mode[sync|parallel|async], depth, status)
InviteLink(id, teamId, token, role, expiresAt, usedBy?, requireAccount)
PlatformApiKey(id, provider, secretEnc, updatedAt)
UserApiKey(userId, provider, secretEnc, updatedAt)
```

**加密**：`configEnc / secretEnc` 用 AES-256-GCM，主密钥 = `process.env.APP_ENCRYPTION_KEY`，绝不明文落库。M5 迁移 KMS/Vault。

**关键取舍**：
- `Session` 只存元数据 + `jsonlPath` 指针，正文仍走 `.jsonl`——保 Pi Agent 兼容性与性能，列表/治理查询走 SQL。
- 团队模板 = `scope=team` 只读继承；克隆为个人 = 复制 `scope=personal` 副本。无 `AgentTemplate`。
- `tenantId` 一律服务端推导，所有查询强制 tenant 过滤。

---

## 3. Agent 运行时与绑定接缝（核心）

**现状痛点**：`getOrCreateServices(cwd, agentDir)` 按 `cwd` 缓存复用同一 `resourceLoader`，同一 Project 下不同 Agent 拿到同一份技能/扩展 → 绑定被击穿。

**修复：两级分离**

```
Layer 1  resourceLoader 缓存   key = sha256(有效技能集 + 有效MCP集)
         作用域相同的会话复用已加载资源，避免重复 IO
Layer 2  绑定解析            实时查库，不缓存（保证绑定实时生效）
```

**spawnSession 调用链**：
1. `opts` 含 `tenantId/userId/teamId/agentId/systemPrompt/model`。
2. `resolveAgentScopes(agentId)`：global → team → user → agent 四层解析，每层 `mode` 在 agent 层收敛。
3. `scopeHash = sha256(skills + mcpServers)`。
4. `getOrCreateServices(cwd, scopeHash)`，经 `resourceLoaderOptions` 注入：
   - 技能：`skillsOverride / additionalSkillPaths / noSkills`
   - MCP：`extensionsOverride / additionalExtensionPaths`
5. `createAgentSessionFromServices(services, { tools, customTools, excludeTools })`。
6. 注入按租户 `SettingsManager` + `AuthStorage`（InMemory，BYOK 密钥）。

**凭证隔离落实**：解析时若发现 `global` 层挂带凭证 MCP → 拒绝 + 记审计 `mcp.credential_global_denied`。

**边界条件**：
- 解析后零技能/零 MCP → `noSkills: true`，会话可起，无扩展能力。
- 绑定到 `enabled=false` 的 MCP → 解析层过滤，不注入。
- 个人数字员工（`scope=personal`）跳过 `team` 层，走 global → user → agent。

---

## 4. Supervisor 多 Agent 编排（自研）

**决策**：完全自研 `DelegateAgentTool`（`defineTool`），Node 进程内，不引 Redis/队列。

**组件**：
```
Supervisor（AgentSession）
  │ 注入 DelegateAgentTool + 可用数字员工目录（按 teamId/ownerUserId 查出）
  ▼
DelegateAgentTool.execute({ agentId, task, mode })
  │ 复用 §3 spawnSession 逻辑创建子 Agent 会话
  ▼
子 Agent prompt(task) → 结果经 session.subscribe 回流
```

**M3 范围（最小可用）**：
- 同步委派（等待返回）+ 并行（≤8，超出排队）。
- 深度 ≤2（超出改单 Agent 直答或报错）。
- 异步：`task_id` 占位 + 内存延迟回填（真后台队列留 M4）。

**护栏**：
- 子 Agent 结果截断 4000 字符。
- 子 Agent 禁用 `delegate* / remember* / setGoal* / create_employee`（防递归失控）。
- 委派专用池：仅根会话计入 per-user 上限；子会话独立计数、token 滚回根会话计费。
- 每子 Agent 独立 try/catch，失败不影响兄弟；Supervisor 聚合错误。

**持久化**：`DelegationTree` 记录 `rootSessionId/parentSessionId/childSessionId/mode/depth/status`，支持树状展示与断点恢复。

**事件回流**：子 Agent `tool_update/message` 经 Supervisor 转发到根 SSE，Vue3 编排屏实时展示。

**发现机制**：Supervisor 从数字员工目录涌现式选择委派对象，不靠用户裸打字枚举。

---

## 5. API 端点

| 路由 | 说明 |
|------|------|
| `/api/digital-employees` | 数字员工 CRUD + 绑定技能/MCP（避开 `/api/agent/*`） |
| `/api/admin/users` | 扩展停用/启用/重置密码/删除（现有仅创建） |
| `/api/admin/teams` | 团队混合生命周期（创建/成员/配额/邀请链接） |
| `/api/admin/models` | 模型清单/默认/回退/平台密钥池（复用 `/api/models-config`） |
| `/api/admin/mcp` | MCP Server CRUD + 按团队/Agent 绑定 |
| `/api/admin/audit` | 审计日志查询 |
| `/api/skills/*`、`/api/plugins` | 扩展 global/team/user 作用域 + tenant 过滤 |

---

## 6. 测试策略（目标覆盖率 ≥80%）

| 层 | 重点 | 手段 |
|---|------|------|
| 单元 | 四层解析收敛、委派护栏（深度/截断/禁用清单）、AES-256-GCM、配额滚回 | Vitest + mock Prisma |
| 集成 | 数字员工 CRUD+绑定、编排端到端、SSE 流式、RBAC 越权、凭证不跨租户泄漏 | 真实 PG（testcontainers/测试库） |
| E2E | 登录→建数字员工→发对话→发多 Agent 任务→管理后台 | Playwright（320/768/1440 断点） |

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| `pi-mcp-extension` 不兼容 | C1 Spike 门控；不兼容则降级为预留扩展点 |
| Vue3 SSE 对接不通 | C2 Spike 门控：先最小对接验证 proxy + EventSource |
| 模板改造 RBAC 不匹配 | 先对齐权限点契约，再删 demo 页 |
| 四层解析性能 | 实时查库（Q4 拍板），3-5 次 indexed 查询 ms 级 |
| 委派递归失控 | 深度≤2 + 子 Agent 禁用 delegate* 双保险 |
| 凭证明文落库 | AES-256-GCM + 环境变量主密钥 + code review 强制检查 |
| 会话双轨不一致 | Session 表只存元数据，创建/销毁同时写库和文件 |

---

## 8. Spec Patch（已回写 delta spec）

已在 `openspec/changes/m3-vue3-workbench/specs/m3-vue3-workbench/spec.md` 补齐验收场景：

1. **凭证隔离**：带凭证 MCP 绑 global 被拒 + 记审计。
2. **委派配额**：子会话不计 per-user 上限、token 滚回根会话。
3. **绑定实时性**：绑定修改后新会话立即生效、已撤销绑定不再可用。

均为补充验收场景，未改 delta spec 结构或范围。

---

## 9. 实施顺序

```
T0 Spike/基线门控 → T1 数据模型 → T2 运行时接缝 → T3 编排 → T4 API → T5 技能 → T6 前端 → T7 安全 → T8 测试 → T9 文档
（T2/T3 可并行；T4/T5 可并行；T6 依赖 T2/T4/T5 的 API 契约）
```
