# Capability: agent-session-in-process

> fork 现有 [xiejava1018/pi-web](https://github.com/xiejava1018/pi-web) `lib/rpc-manager.ts` 已经覆盖 `startRpcSession` / `getRpcSession` 多 session 生命周期；M1 不引入新 SessionBus，仅在 SSE 端点 read-path 加权限校验。

## ADDED Requirements

### Requirement: 复用 fork 的 per-session 串行调度

系统 MUST 沿用 fork 的 `lib/rpc-manager.ts`（包含 `startRpcSession`、`getRpcSession`、`AgentSessionWrapper`）。M1 不需要新写 SessionBus 或新 mutex 链——fork 内部已对同一 session 串行调度（读 `startRpcSession` 实现可证）。M2 评估是否需要上层 per-user 信号量（限 3 session 并发）。

#### Scenario: 复用 fork 现有调度
- **WHEN** `app/api/agent/new/route.ts` 调 `startRpcSession(tempKey, "", cwd, ...)` 启动 session
- **THEN** fork 的串行链生效；同 session 双 prompt 不会事件交叉（**前提**：M1 仅在路由入口加权限校验，不在 fork 调度链插入新逻辑）

### Requirement: SSE 端点 read-path 强制 user 权限校验

fork `app/api/agent/[id]/events/route.ts` 的 GET handler **没有 user 检查**（单用户前提）。M1 MUST 在该 handler 的 read-path 第一行加 `assertCanReadSession(userId, sessionId)`：

- `userId == session.user_id`  → 通过
- `userId_role IN (owner, admin)` 所在 team 内 → 通过
- `userId IN (SELECT shared_with_user_id FROM session_shares WHERE session_id = s.id)`  → 通过（M1 后者 schema 预留读空）
- 其他 → 抛 `ForbiddenError`，handler 返回 403

#### Scenario: 未授权 tab 被拒订阅
- **WHEN** user `V` 无权访问 session `S`，调用 `GET /api/agent/S/events`
- **THEN** handler 内 `assertCanReadSession` 抛 `ForbiddenError`；返回 403；fork 的 `startRpcSession` 不被调用

#### Scenario: 创建者 tab 收到事件
- **WHEN** user `U` 是 session `S` 创建者
- **THEN** `assertCanReadSession` 通过；handler 调 `getRpcSession` / `startRpcSession`；SSE 流正常返回

### Requirement: SSE 端点 cwd 与 Project.root_path 一致

fork `app/api/agent/new/route.ts` 在 M1 MUST 改成：cwd 来自 user 当前 `last_project_id` 对应的 `Project.root_path`（而非 UI 自由输入）。如 `last_project_id` 缺失，则 handler 返回 400。`assertWithinRoot` 在创建 session 前调用以双验。

#### Scenario: 新建 session 的 cwd 与 Project root_path 一致
- **WHEN** `POST /api/agent/new` 被 user 调，user 的 `last_project_id` 绑定到 `projects.root_path = /tmp/demo`
- **THEN** handler 取 `cwd = /tmp/demo`，调现有 fork 链路 `statSync` + `allowFileRoot(/tmp/demo)` 后启动 session；不发生路径拼接 / 路径变换

### Requirement: Server 启动时 metadata rebuild 失败降级

`lib/session-meta.ts` MUST 在 server 启动时调 `SessionManager.listAll()` 重建 metadata map。对于无法反推 userId 的 session，**MUST** 标 `userId = null`（匿名）。匿名 session 的 read-path 行为：

- `userId === null` 且 `userRole IN (OWNER, ADMIN)` 所在 team 内 → **通过**（admin 可调查遗留）
- `userId === null` 且 user 是 member → **拒绝**（403）
- `userId === null` 且 user 是 OWNER/ADMIN 但不在创建该 session 的 team 内 → **拒绝**

#### Scenario: Server 启动扫描标 userId = null
- **WHEN** server 启动时 `SessionManager.listAll()` 返回 session `S`，其关联 userId 在 db 中找不到（或从未被 recordSessionMeta 写入）
- **THEN** `recordSessionMeta(S, null, S.cwd对应的projectId)` 被调用；metadata map 写一行 `userId = null`

#### Scenario: 匿名 session 被 member 探查被拒
- **WHEN** member `M` 调 `GET /api/agent/S/events`，session `S` 的 metadata `userId === null`
- **THEN** handler 返回 403；不暴露 S 的存在

#### Scenario: 匿名 session 被 admin 探查可读
- **WHEN** admin `A` 在创建 `S` 的 team 内，调 `GET /api/agent/S/events`
- **THEN** handler 通过；SSE 流正常返回；admin 此时若有权限可触发 recordSessionMeta(S, A.id, ...) 重写 metadata（**当前实现不重写，仅观察**）
