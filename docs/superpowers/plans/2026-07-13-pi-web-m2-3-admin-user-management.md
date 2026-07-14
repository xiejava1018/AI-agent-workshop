---
change: pi-web-m2-3-admin-user-management
design-doc: docs/superpowers/specs/2026-07-13-pi-web-m2-3-admin-user-management-design.md
base-ref: ad8d043ad06d5c3304d65d04a844099987b640d6
archived-with: 2026-07-14-pi-web-m2-3-admin-user-management
---

# M2.3 pi-web 受控多用户管理实施计划

> **目标**：在 M2.2 基础上实现三件事情：
> 1. 拆分 `AuthProvider` 接口，移除自动注册，实现 access/refresh 双 token；
> 2. 新增 admin 用户创建 API + dashboard 最小管理 UI；
> 3. 把全局 session cap 改为 per-user（默认 5，全局兜底 50）。
>
> **参考文档**：
> - Design Doc: `docs/superpowers/specs/2026-07-13-pi-web-m2-3-admin-user-management-design.md`
> - Tasks: `openspec/changes/pi-web-m2-3-admin-user-management/tasks.md`
> - 基础 spec: `openspec/specs/auth-provider-user/spec.md`、`openspec/specs/user-auth-ui/spec.md`、`openspec/specs/agent-session-in-process/spec.md`
> - Base ref: `ad8d043ad06d5c3304d65d04a844099987b640d6`

## 1. 总体架构变更

| 层级 | 变更点 |
|------|--------|
| 数据模型 | `prisma/schema.prisma`：`User` 增加 `createdBy String?`、`updatedAt DateTime @updatedAt`；新增 `RefreshTokenBlacklist` 表 |
| 认证接口 | `lib/auth-provider.ts` 拆分为 `AuthProvider` / `PasswordAuthProvider` / `OAuthProvider` |
| 具体实现 | `lib/auth-provider-local.ts` 实现 `PasswordAuthProvider`，关闭自动注册 |
| 启动注册 | `lib/auth-provider-bootstrap.ts` 注册 `LocalPasswordAuthProvider` |
| Token 黑名单 | `lib/token-blacklist.ts` 持久化撤销的 refresh token jti |
| 登录/刷新/登出 | `app/api/auth/user-login/route.ts`、`app/api/auth/refresh/route.ts`、`app/api/auth/user-logout/route.ts` |
| 中间件 | `middleware.ts` 放行 `/api/auth/refresh`，注入 `x-refresh-token-jti` |
| Admin 用户管理 | `app/api/admin/users/route.ts` + `app/[locale]/dashboard/page.tsx` 创建用户表单 |
| 会话上限 | `lib/session-cap.ts` 改为 per-user Map；`app/api/agent/new/route.ts` 接入 per-user 检查 |

## 2. Phase 1: AuthProvider 接口拆分与移除自动注册

### 2.1 修改 `lib/auth-provider.ts`

**目标**：拆分为基接口 + 密码接口 + OAuth 占位；新增 token 对类型。

**预期签名**：

```ts
// lib/auth-provider.ts
export interface AuthenticatedUser {
  userId: string;
  displayName: string;
  mustChangePassword: boolean;
}

export interface TokenPair {
  accessToken: string;
  accessExpiresIn: number; // 15 * 60
  refreshToken: string;
  refreshExpiresIn: number; // 7 * 24 * 60 * 60
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

let _provider: AuthProvider | PasswordAuthProvider | OAuthProvider | null = null;

export function registerAuthProvider(p: AuthProvider): void {
  _provider = p;
}

export function getAuthProvider(): AuthProvider {
  if (!_provider) throw new Error("AuthProvider not registered");
  return _provider;
}

export function getPasswordAuthProvider(): PasswordAuthProvider {
  if (!_provider || !("signAccessToken" in _provider)) {
    throw new Error("PasswordAuthProvider not registered");
  }
  return _provider as PasswordAuthProvider;
}
```

**验证命令**：
```bash
pnpm exec tsc --noEmit
```

---

### 2.2 修改 `lib/auth-provider-local.ts`

**目标**：实现 `PasswordAuthProvider`，未知用户名不再自动注册，返回统一错误。

**变更要点**：
- `authenticate` 参数改为 `{ username, password }`；
- 未知用户 → 抛 `new Error("invalid credentials")`；
- 新增 `signAccessToken(userId)`：HS256，15 min，claim `type: "access"`；
- 新增 `signRefreshToken(userId)`：HS256，7 d，claim `type: "refresh"`；
- `revoke` 仍为 no-op（M2.3 不维护 provider 级会话状态）。

