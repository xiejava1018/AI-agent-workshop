# M2.3 Tasks: 受控多用户管理 — admin 创建用户 + 双 token + per-user session cap

> 产物语言：**zh-CN**
> 基于 M2.2：`openspec/changes/archive/2026-07-13-pi-web-m2-2-ui-and-hardening/`

## 1. AuthProvider 接口拆分与移除自动注册

- [x] 1.1 修改 `lib/auth-provider.ts`：拆分为 `AuthProvider` / `PasswordAuthProvider` / `OAuthProvider`；新增 `signAccessToken`、`signRefreshToken` 方法
- [x] 1.2 修改 `lib/auth-provider-local.ts`：`LocalPasswordAuthProvider` 实现 `PasswordAuthProvider`；`authenticate` 中未知 username 返回错误，不再自动注册
- [x] 1.3 新增 `lib/auth-provider-bootstrap.ts`：注册 `LocalPasswordAuthProvider`；导出 `getPasswordAuthProvider()`
- [x] 1.4 更新 `app/api/auth/user-login/route.ts`：改用 `getPasswordAuthProvider()`，移除对旧接口的依赖

## 2. Refresh token 与双 cookie 机制

- [x] 2.1 修改 `prisma/schema.prisma`：新增 `RefreshTokenBlacklist` 表（`jti` unique, `expiresAt`, `createdAt`）
- [x] 2.2 运行 `pnpm exec prisma migrate dev --name add_refresh_token_blacklist` 生成迁移
- [x] 2.3 新增 `lib/token-blacklist.ts`：Prisma 持久化记录已撤销 refresh token，提供 `revokeRefreshToken(jti, expiresAt)`、`isRefreshTokenRevoked(jti)`，并清理过期记录
- [x] 2.4 修改 `lib/auth-provider-local.ts`：`LocalPasswordAuthProvider` 实现 `PasswordAuthProvider`；实现 `signAccessToken`（15min）与 `signRefreshToken`（7d），并在 token claim 中区分 `type=access`/`type=refresh`
- [x] 2.5 修改 `app/api/auth/user-login/route.ts`：登录成功后同时设置 `pw_at` 与 `pw_rt` cookie
- [x] 2.6 新增 `app/api/auth/refresh/route.ts`：验证 `pw_rt`，查黑名单，旧 jti 入库，签发新 `pw_at` 与新 `pw_rt`
- [x] 2.7 修改 `app/api/auth/user-logout/route.ts`：撤销当前 refresh token，清除 `pw_at` 与 `pw_rt` cookie
- [x] 2.8 修改 `middleware.ts` matcher：允许 `/api/auth/refresh` 不经过 JWT 验证；注入 `x-refresh-token-jti` header

## 3. Admin 用户创建 API

- [x] 3.1 修改 `prisma/schema.prisma`：`User` 表新增 `createdBy String?` 与 `updatedAt DateTime @updatedAt`
- [x] 3.2 运行 `pnpm exec prisma migrate dev --name add_user_created_by` 生成迁移（可与 2.1 合并为一次迁移）
- [x] 3.3 新增 `lib/server-user.ts`：扩展 `getCurrentUserContext` 或新增 `assertIsAdmin(req)` helper，校验 role 为 OWNER/ADMIN
- [x] 3.4 新增 `app/api/admin/users/route.ts`：`POST` 仅 admin 可调用，生成随机密码（≥16B URL-safe），bcrypt 哈希后写入 `User`，返回一次性明文密码
- [x] 3.5 新增 `app/api/admin/users/route.ts` 的 `GET` handler：列出当前 team 下用户（仅 admin）
- [ ] 3.6 更新 `tests/e2e/login.spec.ts`：新增 admin 创建用户 → 新用户登录 → 强制改密流程

## 4. per-user session cap

- [x] 4.1 修改 `lib/session-cap.ts`：从全局计数器改为 `Map<userId, count>`；保留全局 50 作为兜底；默认 per-user 上限为 5
- [x] 4.2 修改 `app/api/agent/new/route.ts`：在现有逻辑前调用 per-user cap 检查；超限时返回 503
- [x] 4.3 在 `startRpcSession` 成功返回后调用 `perUserSessionCapIncrement(userId)`
- [x] 4.4 新增 `lib/session-cap.test.ts`：覆盖 per-user 上限、跨用户隔离、全局兜底
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
