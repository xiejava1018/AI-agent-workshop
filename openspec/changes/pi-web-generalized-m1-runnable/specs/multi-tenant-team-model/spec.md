# Capability: multi-tenant-team-model

## ADDED Requirements

### Requirement: Team / TeamMember / User 三表结构

系统 MUST 在数据库中提供 `users` / `teams` / `team_members` 三张表（通过 Prisma + SQLite 落地）。Team 为顶层隔离单元（包含 Project / ModelProvider / Session 的 `team_id` 外键）。一个用户 MUST 能加入多个 Team（一人多队是允许的）。`role` MUST 存放在 `team_members` 表上，**不许放在 `users.role`**——这是与原单用户形态（fork 现有 pi-web）以及与"admin / user 全局角色"形态的根本差别。

所有内部 ID（user_id / team_id） MUST 是 `cuid()` 生成的 string，**禁止自增整数**——为未来接外部账号系统预留位。

#### Scenario: 用户加入多个 Team
- **WHEN** 用户 `U` 在 `team_members` 表中存在两行（团队 A 的 admin + 团队 B 的 member）
- **THEN** `U` 同时能用两套身份访问 A 与 B 的项目；切换激活 team 时 session 必须重新校验可见性

#### Scenario: role 不在 users 表上
- **WHEN** `SELECT role FROM users WHERE id = ?` 被执行
- **THEN** 该查询返回 NULL（因为 role 不在 users 上）

### Requirement: Session 列表三路并集可见性

查询 session 列表时 MUST 走三路并集：`user_id = :me OR :me IN (SELECT shared_with_user_id FROM session_shares WHERE session_id = s.id) OR :me_role IN (owner, admin)`。普通 member 仅看到自己创建或被分享的 session；owner / admin 在自己 Team 内看到全部。`session_shares` 表在 M1 已 schema 预留但读空（M2 才上 share dialog）。

#### Scenario: 普通 member 仅看自己创建
- **WHEN** member `M` 调 `GET /api/sessions`
- **THEN** 返回的 session 列表中每条 `user_id` 都等于 `M.id`，或 `M.id` 存在于对应的 `session_shares.shared_with_user_id`

#### Scenario: admin 看全 Team
- **WHEN** admin `A` 调 `GET /api/sessions?team_id=T`
- **THEN** 返回 Team T 下所有 session，不论 `user_id`

#### Scenario: 匿名 session 仅 admin 可见
- **WHEN** server 重启后内存 metadata 重建时,某 session `S` 的 jsonl 文件依然存在,但无任何 user 主动访问过（`userId = null`）
- **THEN** member `M` 调 `GET /api/sessions` 看不到 `S`；team 内 OWNER 或 ADMIN 调同一接口能看到 `S`，并显示 "(anonymous)" 标记