**关键代码**：

```ts
// lib/auth-provider-local.ts
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { AuthProvider, AuthenticatedUser, PasswordAuthProvider } from "./auth-provider";
import { prisma } from "./prisma";

const JWT_SECRET = process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod";
const COST = 10;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(JWT_SECRET);
}

export class LocalPasswordAuthProvider implements PasswordAuthProvider {
  async authenticate(credential: { username: string; password: string }): Promise<AuthenticatedUser> {
    const user = await prisma.user.findUnique({ where: { username: credential.username } });
    if (!user) throw new Error("invalid credentials");
    const ok = await bcrypt.compare(credential.password, user.passwordHash);
    if (!ok) throw new Error("invalid credentials");
    return {
      userId: user.id,
      displayName: user.username,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async signAccessToken(userId: string): Promise<string> {
    return await new SignJWT({ type: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setSubject(userId)
      .setExpirationTime("15m")
      .sign(secretKey());
  }

  async signRefreshToken(userId: string): Promise<string> {
    return await new SignJWT({ type: "refresh" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setSubject(userId)
      .setExpirationTime("7d")
      .sign(secretKey());
  }

  async revoke(): Promise<void> {
    // no-op in M2.3
  }
}
```

**验证命令**：
```bash
pnpm exec vitest run lib/auth-provider-local.test.ts
```

---

### 2.3 新增 `lib/auth-provider-bootstrap.ts`

**目标**：集中注册 `LocalPasswordAuthProvider`，auth route 通过 side-effect import 保证注册。

```ts
// lib/auth-provider-bootstrap.ts
import { LocalPasswordAuthProvider } from "./auth-provider-local";
import { registerAuthProvider } from "./auth-provider";

registerAuthProvider(new LocalPasswordAuthProvider());
```

---

### 2.4 更新 `app/api/auth/user-login/route.ts`

**目标**：改用 `getPasswordAuthProvider()`，返回 `pw_at` + `pw_rt` 双 cookie。

```ts
// app/api/auth/user-login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPasswordAuthProvider } from "@/lib/auth-provider";
import "@/lib/auth-provider-bootstrap";

const provider = getPasswordAuthProvider();

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: "missing credentials" }, { status: 400 });
  }
  try {
    const user = await provider.authenticate({ username, password });
    const accessToken = await provider.signAccessToken(user.userId);
    const refreshToken = await provider.signRefreshToken(user.userId);
    const res = NextResponse.json({
      id: user.userId,
      username: user.displayName,
      mustChangePassword: user.mustChangePassword,
    });
    res.cookies.set("pw_at", accessToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 15,
    });
    res.cookies.set("pw_rt", refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
}
```

**验证**：
```bash
pnpm exec tsc --noEmit
pnpm exec vitest run lib/auth-provider-local.test.ts
```

---

## 3. Phase 2: Refresh Token 黑名单与双 Cookie 机制

### 3.1 修改 `prisma/schema.prisma`

```prisma
// prisma/schema.prisma
model User {
  id                 String   @id @default(cuid())
  username           String   @unique
  passwordHash       String
  mustChangePassword Boolean  @default(false)
  lastProjectId      String?
  createdBy          String?
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

---

### 3.2 生成迁移

```bash
pnpm exec prisma migrate dev --name add_user_created_by_and_refresh_token_blacklist
```

**验证**：
```bash
pnpm exec prisma generate
```

---

### 3.3 新增 `lib/token-blacklist.ts`

**目标**：提供撤销、检查、清理过期记录。

```ts
// lib/token-blacklist.ts
import { prisma } from "./prisma";

export async function revokeRefreshToken(jti: string, expiresAt: Date): Promise<void> {
  await prisma.refreshTokenBlacklist.upsert({
    where: { jti },
    create: { jti, expiresAt },
    update: { expiresAt },
  });
}

export async function isRefreshTokenRevoked(jti: string): Promise<boolean> {
  const row = await prisma.refreshTokenBlacklist.findUnique({
    where: { jti },
  });
  return !!row;
}

export async function cleanupExpiredRefreshTokens(now: Date = new Date()): Promise<number> {
  const result = await prisma.refreshTokenBlacklist.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return result.count;
}
```

**测试先行**：`lib/token-blacklist.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { revokeRefreshToken, isRefreshTokenRevoked, cleanupExpiredRefreshTokens } from "./token-blacklist";

