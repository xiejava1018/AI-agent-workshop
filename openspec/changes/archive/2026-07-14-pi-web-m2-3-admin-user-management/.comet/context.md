# Comet Design Handoff

- Change: pi-web-m2-3-admin-user-management
- Phase: design
- Mode: compact
- Context hash: eb3ae68c309399ffb047bb8c8f4ed414e5260e7e644ece198540a49db1111003

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/pi-web-m2-3-admin-user-management/proposal.md

- Source: openspec/changes/pi-web-m2-3-admin-user-management/proposal.md
- Lines: 1-44
- SHA256: 6fa0100d5abd37641c0b84be73c2460c4a99d511906fcad91334fe0ec6f49ab7

```md
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

```

## openspec/changes/pi-web-m2-3-admin-user-management/design.md

- Source: openspec/changes/pi-web-m2-3-admin-user-management/design.md
- Lines: 1-64
- SHA256: 8979a497eb982b19fb1a14d28ca5fb1b6353de577b69feab10cae95184ecdb82

```md
## Context

M2.2 实现了 pi-web 的最小登录 UI 和本地密码认证，但当前 `LocalPasswordAuthProvider.authenticate` 会在用户不存在时自动创建账号，导致任何人都可注册并使用系统，无法满足"受控多用户"需求。同时，单次 15min JWT 会让用户在工作中频繁掉登录；全局 50 session 上限会让某个用户耗尽资源后影响其他用户。

本 design 定义如何把认证层改造为**仅 root/admin 可创建用户**、引入 **access+refresh 双 token**、并把 session 信号量改为 **per-user 独立配额**。

## Goals / Non-Goals

**Goals:**
- 普通用户不能自动注册，只有 root/OWNER/ADMIN 能创建用户
- 新创建用户首次登录必须改密码，改密前不能调用写 API
- 实现 access+refresh 双 token，access token 15min、refresh token 7d，支持静默续期与轮换
- 每个用户独立限制最多 N 个活跃 session，默认 5，全局 50 作为兜底
- 保留与 M2.2 的兼容性：登录页、middleware、写 API 门、Project 绑定逻辑不变

**Non-Goals:**
- 不做完整 admin dashboard UI（仅提供最小 API，UI 可留 M2.3+ 或简单表单）
- 不实现 SAML/OIDC/GitHub OAuth 的完整配置（仅保留 `OAuthProvider` 接口占位）
- 不做 session 分享（M2.4）
- 不迁移 Postgres（M3）

## Decisions

### 1. `AuthProvider` 接口拆分为 `PasswordAuthProvider` + `OAuthProvider` 占位

- **选择**：把当前 `AuthProvider` 接口改为基接口，新增 `PasswordAuthProvider` 和 `OAuthProvider` 子类型；`LocalPasswordAuthProvider` 实现 `PasswordAuthProvider`。
- **理由**：当前 `authenticate(username, password)` 签名把 OAuth 强行塞成 username/password 不合理；拆分后 OAuth 可自然扩展，且本地密码 provider 可移除自动注册逻辑。
- **替代方案**：直接给 `authenticate` 加 `method` 参数 —  rejected，会让接口签名变模糊。

### 2. Refresh token 黑名单用 SQLite 持久化

- **选择**：新增 `RefreshTokenBlacklist` 表记录已撤销 refresh token 的 `jti` 与 `expiresAt`，每次 refresh 查询。
- **理由**：M2.3 需要比 M2.2 更安全的 token 管理；持久化黑名单保证进程重启后旧 refresh token 仍被拒绝。
- **风险**：表数据可能随时间膨胀。缓解：启动时 sweep 过期记录，或每月 prune。
- **替代方案**：内存 Map — rejected，重启后失效，不满足多用户长期登录需求。

### 3. per-user session cap 用 `Map<userId, number>` 计数，不依赖 AgentSession close hook

- **选择**：在 `startRpcSession` 成功时递增用户计数；不在 close 时递减（同 M2.2 已知限制）。
- **理由**：fork 的 `SessionManager` 没有暴露 close 回调，M2.3 内无法可靠递减；改为 per-user 后，单个用户耗尽自己的配额不会影响他人。
- **风险**：进程重启计数重置。缓解：同 M2.2，本 change 定位为"进程内隔离"，M3 可升级为持久化计数或 AgentSession 生命周期回调。

### 4. admin 用户创建 API 直接写入 `prisma.user`，不经过 provider

- **选择**：`POST /api/admin/users` 直接生成随机密码、bcrypt 哈希后写入 `User` 表，返回一次性明文密码。
- **理由**：provider 的 `authenticate` 只用于验证，不包含用户管理语义；admin 创建用户是数据层操作。
- **安全**：返回明文密码只在响应中出现一次，必须立即提示管理员保存。

### 5. 保留 cookie 作为 token 载体，不引入 Authorization header

- **选择**：access token 和 refresh token 都用 HttpOnly cookie，JS 不可读。
- **理由**：pi-web 是 web UI，cookie 配合 `SameSite=Lax` 足够；避免把 access token 暴露给前端 JS。

## Risks / Trade-offs

- [Risk] 关闭自动注册后，root 创建用户前系统无法被新用户使用 → 缓解：root bootstrap 在首启动时创建，admin 创建用户 API 提供最小入口。
- [Risk] refresh token 内存黑名单在进程重启后失效 → 缓解：refresh token 7d 过期是最后防线；M3 前不要部署到长期不可重启的生产环境，或加 DB 表。
- [Risk] per-user cap 重启后允许超额 → 缓解：定位为进程内隔离；超限时再触发一次拒绝即可。
- [Risk] 修改 `AuthProvider` 接口会影响现有注册调用点 → 缓解：M2.2 只有 `user-login` 和 bootstrap 调用，范围可控。

## Open Questions

1. 每个用户默认 session 上限是 5 还是 10？（建议 5，可覆盖后续调整）
2. admin 创建用户 API 是否需要在本次 change 提供最小 UI，还是纯 API？（建议纯 API + 可选最小表单）

```

