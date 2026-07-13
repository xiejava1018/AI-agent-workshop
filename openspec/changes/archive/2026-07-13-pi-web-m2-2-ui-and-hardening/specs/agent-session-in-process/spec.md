## MODIFIED Requirements

### Requirement: SSE 端点 cwd 与 Project.root_path 一致

`POST /api/agent/new` handler MUST 改用 `user.lastProjectId` 对应的 `Project.root_path` 作为 cwd（而非 UI 自由输入 body.cwd）。如 `lastProjectId` 缺失或对应 project 不存在或 project.teamId 与 user 无 membership，handler 返回 400。`assertWithinRoot` 在创建 session 前调用以双验。

M2.2 实现：handler 顶部 `const user = await prisma.user.findUnique({ where: { id: userId }, select: { lastProjectId: true } })`；null → 400 "no project selected"；`prisma.project.findUnique` + membership check + `cwd = project.rootPath` + `assertWithinRoot(project.rootPath, project.rootPath)` + `statSync` + `allowFileRoot`。

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

`lib/session-meta.ts::rebuildFromJsonl` MUST 在 server 启动时（lazy on first `getSessionMeta` call）扫描 `<PI_WEB_DATA_DIR>/**/*.jsonl` 第一行元数据。对于无法反推 userId 的 session，**MUST** 标 `userId = null`（匿名）。扫描失败 catch 后 log warning 继续；不阻塞 server 启动。

匿名 session 的 read-path 行为（继承 M1 spec）：
- `userId === null` 且 `userRole IN (OWNER, ADMIN)` 所在 team 内 → **通过**（admin 可调查遗留）
- `userId === null` 且 user 是 member → **拒绝**（403）
- `userId === null` 且 user 是 OWNER/ADMIN 但不在创建该 session 的 team 内 → **拒绝**

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
