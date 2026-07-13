## MODIFIED Requirements

### Requirement: AuthProvider 接口必须保留扩展位

`AuthProvider` 接口 SHALL 拆分为基接口与特化子接口，以支持本地密码认证和未来的 OAuth 扩展：

```ts
interface AuthProvider {
  revoke(userId: string): Promise<void>;
}

interface PasswordAuthProvider extends AuthProvider {
  authenticate(credential: { username: string; password: string })
    : Promise<{ userId: string; displayName: string; mustChangePassword: boolean }>;
  signAccessToken(userId: string): Promise<string>;
  signRefreshToken(userId: string): Promise<string>;
}

interface OAuthProvider extends AuthProvider {
  authenticateOAuth(code: string, state: string): Promise<{ userId: string; displayName: string; mustChangePassword: boolean }>;
}
```

业务代码 MUST 通过 `getPasswordAuthProvider()` 获取 `PasswordAuthProvider`；`getAuthProvider()` 保留但仅用于通用 revoke 场景。未来接入 OAuth 时新增 `getOAuthProvider()`，不修改现有登录逻辑。

#### Scenario: 本地密码认证不再自动注册
- **WHEN** 调用 `provider.authenticate({ username: "unknown", password: "x" })` 且该 username 在 DB 中不存在
- **THEN** 抛 `Error("invalid credentials")`
- **AND** 不创建新 user

#### Scenario: 已知用户登录成功
- **WHEN** 调用 `provider.authenticate({ username: "alice", password: "<correct>" })` 且 alice 已存在
- **THEN** 返回 `{ userId: "<cuid>", displayName: "alice", mustChangePassword: false }`

### Requirement: 全局 middleware 拦截未登录 user 的 /api/*

middleware SHALL 在 JWT 验证通过后，同时注入 `x-refresh-token-jti` header（从 `pw_rt` cookie 解析），供 `POST /api/auth/refresh` 以外的路由选择性使用。`POST /api/auth/refresh` 路由本身 MUST 被 matcher 允许通过，由该 handler 自行验证 refresh token。

#### Scenario: 有效 access token 访问受保护 API
- **WHEN** 用户携带有效 `pw_at` 调用 `GET /api/sessions`
- **THEN** middleware 通过，注入 `x-user-id`、`x-user-role`、`x-must-change-password`、`x-refresh-token-jti`
- **AND** handler 继续处理

#### Scenario: 访问 refresh 路由不被 middleware 挡下
- **WHEN** 用户调用 `POST /api/auth/refresh`（access token 可能已过期）
- **THEN** middleware 不返回 401，允许 handler 自行读取 `pw_rt` cookie 验证

## ADDED Requirements

无

## REMOVED Requirements

无
