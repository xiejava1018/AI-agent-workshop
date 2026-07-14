# agent-session-in-process Specification

## Purpose
TBD - created by archiving change pi-web-generalized-m1-runnable. Update Purpose after archive.
## Requirements
### Requirement: 复用 fork 的 per-session 串行调度

M2.3 在 `startRpcSession` 成功返回后，SHALL 调用 `perUserSessionCapIncrement(userId)` 增加该用户的活跃 session 计数；在 `POST /api/agent/new` 中，计数检查与递增之间应保持最小竞态窗口。fork 内部仍对同一 session 串行调度（同 session 双 prompt 不会事件交叉）。

#### Scenario: 复用 fork 现有调度
- **WHEN** `app/api/agent/new/route.ts` 调 `startRpcSession(tempKey, "", cwd, ...)` 启动 session
- **THEN** fork 的串行链生效；同 session 双 prompt 不会事件交叉

#### Scenario: 启动 session 后 per-user 计数增加
- **WHEN** `POST /api/agent/new` 成功创建 session
- **THEN** 该 user 的 per-user 计数 +1

### Requirement: SSE 端点 read-path 强制 user 权限校验

（M2.2 已实现，M2.3 保持行为不变）SSE 端点 MUST 在 read-path 上对当前 user 强制权限校验，user 只能访问自己有权限的 session 数据。

#### Scenario: 未授权 tab 被拒订阅
- **WHEN** user `V` 无权访问 session `S`，调用 `GET /api/agent/S/events`
- **THEN** handler 内 `assertCanReadSession` 抛 `ForbiddenError`；返回 403；fork 的 `startRpcSession` 不被调用

#### Scenario: 创建者 tab 收到事件
- **WHEN** user `U` 是 session `S` 创建者
- **THEN** `assertCanReadSession` 通过；handler 调 `getRpcSession` / `startRpcSession`；SSE 流正常返回

#### Scenario: 用户访问自己 session 的 SSE 流
- **WHEN** user A 通过 SSE 订阅自己创建的 session 流
- **THEN** 服务端允许流式推送
- **AND** 不会越权推送其他 user 的数据

#### Scenario: 用户越权访问他人 session 的 SSE 流
- **WHEN** user A 尝试订阅 user B 的 session 流
- **THEN** 服务端拒绝并返回 403

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

#### Scenario: 新建 session 的 cwd 与 Project root_path 一致
- **WHEN** `POST /api/agent/new` 被 user 调，user 的 `last_project_id` 绑定到 `projects.root_path = /tmp/demo`
- **THEN** handler 取 `cwd = /tmp/demo`，调 `assertWithinRoot` + `statSync` + `allowFileRoot(/tmp/demo)` 后启动 session；不发生路径拼接 / 路径变换

#### Scenario: user 未绑 project
- **WHEN** user 调用 `POST /api/agent/new` 但 `user.lastProjectId` 为 null
- **THEN** 返回 400 `{ error: "no project selected" }`
- **AND** 不创建 session

#### Scenario: user 非 project 所在 team member
- **WHEN** user 调用 `POST /api/agent/new` 但 user 不是 `project.teamId` 的 member
- **THEN** 返回 403 `{ error: "forbidden" }`
- **AND** 不创建 session

### Requirement: Server 启动时 metadata rebuild 失败降级

（M2.2 已实现，M2.3 保持行为不变）当 Server 启动时 `recordSessionMeta` 历史 metadata 从 JSONL 文件 rebuild 失败，系统 MUST 优雅降级，进程继续运行而不阻塞启动。

#### Scenario: metadata rebuild 失败但 Server 仍可启动
- **WHEN** 启动时 JSONL 文件损坏或缺失导致 metadata rebuild 失败
- **THEN** Server 进程继续运行并接受新请求
- **AND** 不向客户端返回启动错误

#### Scenario: Server 启动扫描标 userId = null
- **WHEN** server 启动时 `rebuildFromJsonl` 扫描到 session `S` 的 jsonl，其第一行不含可解析的 userId
- **THEN** `recordSessionMeta(S, null, null)` 被调用；metadata map 写一行 `userId = null`

#### Scenario: 重建期间部分 jsonl 损坏
- **WHEN** `<PI_WEB_DATA_DIR>/sessions/foo.jsonl` 第一行 JSON parse 失败
- **THEN** 该 session 标 `userId = null`；其他正常 jsonl 仍被记录
- **AND** server 启动不被阻塞

#### Scenario: 匿名 session 被 member 探查被拒
- **WHEN** member `M` 调 `GET /api/agent/S/events`，session `S` 的 metadata `userId === null`
- **THEN** handler 返回 403；不暴露 S 的存在

#### Scenario: 匿名 session 被 admin 探查可读
- **WHEN** admin `A` 在创建 `S` 的 team 内，调 `GET /api/agent/S/events`
- **THEN** handler 通过；SSE 流正常返回

