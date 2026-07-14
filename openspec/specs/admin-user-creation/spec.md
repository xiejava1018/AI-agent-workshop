# admin-user-creation Specification

## Purpose
TBD - created by archiving change pi-web-m2-3-admin-user-management. Update Purpose after archive.
## Requirements
### Requirement: 只有 OWNER 或 ADMIN 可以创建新用户

系统 SHALL 仅允许 role 为 OWNER 或 ADMIN 的用户调用用户创建 API，普通用户（MEMBER）调用 SHALL 返回 403。

#### Scenario: ADMIN 创建用户成功
- **WHEN** ADMIN 用户调用 `POST /api/admin/users` 并传入 `{ username }`
- **THEN** 系统创建新用户，生成随机初始密码，返回 `{ id, username, initialPassword }`
- **AND** 新用户 `mustChangePassword` 为 `true`
- **AND** 新用户 `createdBy` 为创建者 userId

#### Scenario: MEMBER 创建用户被拒绝
- **WHEN** MEMBER 用户调用 `POST /api/admin/users`
- **THEN** 系统返回 403 `{ error: "forbidden" }`
- **AND** 不创建用户

#### Scenario: 重复用户名拒绝创建
- **WHEN** ADMIN 调用 `POST /api/admin/users` 传入已存在的 `username`
- **THEN** 系统返回 409 `{ error: "username exists" }`

