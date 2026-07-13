## MODIFIED Requirements

### Requirement: 登录页面必须能在浏览器中渲染

系统 SHALL 在登录页中支持 refresh token 续期：当 `POST /api/auth/user-login` 返回后，若 access token 在后续使用中过期，客户端 SHOULD 调用 `POST /api/auth/refresh` 静默续期；若 refresh 也失败，客户端 SHALL 跳转回 `/{locale}/login`。

#### Scenario: 登录成功后设置双 cookie
- **WHEN** 用户在 `/{locale}/login` 提交正确 username + password
- **THEN** `/api/auth/user-login` 返回 200
- **AND** 浏览器收到 `Set-Cookie: pw_at` 与 `Set-Cookie: pw_rt`
- **AND** 客户端按 `mustChangePassword` 跳转到 change-password 或 dashboard

#### Scenario: access token 过期后静默续期
- **WHEN** 用户已登录且 access token 过期
- **AND** 客户端调用某受保护 API 收到 401
- **THEN** 客户端调用 `POST /api/api/auth/refresh`
- **AND** 刷新成功后重试原请求
- **AND** 刷新失败则跳转回 `/{locale}/login`

### Requirement: 改密页面强制 root 在首次登录后改密

（M2.2 已完整实现，M2.3 保持行为不变）

#### Scenario: mustChangePassword 用户改密成功
- **WHEN** root 提交新密码（≥ 8 字符）到 `/{locale}/change-password`
- **THEN** POST `/api/auth/change-password` 返回 200
- **AND** 客户端跳转到 `/{locale}/dashboard`
- **AND** DB 中 `User.mustChangePassword` 被置为 `false`

## ADDED Requirements

### Requirement: admin 用户可在 dashboard 创建新用户

系统 SHALL 在 dashboard 页面为 OWNER/ADMIN 用户提供最小表单入口，用于创建新用户并显示一次性初始密码。

#### Scenario: OWNER 创建新用户
- **WHEN** OWNER 在 dashboard 填写新用户名并提交
- **THEN** 调用 `POST /api/admin/users` 成功
- **AND** 页面显示一次性初始密码
- **AND** 新用户 `mustChangePassword=true`

#### Scenario: MEMBER 看不到创建用户入口
- **WHEN** MEMBER 访问 dashboard
- **THEN** 不渲染创建用户表单
- **AND** 即使直接调用 API 也返回 403

## REMOVED Requirements

无
