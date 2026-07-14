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
