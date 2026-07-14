# user-auth-ui Specification

## Purpose
TBD - created by archiving change pi-web-m2-2-ui-and-hardening. Update Purpose after archive.
## Requirements
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

#### Scenario: 未登录用户访问受保护页面
- **WHEN** 未携带 `pw_at` cookie 的浏览器访问 `/{locale}/dashboard`
- **THEN** 客户端逻辑重定向到 `/{locale}/login`
- **AND** `/api/auth/*` 之外的 `/api/*` 返回 401 JSON（middleware 拦截）

#### Scenario: 用户提交登录表单
- **WHEN** 用户在 `/{locale}/login` 提交 username + password
- **THEN** POST `/api/auth/user-login` 成功（200 + Set-Cookie `pw_at`）
- **AND** 客户端跳转到 `/{locale}/change-password` 当响应体 `mustChangePassword === true`
- **AND** 客户端跳转到 `/{locale}/dashboard` 当响应体 `mustChangePassword === false`

#### Scenario: 登录失败显示错误
- **WHEN** 用户在 `/{locale}/login` 提交错误密码
- **THEN** 页面显示来自 `messages/{locale}.json::login.error` 的本地化错误消息
- **AND** 不跳转、不显示密码

### Requirement: 改密页面强制 root 在首次登录后改密

（M2.2 已完整实现，M2.3 保持行为不变）改密页面 MUST 强制 root 账号在首次登录后立即改密，未改密时 root 的写 API 调用 MUST 被拦截。

#### Scenario: mustChangePassword 用户改密成功
- **WHEN** root 提交新密码（≥ 8 字符）到 `/{locale}/change-password`
- **THEN** POST `/api/auth/change-password` 返回 200
- **AND** 客户端跳转到 `/{locale}/dashboard`
- **AND** DB 中 `User.mustChangePassword` 被置为 `false`

#### Scenario: mustChangePassword 状态下写 API 被拦截
- **WHEN** user 的 `mustChangePassword` 为 `true`
- **AND** user 调用任何写 API
- **THEN** 服务端返回 403 提示必须先改密

#### Scenario: 新密码太短
- **WHEN** 用户提交 < 8 字符的新密码
- **THEN** 页面显示来自 `messages/{locale}.json::changePassword.tooShort` 的错误
- **AND** 不跳转

### Requirement: dashboard 页面显示当前用户、团队与项目列表

系统 SHALL 提供 `/{locale}/dashboard` 页面，登录后展示：用户名、role（OWNER/ADMIN/MEMBER）、mustChangePassword 状态、当前用户所属团队名（首个）、当前用户可见的项目列表（通过 `GET /api/projects`）。

#### Scenario: root 登录后看到 dashboard
- **WHEN** root（OWNER）登录后访问 `/{locale}/dashboard`
- **THEN** 页面渲染 "Welcome root (OWNER)" + mustChangePassword 状态 + team name "Default Team" + projects 列表（空或已有）

#### Scenario: 未授权访问 dashboard
- **WHEN** 未登录浏览器直接访问 `/{locale}/dashboard`
- **THEN** 客户端跳转到 `/{locale}/login`
- **AND** 不显示任何用户数据

### Requirement: 页面文案通过 next-intl 加载

系统 SHALL 通过 `lib/i18n.ts::t(key, locale)` 加载 `messages/{en,zh-CN}.json` 中的字符串，登录/改密/dashboard 三个页面所有可见文字均走 `t()` 调用。

#### Scenario: 切换 locale
- **WHEN** 浏览器从 `/en/login` 导航到 `/zh-CN/login`
- **THEN** 页面文案切到中文（按钮 "登录" 而不是 "Sign in"）
- **AND** 切换不重新加载用户会话

#### Scenario: 缺失 key 降级
- **WHEN** `t('not.a.real.key', 'en')` 被调用
- **THEN** 返回字符串 `'not.a.real.key'`（不抛错、不返回 undefined）

### Requirement: i18n `[locale]` 路由 wiring

系统 SHALL 在 middleware matcher 中允许 `/{locale}/(login|change-password|dashboard)` 路径不返回 401（这些是 UI 页面，不应被 JWT 验证拦截）。`/api/*` 与非 UI 路径仍按 M1 规则拦截。

#### Scenario: 静态资源 + UI 页面不被 401
- **WHEN** 浏览器加载 `/_next/static/*`、`/favicon.ico`、`/{locale}/login`、`/{locale}/change-password`、`/{locale}/dashboard`
- **THEN** 全部返回 200 或 30x；不返回 401 JSON

#### Scenario: 未知 locale 重定向到默认
- **WHEN** 浏览器访问 `/{unknown_locale}/login`
- **THEN** 客户端或 server 重定向到 `/en/login`（默认 locale）

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

