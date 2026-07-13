# auth-provider-user Specification

## Purpose
TBD - created by archiving change pi-web-generalized-m1-runnable. Update Purpose after archive.
## Requirements
### Requirement: AuthProvider 接口必须保留扩展位

系统 MUST 暴露 `lib/auth-provider.ts` 接口：

```ts
interface AuthProvider {
  authenticate(credential: { username: string; password: string })
    : Promise<{ userId: string; displayName: string; mustChangePassword: boolean }>
  revoke(userId: string): Promise<void>
}
```

所有业务代码 MUST 通过依赖注入调用 `AuthProvider` 实例，**不许直接 import 任何具体实现**——这是为 M2/M3 接 SAML / OIDC / OAuth 留接口位。

M1 MUST 提供 `LocalPasswordAuthProvider` 一个具体实现，内部用 `bcryptjs` 哈希与 `jose` 签 JWT。**未来加 GitHub OAuth 等必须写第二个实现类，不动业务代码**。

#### Scenario: 通过 LocalPasswordAuthProvider 登录成功
- **WHEN** 调用 `provider.authenticate({ username: "alice", password: "<correct>" })`
- **THEN** 返回 `{ userId: "<cuid>", displayName: "alice", mustChangePassword: false }`，数据库中无该 user 时自动 create

#### Scenario: 切换实现类不动业务代码
- **WHEN** 业务代码调用 `provider.authenticate(credential)`
- **THEN** DI 容器根据 config 注入 `LocalPasswordAuthProvider` 或未来 `GitHubOAuthProvider`，业务代码无需改动

#### Scenario: 与 model provider auth 并存
- **WHEN** 用户已通过 `/api/auth/user-login` 登录，并访问 `/api/auth/providers`
- **THEN** 返回 200，model provider 列表可见（**不与 user auth 互斥**）

### Requirement: 全局 middleware 拦截未登录 user 的 /api/*

fork 现有 pi-web **没有全局 middleware**。本 capability MUST 新增根目录 `middleware.ts`：

- 例外：`/`（首页）、`/api/auth/user-login`、`/api/auth/user-logout`、model provider auth（`/api/auth/{providers,login,logout,all-providers,api-key}`）、静态资源（`_next/static`、`public/`、`favicon`）
- 其他 `/api/*`：解码 `pw_at` cookie 携带的 user JWT；JWT 无效或缺失 → 返回 401
- 解码成功后：`req.headers['x-user-id']` 与 `req.headers['x-user-role']` 注入用户身份；下游路由可用 `headers().get('x-user-id')` 读

#### Scenario: 未登录访问受保护 API 返回 401
- **WHEN** 未带 `pw_at` cookie 时调用 `GET /api/sessions`
- **THEN** middleware 拦截返回 401 JSON `{ error: "auth required" }`

#### Scenario: 登录后访问正常
- **WHEN** 带有效 `pw_at` cookie 调用 `GET /api/sessions`
- **THEN** middleware 通过；handler 读到 `x-user-id` header 并继续处理

#### Scenario: 静态资源不拦截
- **WHEN** 调用 `GET /favicon.ico`
- **THEN** middleware 不参与，资源返回 200

