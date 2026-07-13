# bootstrap-root-owner Specification

## Purpose
TBD - created by archiving change pi-web-generalized-m1-runnable. Update Purpose after archive.
## Requirements
### Requirement: 启动日志强制输出 root bootstrap 状态

系统 MUST 在每次启动时（通过 `scripts/bootstrap-root.ts` 串入 `npm run start`）向 stdout 写一行结构化日志，prefix 为 `[BOOTSTRAP]`。当数据库 users 表（通过 `prisma.user.count()` 查询）为空时，该行 MUST 包含 `password=<random>`；当 users 表不为空时，该行 MUST 包含 `password=<redacted>`。日志等级 MUST 是 INFO，不可被 SILENCE。运维 MUST 知道这个 root owner 存在；即便失效也能恢复。

#### Scenario: 首次启动输出密码
- **WHEN** 干净的 SQLite 数据库首次 `npm run start`
- **THEN** stdout 在 1 秒内输出一行 `[BOOTSTRAP] root username=root password=<secret> action=login-and-change-immediately`；`prisma.user.create` 一条 root 记录（`password_hash` 为 bcrypt 哈希）

#### Scenario: 重启不重新生成
- **WHEN** 系统已有 root owner 的 SQLite 数据库，再启动
- **THEN** stdout 输出 `[BOOTSTRAP] root username=root password=<redacted>`；无新 user create

### Requirement: root owner 必须强制改密才能访问其他功能

root 登录后 MUST 被强制重定向到 `/change-password`，未改密前 MUST 不能调其他任何写 API。这一约束保证 demo 过程中临时密码不会被长期保留。

#### Scenario: root 登录后被强制改密
- **WHEN** root user 登录成功的第一次请求进入应用任意路由（除 `/api/auth/user-logout`、`/api/auth/change-password`）
- **THEN** Server 识别 `must_change_password=true`，返回 302 重定向到 `/change-password`，且除改密 API 外的所有写 API 返回 403

#### Scenario: 改密后才能访问其他 API
- **WHEN** root 调 `POST /api/auth/change-password` 成功后
- **THEN** `must_change_password` 标志被清零（更新 `users.must_change_password` 为 false）；后续访问任意非改密路由返回正常业务响应

