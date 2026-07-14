# refresh-token Specification

## Purpose
TBD - created by archiving change pi-web-m2-3-admin-user-management. Update Purpose after archive.
## Requirements
### Requirement: 登录时同时签发 access token 与 refresh token

系统 SHALL 在 `POST /api/auth/user-login` 验证成功后，同时签发：
- access token：有效期 15 分钟，写入 HttpOnly cookie `pw_at`
- refresh token：有效期 7 天，写入 HttpOnly cookie `pw_rt`

#### Scenario: 登录成功时设置双 cookie
- **WHEN** 用户提交正确的 username/password
- **THEN** 响应 Set-Cookie 包含 `pw_at` 与 `pw_rt`
- **AND** `pw_at` 的 `maxAge` 为 15 分钟
- **AND** `pw_rt` 的 `maxAge` 为 7 天

### Requirement: access token 过期后可用 refresh token 续期

系统 SHALL 提供 `POST /api/auth/refresh`，验证 `pw_rt` cookie 后签发新的 access token 与新的 refresh token，并替换旧 refresh token。旧 refresh token 的 jti SHALL 持久化到 `RefreshTokenBlacklist` 表，防止被再次使用。

#### Scenario: 使用有效 refresh token 续期
- **WHEN** 用户携带有效 `pw_rt` 调用 `POST /api/auth/refresh`
- **THEN** 系统验证 `pw_rt` 签名与 jti 未在黑名单中
- **AND** 将旧 `pw_rt` 的 jti 写入 `RefreshTokenBlacklist`
- **AND** 响应包含新 `pw_at` 与新 `pw_rt`

#### Scenario: 使用已撤销 refresh token 续期
- **WHEN** 用户携带已被轮换过的旧 `pw_rt` 调用 `POST /api/auth/refresh`
- **THEN** 系统查询 `RefreshTokenBlacklist` 发现该 jti 已存在
- **AND** 返回 401 `{ error: "invalid refresh token" }`
- **AND** 清除客户端双 cookie

#### Scenario: 缺失 refresh token
- **WHEN** 用户未携带 `pw_rt` 调用 `POST /api/auth/refresh`
- **THEN** 系统返回 401 `{ error: "refresh token required" }`

### Requirement: refresh token 撤销

系统 SHALL 在 `POST /api/auth/user-logout` 中同时撤销 access token 与 refresh token，清除对应 cookie。

#### Scenario: 登出清除双 token
- **WHEN** 用户调用 `POST /api/auth/user-logout`
- **THEN** 系统把当前 `pw_rt` 加入黑名单
- **AND** 清除 `pw_at` 与 `pw_rt` cookie

