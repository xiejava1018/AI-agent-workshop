## MODIFIED Requirements

### Requirement: 复用 fork 的 per-session 串行调度

M2.3 在 `startRpcSession` 成功返回后，SHALL 调用 `perUserSessionCapIncrement(userId)` 增加该用户的活跃 session 计数；在 `POST /api/agent/new` 中，计数检查与递增之间应保持最小竞态窗口。

#### Scenario: 启动 session 后 per-user 计数增加
- **WHEN** `POST /api/agent/new` 成功创建 session
- **THEN** 该 user 的 per-user 计数 +1

### Requirement: SSE 端点 read-path 强制 user 权限校验

（M2.2 已实现，M2.3 保持行为不变）

### Requirement: SSE 端点 cwd 与 Project.root_path 一致

`POST /api/agent/new` handler MUST 在现有 `user.lastProjectId` → `Project` 校验之后、调用 `startRpcSession` 之前，先检查 per-user session cap；超限时返回 503。

#### Scenario: per-user cap 未超限则创建 session
- **WHEN** user 的 `lastProjectId` 有效且 per-user 计数未超限
- **THEN** 继续创建 session，成功后计数 +1

#### Scenario: per-user cap 超限拒绝创建
- **WHEN** user 的 per-user 计数已达上限
- **AND** 用户调用 `POST /api/agent/new`
- **THEN** 返回 503 `{ error: "per-user session cap reached (N)" }`
- **AND** 不调用 `startRpcSession`

### Requirement: Server 启动时 metadata rebuild 失败降级

（M2.2 已实现，M2.3 保持行为不变）

## ADDED Requirements

无

## REMOVED Requirements

无
