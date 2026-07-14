# M2.3 受控多用户管理：admin 创建用户 + 双 token + per-user session 信号量

> 产物语言：**zh-CN**
> change 路径：`openspec/changes/pi-web-m2-3-admin-user-management/`
> 上游上下文：M1 `pi-web-generalized-m1-runnable`、M2.2 `pi-web-m2-2-ui-and-hardening` 已归档

## Why

M2.2 已交付最小登录 UI，但当前 `LocalPasswordAuthProvider` 允许任意 username/password 自动注册，无法实现真正的多用户管理；同时 15min 单次 JWT 会在工作中掉登录、50 session 全局上限会误伤其他用户。本 change 把 pi-web 从“单用户 + 伪多用户”推进到**受控多用户**：只有 root/admin 能创建用户，每个用户独立会话、独立受 per-user 信号量限制，并通过 access+refresh 双 token 保持长期登录状态。

## What Changes

- **移除自动注册**：`LocalPasswordAuthProvider.authenticate` 不再自动创建 user；未知用户返回 401
- **新增 admin 用户创建 API**：`POST /api/admin/users` 仅 OWNER/ADMIN 可调用，创建普通用户并设置 `mustChangePassword=true`
- **改造 `AuthProvider` 接口**：拆分为 `PasswordAuthProvider`（本地密码）与 `OAuthProvider` 扩展位；为后续 OAuth 预留但不实现完整 OAuth
- **实现 access + refresh 双 token**：access token（15min，cookie `pw_at`）+ refresh token（7d，cookie `pw_rt`），refresh token 单次轮换并记录 jti 黑名单
- **新增 token 刷新 API**：`POST /api/auth/refresh` 用 `pw_rt` 签发新 access token 与新 refresh token
- **改造 session 上限为 per-user**：`lib/session-cap.ts` 从全局计数器改为 `Map<userId, count>`，每个用户默认最多 5 个活跃 session；全局 50 作为兜底
- **修改 `/api/agent/new`**：在现有 `user.lastProjectId` 逻辑基础上，先检查该用户的 per-user cap
- **保留并强化 mustChangePassword 拦截**：新创建用户首次登录后必须改密码才能调用写 API
- **（可选）GitHub OAuth 登录入口**：作为并列登录方式，首次登录自动创建 user；不替代本地密码

## Capabilities

### New Capabilities

- `admin-user-creation`: root/admin 创建普通用户、设置初始密码、用户首次登录强制改密
- `refresh-token`: access+refresh 双 token、refresh token 轮换、撤销黑名单
- `per-user-session-cap`: 每个用户独立的活跃 session 信号量，替代全局硬上限

### Modified Capabilities

- `auth-provider-user`: 移除自动注册行为；`AuthProvider` 接口拆分为可扩展的 provider 类型，支持本地密码与 OAuth 占位
- `user-auth-ui`: 登录页支持 refresh token 续期流程；admin 可见最小创建用户入口（M2.3 内仅提供 UI 占位或 admin dashboard 最小表单）
- `agent-session-in-process`: `POST /api/agent/new` 增加 per-user cap 检查；session 元数据保留 userId 关联

## Impact

- **Affected code**：`lib/auth-provider*.ts`、`app/api/auth/user-login/route.ts`、`app/api/auth/refresh/route.ts`、新增 `app/api/admin/users/route.ts`、`lib/session-cap.ts`、`app/api/agent/new/route.ts`、`middleware.ts`、前端登录页
- **New packages**：无新增 npm 依赖（jose/bcryptjs 已存在）
- **Database**：`User` 表可能新增 `createdBy` 或 `status` 字段；新增 `RefreshToken` 黑名单表（或简单内存 Map，M3 前可接受）
- **API 变更**：`POST /api/admin/users` 新端点；`POST /api/auth/refresh` 新端点；`POST /api/auth/user-login` 响应体增加 token 信息（可选）
- **Breaking**：`LocalPasswordAuthProvider.authenticate` 不再自动注册；外部依赖此行为的脚本/测试需调整
- **Deferred**: OAuth 完整配置 UI、SAML/OIDC、Share dialog、Postgres 迁移仍到 M2.4+/M3
