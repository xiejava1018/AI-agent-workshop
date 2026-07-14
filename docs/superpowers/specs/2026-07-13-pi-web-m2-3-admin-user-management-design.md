---
comet_change: pi-web-m2-3-admin-user-management
role: technical-design
canonical_spec: openspec
archived-with: 2026-07-14-pi-web-m2-3-admin-user-management
status: final
---

# M2.3 Technical Design: 受控多用户管理

## 1. 总体架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Browser        │────▶│  Next.js API     │────▶│  Prisma + SQLite│
│  /[locale]/login│     │  /api/auth/*     │     │  User           │
│  /dashboard     │     │  /api/admin/users│     │  RefreshTokenBlacklist │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │ lib/auth-provider │
                        │ lib/session-cap   │
                        │ lib/rpc-manager   │
                        └─────────────────┘
```

核心变化在认证层：
- `AuthProvider` 拆分为基接口 + `PasswordAuthProvider` + `OAuthProvider` 占位
- 登录/刷新/登出三端点管理 `pw_at` + `pw_rt` 双 cookie
- refresh token 黑名单持久化到 `RefreshTokenBlacklist` 表
- 用户创建 API 受 admin 权限保护
- session cap 从全局改为 per-user

## 2. 数据模型变更

### `prisma/schema.prisma` 新增字段与表

```prisma
model User {
  id                 String   @id @default(cuid())
  username           String   @unique
  passwordHash       String
  mustChangePassword Boolean  @default(false)
  lastProjectId      String?
  createdBy          String?  // 创建者 userId
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  teams              TeamMember[]
}

model RefreshTokenBlacklist {
  id        String   @id @default(cuid())
  jti       String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([expiresAt])
}
```

说明：
- `User.createdBy` 可选，root bootstrap 用户为 null
- `RefreshTokenBlacklist` 只存撤销过的 token jti 与过期时间；7d 后过期 refresh 本身自然失效，可定期清理

## 3. AuthProvider 接口拆分

```ts
// lib/auth-provider.ts
export interface AuthenticatedUser {
  userId: string;
  displayName: string;
  mustChangePassword: boolean;
}

export interface AuthProvider {
  revoke(userId: string): Promise<void>;
}

export interface PasswordAuthProvider extends AuthProvider {
  authenticate(credential: { username: string; password: string }): Promise<AuthenticatedUser>;
  signAccessToken(userId: string): Promise<string>;
  signRefreshToken(userId: string): Promise<string>;
}

export interface OAuthProvider extends AuthProvider {
  authenticateOAuth(code: string, state: string): Promise<AuthenticatedUser>;
}

export interface TokenPair {
  accessToken: string;
  accessExpiresIn: number; // 15 * 60
  refreshToken: string;
  refreshExpiresIn: number; // 7 * 24 * 60 * 60
}

// 工厂函数
export function getPasswordAuthProvider(): PasswordAuthProvider;
export function getAuthProvider(): AuthProvider; // 通用 revoke
```

`LocalPasswordAuthProvider` 实现：
- `authenticate`: 只查 DB 不自动创建；未知用户抛 `Error("invalid credentials")`
- `signAccessToken`: HS256, 15min, sub=userId, jti=随机
- `signRefreshToken`: HS256, 7d, sub=userId, jti=随机
- `revoke`: no-op（M2.3 不维护 provider 级会话状态）

密钥策略：
- access token 与 refresh token 可用同一 `PI_WEB_JWT_SECRET`（同 M2.2），但建议通过 claim 区分 `type=access`/`type=refresh`
- 不强制拆分密钥，降低迁移成本

## 4. Token 生命周期

### 登录

`POST /api/auth/user-login`

```ts
const user = await provider.authenticate({ username, password });
const accessToken = await provider.signAccessToken(user.userId);
const refreshToken = await provider.signRefreshToken(user.userId);
res.cookies.set("pw_at", accessToken, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 15 });
res.cookies.set("pw_rt", refreshToken, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
return { id, username, mustChangePassword };
```

### 刷新

`POST /api/auth/refresh`

1. 读取 `pw_rt` cookie；缺失 → 401
2. `jwtVerify(refreshToken, secret)` → 取 `payload.sub`, `payload.jti`, `payload.type` 必须为 `refresh`
3. 查 `prisma.refreshTokenBlacklist.findUnique({ where: { jti } })` → 存在 → 401，并清除双 cookie
4. 把旧 jti 写入黑名单
5. 签发新 access + refresh token
6. 设置新 cookie，返回 200

### 登出

`POST /api/auth/user-logout`

1. 读取 `pw_rt` cookie
2. 若有效，把 jti 写入黑名单
3. 清除 `pw_at` 和 `pw_rt` cookie（maxAge=0）
4. 返回 200

### middleware 变更

- matcher 允许 `/api/auth/refresh` 通过，不依赖 `pw_at`
- 其他 `/api/*` 仍验证 `pw_at`
- 验证成功后注入 `x-user-id`、`x-user-role`、`x-must-change-password`、`x-refresh-token-jti`（可选）
- access token 过期时，受保护 API 返回 401；客户端自己调用 `/api/auth/refresh` 续期

## 5. Admin 用户创建

### API: `POST /api/admin/users`

权限：调用者 role 必须为 OWNER 或 ADMIN。

输入：
```json
{ "username": "alice", "teamId": "..." }
```

输出：
```json
{ "id": "cuid", "username": "alice", "initialPassword": "url-safe-16-bytes" }
```

实现：
1. 从 `x-user-id` 读取调用者，查 `getCurrentUserContext(userId)`
2. 校验 `role === 'OWNER' || role === 'ADMIN'`；否则 403
3. 校验 `username` 不为空且唯一；否则 409
4. 生成 16-byte URL-safe base64 随机密码
5. bcrypt hash（cost=10）写入 `prisma.user.create`
6. 若提供 `teamId`，将新用户加入该 team 为 MEMBER（调用者需是 team 的 OWNER/ADMIN）
7. 返回一次性明文密码

### API: `GET /api/admin/users`

返回当前 team 下用户列表（仅 OWNER/ADMIN）。用于 dashboard 用户管理入口。

### Dashboard 最小 UI

在 `app/[locale]/dashboard/page.tsx` 中：
- 若 `ctx.role === 'OWNER' || ctx.role === 'ADMIN'`，渲染 "Create User" 按钮/表单
- 表单仅含 username，提交后显示一次性 initialPassword
- 不实现复杂用户列表（M2.3+ 可选）

## 6. per-user Session Cap

### 数据结构

```ts
// lib/session-cap.ts
const DEFAULT_USER_CAP = 5;
const GLOBAL_CAP = 50;

declare global {
  var __piSessionCap: { perUser: Map<string, number>; total: number } | undefined;
}

function getCap() { ... }

export function checkUserSessionCap(userId: string): { allowed: boolean; current: number; max: number } {
  const cap = getCap();
  const current = cap.perUser.get(userId) || 0;
  if (current >= DEFAULT_USER_CAP) return { allowed: false, current, max: DEFAULT_USER_CAP };
  if (cap.total >= GLOBAL_CAP) return { allowed: false, current, max: GLOBAL_CAP };
  return { allowed: true, current, max: DEFAULT_USER_CAP };
}

export function incrementUserSessionCap(userId: string): void {
  const cap = getCap();
  cap.perUser.set(userId, (cap.perUser.get(userId) || 0) + 1);
  cap.total++;
}

export function decrementUserSessionCap(userId: string): void {
  const cap = getCap();
  const current = cap.perUser.get(userId) || 0;
  if (current > 0) cap.perUser.set(userId, current - 1);
  if (cap.total > 0) cap.total--;
}
```

### 集成点

`POST /api/agent/new`：
1. 在 `user.lastProjectId` 解析后、调用 `startRpcSession` 前，调用 `checkUserSessionCap(userId)`
2. 若不允许，返回 503
3. `startRpcSession` 成功后，调用 `incrementUserSessionCap(userId)`

`fork` 场景：fork 创建新 session 文件，应视为新 session；在 fork 调用链中也要增加计数。M2.3 在 `startRpcSession` 的调用点统一处理，fork 内部也经过 `startRpcSession`。

decrement 仍无可靠调用点（M2.2 已知限制）。`beforeExit` 进程退出时打印日志。

## 7. 前端改动

### 登录页 (`app/[locale]/login/page.tsx`)

M2.3 内保持当前行为不变：登录成功后按 `mustChangePassword` 跳转。refresh token 续期逻辑在 M2.3 **可选**：可先在 dashboard 页面中通过 axios/fetch 拦截器实现，也可以本次只做 API 端点，让登录页保持现状。考虑到最小改动，建议本次先完成 API 端点，前端续期作为 dashboard 或 fetch 封装中的简单包装；若时间允许，在 `app/[locale]/layout.tsx` 或 dashboard 中加一个 `useAuthRefresh` hook。

### Dashboard 创建用户表单

新增 Client Component（或直接在 RSC 中用 Server Action）：
- 推荐用 Server Action（`"use server"`），避免额外 API 调用
- 表单调用 `createUser({ username })`，返回 `{ id, username, initialPassword }`
- 在 dashboard 渲染创建结果，并提示管理员保存密码

## 8. 测试策略

### 单元测试 (Vitest)

- `lib/session-cap.test.ts`: per-user cap、全局 cap、跨用户隔离、decrement
- `lib/auth-provider-local.test.ts`: 已知用户登录成功、未知用户拒绝、自动注册已关闭
- `lib/token-blacklist.test.ts`: 撤销、过期检查、重复撤销幂等

### E2E (Playwright)

- `tests/e2e/admin-user.spec.ts`:
  - root 创建用户
  - 新用户首次登录改密
  - 改密后 dashboard 可见
- `tests/e2e/refresh-token.spec.ts`:
  - 登录后双 cookie 存在
  - 手动修改 access token 过期后调用 refresh 成功
  - 旧 refresh token 不能再次使用
  - 登出后 refresh token 失效
- `tests/e2e/session-cap.spec.ts`:
  - 同一用户创建 5 个 session 后第 6 个 503
  - 另一用户仍可创建 session

### 手动 smoke

- `pnpm run build` 不报错
- `pnpm dev` 后：root 创建新用户 → 新用户登录 → 改密 → 进 dashboard → 创建 5 个 session → 第 6 个 503

## 9. 关键边界条件

- access token 过期但 refresh token 有效 → 前端应静默 refresh；若 refresh 失败 → 跳转登录
- 同时两个请求都发现 access token 过期 → 可能并发调用 refresh；后端用黑名单保证旧 refresh 只被第一次成功使用，第二次返回 401；前端失败再 refresh 一次即可
- root 用户改密码后，当前 refresh token 是否失效？按 design 决策：改密不强制使所有 refresh 失效，但用户可主动登出；若安全要求更高，可在改密后把当前 jti 加入黑名单。本次不做全局失效，降低复杂度。
- 未知用户登录 → 返回 401，不创建用户，不泄露用户是否存在（返回通用错误）
- admin 创建用户失败时，不返回已生成密码（只有成功才返回）

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 关闭自动注册后新用户无法使用 | root bootstrap 创建 root；admin 创建用户 API 提供入口；后续 M2.3+ 可考虑邀请码 |
| refresh token 表数据膨胀 | 定期清理 `expiresAt < now()` 的记录；可在启动时 sweep |
| per-user cap 重启后丢失 | 进程内隔离；M3 可升级持久化计数或 AgentSession 生命周期回调 |
| AuthProvider 接口改动影响现有测试 | 更新受影响的测试；范围仅限 `user-login` 和 bootstrap |

## 11. 实现顺序

1. 更新 schema + 迁移
2. 重构 `AuthProvider` 接口与 `LocalPasswordAuthProvider`
3. 实现 `lib/token-blacklist.ts` 和 refresh token 相关 API
4. 更新 middleware matcher 和 login/logout/refresh 路由
5. 实现 admin 用户创建 API + dashboard 表单
6. 改造 `lib/session-cap.ts` 为 per-user，集成到 `/api/agent/new`
7. 单元测试 + E2E + build 验证