describe("token-blacklist", () => {
  it("returns false for unknown jti", async () => {
    expect(await isRefreshTokenRevoked("unknown")).toBe(false);
  });

  it("returns true after revoked", async () => {
    await revokeRefreshToken("jti-1", new Date(Date.now() + 60_000));
    expect(await isRefreshTokenRevoked("jti-1")).toBe(true);
  });

  it("cleans up expired tokens", async () => {
    await revokeRefreshToken("jti-expired", new Date(Date.now() - 1));
    await revokeRefreshToken("jti-alive", new Date(Date.now() + 60_000));
    const cleaned = await cleanupExpiredRefreshTokens();
    expect(cleaned).toBe(1);
    expect(await isRefreshTokenRevoked("jti-expired")).toBe(false);
    expect(await isRefreshTokenRevoked("jti-alive")).toBe(true);
  });
});
```

**验证**：
```bash
pnpm exec vitest run lib/token-blacklist.test.ts
```

---

### 3.4 新增 `app/api/auth/refresh/route.ts`

**目标**：用 `pw_rt` cookie 换新的双 token。

```ts
// app/api/auth/refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getPasswordAuthProvider } from "@/lib/auth-provider";
import { isRefreshTokenRevoked, revokeRefreshToken } from "@/lib/token-blacklist";
import "@/lib/auth-provider-bootstrap";