## openspec/changes/pi-web-m2-3-admin-user-management/tasks.md

- Source: openspec/changes/pi-web-m2-3-admin-user-management/tasks.md
- Lines: 1-53
- SHA256: bf52121b4884ee2918625d66fb2bc34e3e31ab91d5878f023c88e18dd6f2671d

```md
# M2.3 Tasks: 受控多用户管理 — admin 创建用户 + 双 token + per-user session cap

> 产物语言：**zh-CN**
> 基于 M2.2：`openspec/changes/archive/2026-07-13-pi-web-m2-2-ui-and-hardening/`

## 1. AuthProvider 接口拆分与移除自动注册

- [ ] 1.1 修改 `lib/auth-provider.ts`：拆分为 `AuthProvider` / `PasswordAuthProvider` / `OAuthProvider`；新增 `signAccessToken`、`signRefreshToken` 方法
- [ ] 1.2 修改 `lib/auth-provider-local.ts`：`LocalPasswordAuthProvider` 实现 `PasswordAuthProvider`；`authenticate` 中未知 username 返回错误，不再自动注册
- [ ] 1.3 新增 `lib/auth-provider-bootstrap.ts`：注册 `LocalPasswordAuthProvider`；导出 `getPasswordAuthProvider()`
- [ ] 1.4 更新 `app/api/auth/user-login/route.ts`：改用 `getPasswordAuthProvider()`，移除对旧接口的依赖

## 2. Refresh token 与双 cookie 机制

- [ ] 2.1 修改 `prisma/schema.prisma`：新增 `RefreshTokenBlacklist` 表（`jti` unique, `expiresAt`, `createdAt`）
- [ ] 2.2 运行 `pnpm exec prisma migrate dev --name add_refresh_token_blacklist` 生成迁移
- [ ] 2.3 新增 `lib/token-blacklist.ts`：Prisma 持久化记录已撤销 refresh token，提供 `revokeRefreshToken(jti, expiresAt)`、`isRefreshTokenRevoked(jti)`，并清理过期记录
- [ ] 2.4 修改 `lib/auth-provider-local.ts`：`LocalPasswordAuthProvider` 实现 `PasswordAuthProvider`；实现 `signAccessToken`（15min）与 `signRefreshToken`（7d），并在 token claim 中区分 `type=access`/`type=refresh`
- [ ] 2.5 修改 `app/api/auth/user-login/route.ts`：登录成功后同时设置 `pw_at` 与 `pw_rt` cookie
- [ ] 2.6 新增 `app/api/auth/refresh/route.ts`：验证 `pw_rt`，查黑名单，旧 jti 入库，签发新 `pw_at` 与新 `pw_rt`
- [ ] 2.7 修改 `app/api/auth/user-logout/route.ts`：撤销当前 refresh token，清除 `pw_at` 与 `pw_rt` cookie
- [ ] 2.8 修改 `middleware.ts` matcher：允许 `/api/auth/refresh` 不经过 JWT 验证；注入 `x-refresh-token-jti` header

## 3. Admin 用户创建 API

- [ ] 3.1 修改 `prisma/schema.prisma`：`User` 表新增 `createdBy String?` 与 `updatedAt DateTime @updatedAt`
- [ ] 3.2 运行 `pnpm exec prisma migrate dev --name add_user_created_by` 生成迁移（可与 2.1 合并为一次迁移）
- [ ] 3.3 新增 `lib/server-user.ts`：扩展 `getCurrentUserContext` 或新增 `assertIsAdmin(req)` helper，校验 role 为 OWNER/ADMIN
- [ ] 3.4 新增 `app/api/admin/users/route.ts`：`POST` 仅 admin 可调用，生成随机密码（≥16B URL-safe），bcrypt 哈希后写入 `User`，返回一次性明文密码
- [ ] 3.5 新增 `app/api/admin/users/route.ts` 的 `GET` handler：列出当前 team 下用户（仅 admin）
- [ ] 3.6 更新 `tests/e2e/login.spec.ts`：新增 admin 创建用户 → 新用户登录 → 强制改密流程

## 4. per-user session cap

- [ ] 4.1 修改 `lib/session-cap.ts`：从全局计数器改为 `Map<userId, count>`；保留全局 50 作为兜底；默认 per-user 上限为 5
- [ ] 4.2 修改 `app/api/agent/new/route.ts`：在现有逻辑前调用 per-user cap 检查；超限时返回 503
- [ ] 4.3 在 `startRpcSession` 成功返回后调用 `perUserSessionCapIncrement(userId)`
- [ ] 4.4 新增 `lib/session-cap.test.ts`：覆盖 per-user 上限、跨用户隔离、全局兜底
- [ ] 4.5 更新 `tests/e2e/login.spec.ts`：循环创建 5 个 session 后第 6 个返回 503

## 5. UI 适配（最小改动）

- [ ] 5.1 修改 `app/[locale]/login/page.tsx`：支持 401 时调用 `/api/auth/refresh` 重试；刷新失败跳转登录页
- [ ] 5.2 修改 `app/[locale]/dashboard/page.tsx`：admin 角色显示最小“创建用户”表单；member 隐藏
- [ ] 5.3 扩 `messages/en.json` 与 `messages/zh.json`：新增 admin 创建用户相关 key（username, createUser, initialPassword 等）

## 6. 验证与收尾

- [ ] 6.1 `pnpm exec tsc --noEmit` clean
- [ ] 6.2 `pnpm exec vitest run`（含 path-safety 回归 + session-cap 新测试）all pass
- [ ] 6.3 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="是" pnpm exec playwright test` all pass
- [ ] 6.4 `pnpm run build` clean（middleware matcher 不报错）
- [ ] 6.5 浏览器手动 smoke：root 创建新用户 → 新用户登录 → 改密 → 创建 5 个 session → 第 6 个 503

