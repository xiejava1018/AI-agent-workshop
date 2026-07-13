## MODIFIED Requirements

### Requirement: Session 列表三路并集可见性

查询 session 列表时 MUST 走三路并集：`user_id = :me OR :me IN (SELECT shared_with_user_id FROM session_shares WHERE session_id = s.id) OR :me_role IN (owner, admin) AND session.project.teamId IN (:my_admin_team_ids)`。普通 member 仅看到自己创建或被分享的 session；owner / admin 仅在自己 Team 内看到全部（不是跨 Team）。`session_shares` 表在 M1 已 schema 预留但读空（M2.4 才上 share dialog）。

M2.2 实现细节：filter 通过新增 helper `getUserTeamIds(userId): Promise<string[]>` 实现，session 通过其关联 project 的 teamId 与 user 的 admin teamIds 求交集。

#### Scenario: 普通 member 仅看自己创建
- **WHEN** member `M` 调 `GET /api/sessions`
- **THEN** 返回的 session 列表中每条 `user_id` 都等于 `M.id`，或 `M.id` 存在于对应的 `session_shares.shared_with_user_id`

#### Scenario: admin 看全 Team
- **WHEN** admin `A` 调 `GET /api/sessions?team_id=T`
- **AND** A 是 Team T 的 OWNER/ADMIN
- **THEN** 返回 Team T 下所有 session，不论 `user_id`

#### Scenario: 跨 Team admin 不可见
- **WHEN** user O1 是 Team T1 的 OWNER
- **AND** session S 在 Team T2 下某 project 关联
- **THEN** user O1 GET /api/sessions 不包含 S

#### Scenario: 多 Team user 跨 Team 可见
- **WHEN** user X 是 Team T1 与 Team T2 的 MEMBER
- **AND** session S1 在 T1 关联 project 下
- **AND** session S2 在 T2 关联 project 下
- **THEN** 响应同时包含 S1 与 S2（user X 是两边 owner）

#### Scenario: 匿名 session 仅 admin 可见
- **WHEN** server 重启后内存 metadata 重建时,某 session `S` 的 jsonl 文件依然存在,但无任何 user 主动访问过（`userId = null`）
- **THEN** member `M` 调 `GET /api/sessions` 看不到 `S`；team 内 OWNER 或 ADMIN 调同一接口能看到 `S`，并显示 "(anonymous)" 标记

## ADDED Requirements

### Requirement: 写 API 必须拒绝 mustChangePassword === true 的用户

系统 SHALL 在所有 `/api/*` 写路由（除 `/api/auth/change-password` 自身）中，header `x-must-change-password === 'true'` 时返回 403 `{ error: "password change required" }`。读路由不强制。

M2.2 实现：`middleware.ts` 在注入 `x-user-id` 时同时从 `prisma.user.findUnique` 读 `mustChangePassword` 并设 `x-must-change-password: 'true' | 'false'`；每个写路由顶部加 `const gate = enforceNotMustChange(req); if (gate) return gate;`。`enforceNotMustChange` 在 `lib/must-change-password.ts`。

#### Scenario: root 未改密时 POST /api/agent/new
- **WHEN** root 登录后 mustChangePassword=true
- **THEN** POST /api/agent/new 返回 403 `{ error: "password change required" }`
- **AND** 不创建新 session

#### Scenario: root 改密后 POST /api/agent/new
- **WHEN** root 已通过 /api/auth/change-password 改密
- **AND** mustChangePassword=false
- **THEN** POST /api/agent/new 正常返回 200 + sessionId

#### Scenario: change-password 自身可绕过门
- **WHEN** mustChangePassword=true
- **THEN** POST /api/auth/change-password 正常返回 200（白名单）
- **AND** 改密后 mustChangePassword=false，后续写 API 正常

#### Scenario: user-login 自身可绕过门
- **WHEN** mustChangePassword=true 用户重新登录
- **THEN** POST /api/auth/user-login 正常返回 200 + 新 cookie
- **AND** 响应体中 `mustChangePassword: true` 仍携带（让客户端跳到 /change-password）