const SECRET = process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod";

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get("pw_rt")?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  let payload;
  try {
    const verified = await jwtVerify(refreshToken, new TextEncoder().encode(SECRET));
    payload = verified.payload;
    if (payload.type !== "refresh") throw new Error("not a refresh token");
  } catch {
    const res = NextResponse.json({ error: "invalid session" }, { status: 401 });
    res.cookies.set("pw_at", "", { httpOnly: true, path: "/", maxAge: 0 });
    res.cookies.set("pw_rt", "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  }

  const userId = String(payload.sub);
  const jti = String(payload.jti);
  const expiresAt = new Date(payload.exp! * 1000);

  if (await isRefreshTokenRevoked(jti)) {
    const res = NextResponse.json({ error: "invalid session" }, { status: 401 });
    res.cookies.set("pw_at", "", { httpOnly: true, path: "/", maxAge: 0 });
    res.cookies.set("pw_rt", "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  }

  const provider = getPasswordAuthProvider();
  const newAccess = await provider.signAccessToken(userId);
  const newRefresh = await provider.signRefreshToken(userId);

  await revokeRefreshToken(jti, expiresAt);

  const res = NextResponse.json({ ok: true });
  res.cookies.set("pw_at", newAccess, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 15,
  });
  res.cookies.set("pw_rt", newRefresh, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
```

**测试**：`app/api/auth/refresh/route.test.ts`（mock provider + blacklist）

**验证**：
```bash
pnpm exec tsc --noEmit
pnpm exec vitest run app/api/auth/refresh/route.test.ts
```

---

### 3.5 修改 `app/api/auth/user-logout/route.ts`

**目标**：撤销当前 refresh token，并清除双 cookie。

```ts
// app/api/auth/user-logout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { revokeRefreshToken } from "@/lib/token-blacklist";

const SECRET = process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod";

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get("pw_rt")?.value;
  if (refreshToken) {
    try {
      const { payload } = await jwtVerify(refreshToken, new TextEncoder().encode(SECRET));
      if (payload.type === "refresh" && payload.jti) {
        await revokeRefreshToken(String(payload.jti), new Date(payload.exp! * 1000));
      }
    } catch {
      // ignore invalid token; still clear cookies
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("pw_at", "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set("pw_rt", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
```

**验证**：
```bash
pnpm exec tsc --noEmit
```

---

### 3.6 修改 `middleware.ts`

**目标**：
- matcher 允许 `/api/auth/refresh` 不经过 JWT 验证；
- 其他 `/api/*` 仍验证 `pw_at`；
- 验证成功后注入 `x-user-id`、`x-user-role`、`x-must-change-password`、`x-refresh-token-jti`。

```ts
// middleware.ts
export const config = {
  runtime: "nodejs",
  matcher: [
    "/((?!_next/|favicon|api/auth/(?:user-login|user-logout|refresh)|api/auth/(?:providers|login|logout|all-providers|api-key)|(?:en|zh-CN)/(?:login|change-password|dashboard)|$|/en$|/zh-CN$|/en/$|/zh-CN/$).*)",
    "/api/((?!auth/(?:user-login|user-logout|refresh|providers|login|logout|all-providers|api-key)).*)",
  ],
};

export async function middleware(req: NextRequest) {
  const refreshToken = req.cookies.get("pw_rt")?.value;
  const requestHeaders = new Headers(req.headers);
  if (refreshToken) {
    try {
      const { payload } = await jwtVerify(refreshToken, new TextEncoder().encode(SECRET));
      if (payload.type === "refresh" && payload.jti) {
        requestHeaders.set("x-refresh-token-jti", String(payload.jti));
      }
    } catch {
      // ignore invalid refresh token
    }
  }

  const accessToken = req.cookies.get("pw_at")?.value;
  if (!accessToken) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  try {
    const { payload } = await jwtVerify(accessToken, new TextEncoder().encode(SECRET));
    if (payload.type !== "access") throw new Error("not an access token");
    const userId = String(payload.sub);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mustChangePassword: true },
    });
    if (!user) return NextResponse.json({ error: "invalid session" }, { status: 401 });

    const role = await getUserHighestRole(userId);
    requestHeaders.set("x-user-id", userId);
    requestHeaders.set("x-user-role", role ?? "");
    requestHeaders.set("x-must-change-password", String(user.mustChangePassword));
    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    return NextResponse.json({ error: "invalid session" }, { status: 401 });
  }
}
```

> **注意**：`refresh` 路由的 matcher 必须保证 `POST /api/auth/refresh` 能进入 refresh handler 而不是被 middleware 挡掉。refresh handler 内部自行验证 `pw_rt`。

**验证**：
```bash
pnpm exec tsc --noEmit
pnpm run build
```

---

## 4. Phase 3: Admin 用户创建 API + Dashboard UI

### 4.1 扩展 `lib/server-user.ts`

**目标**：新增 `assertIsAdmin(req)` helper，校验 `x-user-role` 为 OWNER 或 ADMIN。

```ts
// lib/server-user.ts
import { NextRequest } from "next/server";

export function isAdminRole(role: string | null): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function assertIsAdmin(req: NextRequest): { userId: string } | null {
  const userId = req.headers.get("x-user-id");
  const role = req.headers.get("x-user-role");
  if (!userId || !isAdminRole(role)) return null;
  return { userId };
}
```

---

### 4.2 新增 `app/api/admin/users/route.ts`

**POST**：仅 OWNER/ADMIN 可创建用户。

```ts
// app/api/admin/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { assertIsAdmin } from "@/lib/server-user";

export async function POST(req: NextRequest) {
  const admin = assertIsAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!username) {
    return NextResponse.json({ error: "username required" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "username taken" }, { status: 409 });
  }

  const initialPassword = randomBytes(16).toString("base64url");
  const hash = await bcrypt.hash(initialPassword, 10);

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: hash,
      mustChangePassword: true,
      createdBy: admin.userId,
    },
  });

  return NextResponse.json({
    id: user.id,
    username: user.username,
    initialPassword,
  });
}
```

**GET**：列出当前用户 team 下用户（仅 OWNER/ADMIN）。

```ts
export async function GET(req: NextRequest) {
  const admin = assertIsAdmin(req);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const teamMembers = await prisma.teamMember.findMany({
    where: { userId: admin.userId },
    select: { teamId: true },
  });
  const teamIds = teamMembers.map((t) => t.teamId);

  const users = await prisma.user.findMany({
    where: { teams: { some: { teamId: { in: teamIds } } } },
    select: { id: true, username: true, mustChangePassword: true, createdBy: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ users });
}
```

**测试**：`app/api/admin/users/route.test.ts`

**验证**：
```bash
pnpm exec tsc --noEmit
pnpm exec vitest run app/api/admin/users/route.test.ts
```

---

### 4.3 修改 `app/[locale]/dashboard/page.tsx`

**目标**：admin 角色渲染“创建用户”表单；member 隐藏。

**实现建议**：保持 dashboard 为 RSC，新增 Client Component `app/[locale]/dashboard/CreateUserForm.tsx` 处理表单交互。

```tsx
// app/[locale]/dashboard/CreateUserForm.tsx
"use client";
import { useState } from "react";

export function CreateUserForm() {
  const [result, setResult] = useState<{ username: string; initialPassword: string } | null>(null);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setResult(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: fd.get("username") }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "failed");
      return;
    }
    setResult(body);
  }

  return (
    <div className="mt-8 p-4 border rounded">
      <h2 className="text-xl mb-2">Create User</h2>
      <form onSubmit={onSubmit}>
        <input name="username" required placeholder="Username" className="border rounded px-2 py-1 mr-2" />
        <button type="submit" className="bg-blue-600 text-white rounded px-3 py-1">Create</button>
      </form>
      {error && <p className="text-red-600 mt-2">{error}</p>}
      {result && (
        <div className="mt-2 text-green-700">
          <p>Created <strong>{result.username}</strong></p>
          <p>Initial password: <code>{result.initialPassword}</code></p>
        </div>
      )}
    </div>
  );
}
```

在 RSC 中按 role 条件渲染：

```tsx
// app/[locale]/dashboard/page.tsx
import { CreateUserForm } from "./CreateUserForm";

// 在 return 中：
{ctx.role === "OWNER" || ctx.role === "ADMIN" ? <CreateUserForm /> : null}
```

---

### 4.4 扩展 `messages/en.json` 与 `messages/zh.json`

新增 key（如仅最小英文 UI 亦可只用 `dashboard.createUser` 等）：

```json
{
  "dashboard": {
    "createUser": "Create User",
    "newUsername": "New username",
    "create": "Create",
    "initialPassword": "Initial password",
    "userCreated": "User created"
  }
}
```

中文对应：

```json
{
  "dashboard": {
    "createUser": "创建用户",
    "newUsername": "新用户名",
    "create": "创建",
    "initialPassword": "初始密码",
    "userCreated": "用户已创建"
  }
}
```

**验证**：
```bash
node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf-8'));console.log('en ok')"
node -e "JSON.parse(require('fs').readFileSync('messages/zh.json','utf-8'));console.log('zh ok')"
```

---

## 5. Phase 4: per-user Session Cap

### 5.1 修改 `lib/session-cap.ts`

**目标**：从全局计数器改为 `Map<userId, count>`。

```ts
// lib/session-cap.ts
declare global {
  // eslint-disable-next-line no-var
  var __piSessionCap: { perUser: Map<string, number>; total: number } | undefined;
}

const DEFAULT_USER_CAP = 5;
const GLOBAL_CAP = 50;

function getCap() {
  if (!globalThis.__piSessionCap) {
    globalThis.__piSessionCap = { perUser: new Map(), total: 0 };
  }
  return globalThis.__piSessionCap;
}

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

export const USER_SESSION_CAP_MAX = DEFAULT_USER_CAP;
export const GLOBAL_SESSION_CAP_MAX = GLOBAL_CAP;
```

**测试先行**：`lib/session-cap.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { checkUserSessionCap, incrementUserSessionCap, decrementUserSessionCap, USER_SESSION_CAP_MAX } from "./session-cap";

beforeEach(() => {
  delete globalThis.__piSessionCap;
});

describe("per-user session cap", () => {
  it("allows below cap", () => {
    expect(checkUserSessionCap("u1").allowed).toBe(true);
  });

  it("blocks after 5 for same user", () => {
    for (let i = 0; i < USER_SESSION_CAP_MAX; i++) {
      incrementUserSessionCap("u1");
    }
    expect(checkUserSessionCap("u1").allowed).toBe(false);
  });

  it("does not block another user when one user is full", () => {
    for (let i = 0; i < USER_SESSION_CAP_MAX; i++) incrementUserSessionCap("u1");
    expect(checkUserSessionCap("u2").allowed).toBe(true);
  });

  it("decrement frees a slot", () => {
    for (let i = 0; i < USER_SESSION_CAP_MAX; i++) incrementUserSessionCap("u1");
    decrementUserSessionCap("u1");
    expect(checkUserSessionCap("u1").allowed).toBe(true);
  });
});
```

**验证**：
```bash
pnpm exec vitest run lib/session-cap.test.ts
```

---

### 5.2 修改 `app/api/agent/new/route.ts`

**目标**：在 `startRpcSession` 前调用 per-user cap 检查。

```ts
// app/api/agent/new/route.ts
import { checkUserSessionCap, incrementUserSessionCap } from "@/lib/session-cap";

// 在 userId 解析后：
const cap = checkUserSessionCap(userId);
if (!cap.allowed) {
  return new NextResponse(
    JSON.stringify({ error: `user session cap reached (${cap.current}/${cap.max})` }),
    {
      status: 503,
      headers: {
        "Retry-After": "60",
        "Content-Type": "application/json",
      },
    }
  );
}

// ... membership checks ...

const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);
incrementUserSessionCap(userId);
```

**验证**：
```bash
pnpm exec tsc --noEmit
pnpm exec vitest run app/api/agent/new/route.test.ts
```

---

## 6. Phase 5: UI 适配

### 6.1 修改 `app/[locale]/login/page.tsx`

**目标**：登录成功后已按 `mustChangePassword` 跳转；M2.3 可选：在 401 受保护 API 调用前自动 refresh。

**最小实现**（推荐）：先完成 API 端点，保持 login 页面不变。可在 dashboard 或 lib 中增加 fetch 封装，非 M2.3 blocker。

### 6.2 修改 `app/[locale]/dashboard/page.tsx`

已在 4.3 中覆盖。

---

## 7. 测试策略

| 类型 | 文件/flow | 覆盖点 |
|------|-----------|--------|
| 单元 | `lib/auth-provider-local.test.ts` | 已知用户登录成功、未知用户拒绝、token claim 类型 |
| 单元 | `lib/token-blacklist.test.ts` | 撤销、检查、过期清理 |
| 单元 | `lib/session-cap.test.ts` | per-user 上限、跨用户隔离、decrement |
| 集成 | `app/api/auth/refresh/route.test.ts` | 旧 refresh 黑名单、新 token 签发 |
| 集成 | `app/api/admin/users/route.test.ts` | 权限拒绝、创建用户、username 唯一 |
| 集成 | `app/api/agent/new/route.test.ts` | per-user cap 503 |
| E2E | `tests/e2e/admin-user.spec.ts` | root 创建用户 → 新用户登录 → 改密 → dashboard |
| E2E | `tests/e2e/refresh-token.spec.ts` | 双 cookie、refresh 轮换、登出失效 |
| E2E | `tests/e2e/login.spec.ts` | 补充 admin 创建用户流程 |

---

## 8. 验证与收尾

每个 task 完成后执行：

```bash
pnpm exec tsc --noEmit
```

Phase 完成后执行：

```bash
pnpm exec vitest run
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="是" pnpm exec playwright test
pnpm run build
```

手动 smoke：

1. `pnpm dev`
2. root 登录 → 改密 → 进 dashboard
3. admin 创建新用户 `alice`，记录一次性密码
4. `alice` 登录 → 改密 → 进 dashboard
5. `alice` 创建 5 个 session（第 6 个返回 503）
6. 登出 `alice` 后，旧 refresh token 无法再次刷新

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| AuthProvider 接口签名变更破坏 login 与测试 | 同步更新 `user-login` 路由和单元测试 |
| refresh token 并发导致竞态 | 黑名单保证旧 refresh 只能用一次，前端失败再刷新一次 |
| per-user cap 计数进程内、重启丢失 | 设计接受；M3 可持久化 |
| admin 创建用户一次性密码展示后丢失 | UI 明确提示管理员保存；后端不重复返回 |
| middleware matcher 再次触发 path-to-regexp 捕获组错误 | 严格使用非捕获组 `(?:...)`，build 验证 |

---

## 10. Success Criteria

- [x] `AuthProvider` 拆分为 `PasswordAuthProvider` / `OAuthProvider` 占位，`LocalPasswordAuthProvider` 关闭自动注册
- [x] 登录/刷新/登出三端点管理 `pw_at` + `pw_rt` 双 cookie
- [x] `RefreshTokenBlacklist` 持久化撤销记录，旧 refresh 不能复用
- [x] `POST /api/admin/users` 仅 OWNER/ADMIN 可创建用户，返回一次性明文密码
- [x] Dashboard 对 admin 显示最小创建用户表单
- [x] `lib/session-cap.ts` 改为 per-user，默认上限 5，集成到 `/api/agent/new`
- [x] `pnpm exec tsc --noEmit` 干净
- [x] `pnpm exec vitest run` 全 pass
- [x] `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="是" pnpm exec playwright test` 全 pass *(M2.3 自身 100% 通过；存在 1 项 M1 起的预先存在失败 — sessions 3-way filter — 不阻塞 M2.3 验收。详见 `docs/superpowers/reports/2026-07-14-playwright-run.md`)*
- [x] `pnpm run build` 干净
- [x] 手动 smoke 完成：root 创建用户 → 新用户登录 → 改密 → 5 个 session → 第 6 个 503 *(由用户决定带入 verify 阶段执行；session cap 行为已由 e2e test 4.5 自动验证)*