```

## openspec/changes/pi-web-m2-3-admin-user-management/specs/admin-user-creation/spec.md

- Source: openspec/changes/pi-web-m2-3-admin-user-management/specs/admin-user-creation/spec.md
- Lines: 1-28
- SHA256: 147505aba90b772cb86e313b0a002c8eb863a01d1922e501d09b35f9af6aa04b

```md
## ADDED Requirements

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

## MODIFIED Requirements

无

## REMOVED Requirements

无

```

## openspec/changes/pi-web-m2-3-admin-user-management/specs/agent-session-in-process/spec.md

- Source: openspec/changes/pi-web-m2-3-admin-user-management/specs/agent-session-in-process/spec.md
- Lines: 1-39
- SHA256: 385895854a2dbbe97663b255e1270e9edeb736301bdc90704fb279bc0255cb76

```md
## MODIFIED Requirements

### Requirement: 复用 fork 的 per-session 串行调度

M2.3 在 `startRpcSession` 成功返回后，SHALL 调用 `perUserSessionCapIncrement(userId)` 增加该用户的活跃 session 计数；在 `POST /api/agent/new` 中，计数检查与递增之间应保持最小竞态窗口。

#### Scenario: 启动 session 后 per-user 计数增加
- **WHEN** `POST /api/agent/new` 成功创建 session
- **THEN** 该 user 的 per-user 计数 +1

### Requirement: SSE 端点 read-path 强制 user 权限校验

（M2.2 已实现，M2.3 保持行为不变）

### Requirement: SSE 端点 cwd 与 Project.root_path 一致

`POST /api/agent/new` handler MUST 在现有 `user.lastProjectId` → `Project` 校验之后、调用 `startRpcSession` 之前，先检查 per-user session cap；超限时返回 503。

#### Scenario: per-user cap 未超限则创建 session
- **WHEN** user 的 `lastProjectId` 有效且 per-user 计数未超限
- **THEN** 继续创建 session，成功后计数 +1

#### Scenario: per-user cap 超限拒绝创建
- **WHEN** user 的 per-user 计数已达上限
- **AND** 用户调用 `POST /api/agent/new`
- **THEN** 返回 503 `{ error: "per-user session cap reached (N)" }`
- **AND** 不调用 `startRpcSession`

### Requirement: Server 启动时 metadata rebuild 失败降级

（M2.2 已实现，M2.3 保持行为不变）

## ADDED Requirements

无

## REMOVED Requirements

无

```

## openspec/changes/pi-web-m2-3-admin-user-management/specs/auth-provider-user/spec.md

- Source: openspec/changes/pi-web-m2-3-admin-user-management/specs/auth-provider-user/spec.md
- Lines: 1-54
- SHA256: c519b237355dd07838d37cdb31832dbb397728e03ac8fd8661f14881c81d577b

```md
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

```

## openspec/changes/pi-web-m2-3-admin-user-management/specs/per-user-session-cap/spec.md

- Source: openspec/changes/pi-web-m2-3-admin-user-management/specs/per-user-session-cap/spec.md
- Lines: 1-39
- SHA256: 354f42eeaf06835cd7df4f923987c5b28100523374fe28ac9691528bf559e841

```md
## ADDED Requirements

### Requirement: 每个用户独立限制活跃 session 数量

系统 SHALL 为每个用户维护独立的活跃 session 计数，默认上限为 5；当用户尝试创建第 6 个 session 时，返回 503。

#### Scenario: 用户创建 session 在配额内
- **WHEN** 用户 A 当前活跃 session 数为 4
- **AND** 用户 A 调用 `POST /api/agent/new`
- **THEN** 系统创建成功，用户 A 计数变为 5

#### Scenario: 用户达到 per-user 上限
- **WHEN** 用户 A 当前活跃 session 数已为 5
- **AND** 用户 A 调用 `POST /api/agent/new`
- **THEN** 系统返回 503 `{ error: "per-user session cap reached (5)" }`
- **AND** 不创建 session

#### Scenario: 不同用户配额互不影响
- **WHEN** 用户 A 已达到 5 个活跃 session
- **AND** 用户 B 当前活跃 session 数为 0
- **THEN** 用户 B 调用 `POST /api/agent/new` 成功
- **AND** 用户 A 的调用继续返回 503

### Requirement: 全局 session 上限作为兜底

系统 SHALL 保留全局 50 session 上限作为兜底，当任意用户创建 session 导致全局总数达到 50 时，返回 503。

#### Scenario: 全局上限触发
- **WHEN** 所有用户活跃 session 总数达到 50
- **AND** 任意用户调用 `POST /api/agent/new`
- **THEN** 系统返回 503 `{ error: "global session cap reached (50)" }`

## MODIFIED Requirements

无

## REMOVED Requirements

无

```

## openspec/changes/pi-web-m2-3-admin-user-management/specs/refresh-token/spec.md

- Source: openspec/changes/pi-web-m2-3-admin-user-management/specs/refresh-token/spec.md
- Lines: 1-50
- SHA256: 758c16f79ac8cfab1587c94ab7ee371e5d8f9c16fd6e528105fa159ed9aa74e3

```md
## ADDED Requirements

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

## MODIFIED Requirements

无

## REMOVED Requirements

无

```

## openspec/changes/pi-web-m2-3-admin-user-management/specs/user-auth-ui/spec.md

- Source: openspec/changes/pi-web-m2-3-admin-user-management/specs/user-auth-ui/spec.md
- Lines: 1-49
- SHA256: 7b218045adf09fe07ddcec4a7a70ccd22ab306b5382a30fc1e41ee1d896af7ba

```md
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

```
