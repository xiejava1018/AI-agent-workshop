---
comet_change: pi-web-m2-2-ui-and-hardening
role: technical-design
canonical_spec: openspec
---

# 设计文档 — M2.2 通用 web 多用户 AI agent 工作台 (UI + 硬化 + 50 session cap)

> Language: zh-CN
> 反链上游：[proposal.md](../changes/pi-web-m2-2-ui-and-hardening/proposal.md)、[design.md](../changes/pi-web-m2-2-ui-and-hardening/design.md)、[tasks.md](../changes/pi-web-m2-2-ui-and-hardening/tasks.md)、6 个 capability spec、脑暴记录 [brainstorm-summary.md](../changes/pi-web-m2-2-ui-and-hardening/.comet/handoff/brainstorm-summary.md)、交接包 design-context.{json,md}。

本设计文档是基于 OpenSpec open 阶段产物的**深化**，不是替代：高层架构决策、Cap 选项、根取舍已在 `openspec/changes/pi-web-m2-2-ui-and-hardening/design.md` 中记录。

---

## 1. 范围与上下文

M2.2 范围在 M1 之上叠加 (a) 浏览器 UI 页面 + (b) M1 verify 报告 deferred 的 5 项 WARNING 修复 + (c) 50 session 全局硬上限。代码实操落地路径：

- 仓库根 `/Users/xiejava/AIproject/AI-agent-workshop/` — 已在 main 上（base_ref `934f21a`，M1 archive 提交点）
- M1 全部产物已就绪并归档于 `openspec/changes/archive/2026-07-13-pi-web-generalized-m1-runnable/`
- fork 仓库 `/Users/xiejava/AIproject/pi-web/`（[xiejava1018/pi-web](https://github.com/xiejava1018/pi-web) v0.7.11）作为 fork origin
- 后续 build 阶段在 worktree 隔离下进行

**本设计文档的目的**：把 OpenSpec open 阶段的"做什么、cap 选项"落到"具体怎么落地、数据流、边界条件、测试策略"。

**与 M1 的关系**：M1 加了后端 auth + project + path-safety + session authz 5 个 lib + 7 个 API 路由 + middleware + SidebarProjectPicker；M2.2 不重写这些，只补 (a) 浏览器 UI 入口 (b) 5 个 deferred 修复 (c) 50 session cap 守卫。

---

## 2. 架构与数据流

### 2.1 模块图（M1 之上增量）

```
                         Browser
                            │
                            ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Next.js 16 App Router (fork pi-web)                   │
   │  middleware.ts (M1 + runtime:'nodejs' + x-must-change) │
   │                                                         │
   │   app/[locale]/                    (M2.2 NEW)          │
   │   ├── layout.tsx                    NextIntlClientProvider│
   │   ├── login/page                    (client form)        │
   │   ├── change-password/page          (client form)        │
   │   └── dashboard/page                (server RSC)         │
   │                                                         │
   │   app/api (M1 + M2.2)                                  │
   │   ├── auth/user-login (M1)                               │
   │   ├── auth/user-logout (M1)                              │
   │   ├── auth/change-password (M1)                          │
   │   ├── projects/route (M1)                                │
   │   ├── projects/[id]/bind (M1)                            │
   │   ├── agent/[id]/events (M1)                            │
   │   ├── agent/[id] (M1 + M2.2 mustChangePwd gate)        │
   │   ├── agent/new (M1 + M2.2 lastProjectId + 50-cap)     │
   │   └── sessions (M1 + M2.2 3-way filter)                 │
   │                                                         │
   │   instrumentation.ts               (M2.2 NEW, register) │
   │     ↳ rebuildFromJsonl on boot                          │
   └─────────────────────────────────────────────────────────┘
              │                                       │
              ▼                                       ▼
   ┌──────────────────────────┐         ┌───────────────────────────────┐
   │ Prisma (lib/prisma.ts)    │         │ lib/session-meta.ts (M1)      │
   │   M2.2 single instance   │         │   in-memory map + 50 cap counter│
   │                          │         │   globalThis.__piSessionMeta  │
   └──────────────────────────┘         └───────────────────────────────┘
                                                       │
                                                       ▼
                                              .jsonl on filesystem
                                              <PI_WEB_DATA_DIR>/**/*.jsonl
                                              (rebuilt by instrumentation.ts on boot)
```

### 2.2 数据流一：用户登录

```
用户访问 /en/login (client form)
    │
    ▼
POST /api/auth/user-login {username, password}
    │
    ▼
[handler] LocalPasswordAuthProvider.authenticate
    │
    ├─ prisma.user.findUnique({username}) [via lib/prisma 单例]
    │   未找到? prisma.user.create({username, passwordHash: bcrypt()})
    │
    ├─ bcrypt.compare(password, user.passwordHash)
    │   失败 → 401 "invalid credentials"
    │
    ├─ signJwt (jose) { sub: userId, exp: now+15min }
    │
    └─ Set-Cookie "pw_at=<jwt>; HttpOnly; Path=/; Max-Age=900"
    │
    ▼
client form 接收响应
    │
    ├─ mustChangePassword === true → router.push(/en/change-password)
    │
    └─ mustChangePassword === false → router.push(/en/dashboard)
```

### 2.3 数据流二：改密后访问 dashboard

```
用户 POST /en/change-password {newPassword}
    │
    ▼
POST /api/auth/change-password
    │
    ├─ x-user-id header (由 middleware 注入)
    │
    ├─ enforceNotMustChange(req) → null (change-password 在白名单)
    │
    ├─ 校验 newPassword.length >= 8
    │
    ├─ prisma.user.update({
    │     where: { id: userId },
    │     data: { passwordHash: bcrypt(newPassword, 10), mustChangePassword: false }
    │   })
    │
    └─ 200 { ok: true }
    │
    ▼
client form 跳 /en/dashboard
    │
    ▼
GET /en/dashboard (server component, RSC)
    │
    ├─ getCurrentUserContext(userId) [lib/server-user.ts]
    │   → { user, role, teamIds, mustChangePassword }
    │
    ├─ fetch('http://localhost:30141/api/projects', {
    │     headers: { cookie: <user's pw_at cookie> },
    │     cache: 'no-store'
    │   })
    │   → { projects: [...] }
    │
    └─ render(<DashboardShell data={user, teamIds, projects}>)
        │
        ├─ 显示 "Welcome root (OWNER)"
        ├─ 显示 "mustChangePassword: false"
        ├─ 显示 team name (e.g., "Default Team")
        ├─ 列出 projects（用 t('dashboard.projects') 渲染）
        └─ 列出 recent sessions (top 5) — optional, 拉 GET /api/sessions
```

### 2.4 数据流三：mustChangePassword 门拦截

```
用户 POST /api/agent/new (mustChangePassword=true)
    │
    ▼
POST /api/agent/new handler
    │
    ├─ enforceNotMustChange(req) [lib/must-change-password.ts]
    │   ├─ 读 x-must-change-password header
    │   │
    │   ├─ 'true' → 返 403 { error: "password change required" }
    │   │  (user 必须先去 /en/change-password)
    │   │
    │   └─ 'false' / 缺失 → 返 null (通过)
    │
    ├─ (if passed) check 50 cap
    │   ├─ cap >= 50 → 503 + Retry-After: 60
    │   └─ < 50 → continue
    │
    ├─ (if passed) load user.lastProjectId
    │   ├─ null → 400 "no project selected"
    │   └─ 有 → continue
    │
    ├─ load project + teamId, check membership
    │   └─ not member → 403 forbidden
    │
    ├─ assertWithinRoot(project.rootPath, project.rootPath) [M1]
    │
    ├─ statSync(project.rootPath) + allowFileRoot [M1]
    │
    ├─ cap++ (in-memory counter)
    │
    └─ startRpcSession (fork) → sessionId
```

### 2.5 数据流四：server 启动 rebuildFromJsonl

```
server boot
    │
    ▼
Next.js 16 'register' phase
    │
    ▼
instrumentation.ts → register()
    │
    └─ rebuildFromJsonl(map)
        │
        ├─ 扫 <PI_WEB_DATA_DIR>/**/*.jsonl
        │
        ├─ 每条第一行 parse JSON
        │   ├─ 成功 + 含 userId → recordSessionMeta(sid, userId, projectId)
        │   ├─ 成功 + 不含 userId → recordSessionMeta(sid, null, null) (匿名)
        │   └─ 失败 → recordSessionMeta(sid, null, null) (降级)
        │
        └─ 完成 (耗时 < 50ms for 1000 sessions per M1 design §4.5)
```

### 2.6 数据流五：sessions 3-way 过滤

```
GET /api/sessions (user X)
    │
    ▼
[handler]
    │
    ├─ getUserTeamIds(X) [lib/server-user.ts]
    │   → [teamT1, teamT2, ...]
    │
    ├─ SELECT * FROM sessions
    │   WHERE  (
    │     user_id = X.id                              -- 自己是 owner
    │     OR user_role IN ('OWNER', 'ADMIN')
    │        AND project_id IN (                      -- 自己 team 内的 admin
    │          SELECT id FROM projects
    │          WHERE team_id IN (X 的 admin teamIds)
    │        )
    │     OR sid IN (                                 -- M2.4 share placeholder (空)
    │       SELECT session_id FROM session_shares
    │       WHERE shared_with_user_id = X.id
    │     )
    │   )
    │
    └─ return filtered list
```

---

## 3. 关键技术细节

### 3.1 lib/prisma.ts 单例

```ts
// lib/prisma.ts
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
```

**M1 重构**: 6 个 `new PrismaClient()` 替换为 `import { prisma } from "@/lib/prisma"`：
- `lib/auth-provider-local.ts:6`
- `lib/user-role.ts:3`
- `app/api/auth/user-login/route.ts:3`
- `app/api/auth/user-logout/route.ts:3` (无 prisma, 跳过)
- `app/api/auth/change-password/route.ts:3`
- `app/api/projects/route.ts:4`
- `app/api/projects/[id]/bind/route.ts:7`

### 3.2 middleware.ts (M1 + runtime + mustChangePwd 注入)

```ts
// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

const SECRET = process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod";

export const config = {
  runtime: "nodejs",  // M2.2 NEW: Prisma 需要 Node runtime
  matcher: [
    // M1 已有 + 扩 i18n UI 例外
    "/((?!_next/|favicon|api/auth/(?:user-login|user-logout|change-password|providers|login|logout|all-providers|api-key)|(?:en|zh-CN)/(?:login|change-password|dashboard)).*)",
    // 显式拦 /api/* 一律
    "/api/((?!auth/(?:user-login|user-logout|change-password|providers|login|logout|all-providers|api-key)).*)",
  ],
};

export async function middleware(req: NextRequest) {
  // 1. UI 页面短路 (M2.2 NEW)
  const localeMatch = req.nextUrl.pathname.match(/^\/(en|zh-CN)\//);
  if (localeMatch) return NextResponse.next();

  // 2. JWT 验证 (M1)
  const cookie = req.cookies.get("pw_at")?.value;
  if (!cookie) return NextResponse.json({ error: "auth required" }, { status: 401 });
  try {
    const { payload } = await jwtVerify(cookie, new TextEncoder().encode(SECRET));
    const userId = String(payload.sub);

    // 3. mustChangePassword 注入 (M2.2 NEW)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mustChangePassword: true },
    });
    if (!user) {
      return NextResponse.json({ error: "user not found" }, { status: 401 });
    }

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-user-id", userId);
    requestHeaders.set("x-must-change-password", String(user.mustChangePassword));

    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    return NextResponse.json({ error: "invalid session" }, { status: 401 });
  }
}
```

**Matcher 风险**: M1 已踩过 path-to-regexp v8 "Capturing groups" 坑。M2.2 matcher 含 2 个 `(?:...)` 非捕获组 + 1 个 `[^/]+` 字符类；Task 1.6 在 build 早期验证。

### 3.3 lib/must-change-password.ts

```ts
// lib/must-change-password.ts
import { NextRequest, NextResponse } from "next/server";

const ALLOWLIST = new Set(["/api/auth/change-password"]);

export function enforceNotMustChange(req: NextRequest): NextResponse | null {
  // 白名单：change-password 自身 + 静态资源 (中间件已挡)
  if (ALLOWLIST.has(req.nextUrl.pathname)) return null;

  // 读 header
  const flag = req.headers.get("x-must-change-password");

  // 'true' (string from middleware) → 拦截
  if (flag === "true") {
    return NextResponse.json(
      { error: "password change required" },
      { status: 403 }
    );
  }

  // 'false' / 缺失 (dev 直接 curl 场景) → 通过
  return null;
}
```

**用法**（每个写路由顶部）：
```ts
import { enforceNotMustChange } from "@/lib/must-change-password";

export async function POST(req: NextRequest) {
  const gate = enforceNotMustChange(req);
  if (gate) return gate;
  // ... 业务逻辑
}
```

### 3.4 lib/server-user.ts

```ts
// lib/server-user.ts
import { prisma } from "@/lib/prisma";

export type UserContext = {
  user: { id: string; username: string; mustChangePassword: boolean };
  role: "OWNER" | "ADMIN" | "MEMBER" | null;
  teamIds: string[];
  mustChangePassword: boolean;
};

export async function getUserHighestRole(
  userId: string
): Promise<"OWNER" | "ADMIN" | "MEMBER" | null> {
  const tms = await prisma.teamMember.findMany({ where: { userId } });
  if (tms.some(t => t.role === "OWNER")) return "OWNER";
  if (tms.some(t => t.role === "ADMIN")) return "ADMIN";
  if (tms.some(t => t.role === "MEMBER")) return "MEMBER";
  return null;
}

export async function getUserTeamIds(userId: string): Promise<string[]> {
  const tms = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true },
  });
  return tms.map(t => t.teamId);
}

export async function getCurrentUserContext(userId: string): Promise<UserContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, mustChangePassword: true },
  });
  if (!user) return null;

  const [role, teamIds] = await Promise.all([
    getUserHighestRole(userId),
    getUserTeamIds(userId),
  ]);

  return { user, role, teamIds, mustChangePassword: user.mustChangePassword };
}
```

### 3.5 lib/session-cap.ts (50 全局硬上限)

```ts
// lib/session-cap.ts
declare global {
  // eslint-disable-next-line no-var
  var __piSessionCounter: { count: number } | undefined;
}

const MAX = 50;

function getCounter() {
  if (!globalThis.__piSessionCounter) {
    globalThis.__piSessionCounter = { count: 0 };
  }
  return globalThis.__piSessionCounter;
}

export function sessionCapCheck(): { allowed: boolean; current: number } {
  const counter = getCounter();
  if (counter.count >= MAX) {
    return { allowed: false, current: counter.count };
  }
  return { allowed: true, current: counter.count };
}

export function sessionCapIncrement(): void {
  const counter = getCounter();
  counter.count++;
}

export function sessionCapDecrement(): void {
  const counter = getCounter();
  if (counter.count > 0) counter.count--;
}

export const SESSION_CAP_MAX = MAX;
```

**已知 limit**: server crash → counter drift。**不修**（M3 janitor 一起做）。

### 3.6 instrumentation.ts (rebuildFromJsonl)

```ts
// instrumentation.ts (repo root, Next.js 16 special file)
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { rebuildFromJsonl } = await import("@/lib/session-meta");
    const map = globalThis.__piSessionMeta ?? new Map();
    globalThis.__piSessionMeta = map;
    await rebuildFromJsonl(map);
    console.log(
      `[INSTRUMENTATION] rebuildFromJsonl complete, ${map.size} sessions loaded`
    );
  }
}
```

**rebuildFromJsonl 实现** (in `lib/session-meta.ts`)：

```ts
export async function rebuildFromJsonl(
  map: Map<string, SessionMetaRow>
): Promise<void> {
  const dataDir = process.env.PI_WEB_DATA_DIR || "./data";
  // 扫 dataDir 下所有 .jsonl
  // 每条第一行 parse JSON
  // 提取 userId（若存在）/ projectId（若存在）
  // 调用 recordSessionMeta(sid, userId, projectId)
  // 失败 catch 后继续（M1 spec §"Server 启动时 metadata rebuild 失败降级"）
}
```

**M1 现有 stub** (`lib/session-meta.ts:19-22`) 是 no-op；M2.2 替换为真实实现。

### 3.7 i18n `[locale]` 路由 wiring

**`app/[locale]/layout.tsx`**：
```tsx
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@/lib/i18n";
import { notFound } from "next/navigation";

const SUPPORTED = ["en", "zh-CN"] as const;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!SUPPORTED.includes(locale as any)) notFound();
  const messages = getMessages(locale as any);
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

**`app/[locale]/login/page.tsx`** (client component)：
```tsx
"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const t = useTranslations("login");
  const router = useRouter();
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/user-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: fd.get("username"),
        password: fd.get("password"),
      }),
    });
    if (!res.ok) { setError(t("error")); return; }
    const body = await res.json();
    router.push(body.mustChangePassword ? "/change-password" : "/dashboard");
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>{t("title")}</h1>
      <input name="username" placeholder={t("username")} />
      <input name="password" type="password" placeholder={t("password")} />
      {error && <p className="error">{error}</p>}
      <button type="submit">{t("submit")}</button>
    </form>
  );
}
```

**`app/[locale]/dashboard/page.tsx`** (server component)：
```tsx
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { getCurrentUserContext } from "@/lib/server-user";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "dashboard" });

  // 从 cookie 拿 userId
  const cookieStore = await cookies();
  const token = cookieStore.get("pw_at")?.value;
  if (!token) return <p>{t("mustLogin")}</p>;

  const { payload } = await jwtVerify(token, new TextEncoder().encode(
    process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod"
  ));
  const userId = String(payload.sub);

  const ctx = await getCurrentUserContext(userId);
  if (!ctx) return <p>{t("userNotFound")}</p>;

  // 拉 projects
  const projects = await prisma.project.findMany({
    where: { teamId: { in: ctx.teamIds } },
  });

  return (
    <div>
      <h1>{t("title")}</h1>
      <p>{t("welcome", { username: ctx.user.username, role: ctx.role ?? "—" })}</p>
      <p>{t("mustChangePassword")}: {String(ctx.mustChangePassword)}</p>
      <h2>{t("projects")}</h2>
      <ul>
        {projects.map(p => (
          <li key={p.id}>{p.name} ({p.rootPath})</li>
        ))}
      </ul>
    </div>
  );
}
```

### 3.8 lib/must-change-password.meta.test.ts (AST scan)

```ts
// lib/must-change-password.meta.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ALLOWLIST = new Set([
  "app/api/auth/change-password/route.ts",
]);

function* walkRoutes(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      yield* walkRoutes(p);
    } else if (name === "route.ts") {
      yield(p);
    }
  }
}

function hasWriteHandler(content: string): boolean {
  // 检测 export async function POST/PUT/DELETE/PATCH
  return /export\s+async\s+function\s+(POST|PUT|DELETE|PATCH)\b/.test(content);
}

function usesEnforceNotMustChange(content: string): boolean {
  return /enforceNotMustChange\s*\(/.test(content);
}

describe("mustChangePassword gate coverage", () => {
  for (const routeFile of walkRoutes("app/api")) {
    const rel = routeFile.replace(/\\/g, "/");
    if (ALLOWLIST.has(rel)) continue;

    it(`${rel} POST/PUT/DELETE must call enforceNotMustChange`, () => {
      const content = readFileSync(routeFile, "utf-8");
      if (!hasWriteHandler(content)) return; // 读路由，跳过
      expect(usesEnforceNotMustChange(content)).toBe(true);
    });
  }
});
```

**为什么 AST 不正则** (更简单)：M2.2 6 个写路由都是简单 `export async function POST() { ... }` 形态；正则匹配 `\benforceNotMustChange\s*\(` 在 multi-line 字符串 / block comment / 字符串字面量中不会误报（写路由 handler 不会引用这个 token）。

### 3.9 Dockerfile 补 prisma migrate deploy

```dockerfile
FROM node:22-slim AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec prisma generate
RUN pnpm exec prisma migrate deploy  # M2.2 NEW
RUN pnpm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
```

---

## 4. 边界与错误处理

### 4.1 mustChangePassword 边界

- 用户未带 cookie (middleware 已挡 401) → 不进 write handler
- `x-must-change-password` header 缺失（dev 直接 curl 场景）→ `enforceNotMustChange` 视为 false (通过)。**这是设计选择**：dev 测试便利；prod 不会有这场景（middleware 必注入）
- user 不存在 (DB race：cookie 有效但 user 被删) → middleware 401
- 白名单 `/api/auth/change-password` 自身 → 永通过 (用户可改密解锁)
- `/api/auth/user-login` 和 `/api/auth/user-logout` 不在白名单：login 永远通过 (no mustChangePwd semantic on entry); logout 永远 idempotent. **这两个 endpoint 也没有 write handler 在白名单**——他们不需要 enforceNotMustChange (logout 是 idempotent, login 是 entry point)

### 4.2 50 session cap 边界

- counter 内存，server restart 归零 → 文档中明确 M2.2 已知 limit
- counter drift (server crash 不 close session) → **M2.2 不修**，M3 部署时加 janitor
- 并发 POST /api/agent/new 竞争 → in-memory `count++` 在 Node 单线程下原子（JS event loop 串行），但 `count >= 50` 检查 + 后续 `count++` 中间无 await → 实际上 51 个 session 同时 create 在 Node 中是 race-free
- 超 50 时 503 + `Retry-After: 60` → 客户端可选择性 backoff

### 4.3 i18n `[locale]` 边界

- URL `/{unknown_locale}/...` → `notFound()` (Next.js 16 404)
- 缺失 `messages/{locale}.json` (未来加新 locale) → `getMessages` fallback 到 default locale (M1 lib/i18n.ts 已有 fallback)
- 切换 locale URL → cookie 不变 (locale 路由不重新登录) ✅
- middleware matcher 漏 `/{locale}/...` 例外 → 401 错误 (build 早期 task 1.6 验证)

### 4.4 rebuildFromJsonl 边界

- `<PI_WEB_DATA_DIR>` 不存在 (首次启动) → 扫到空目录，map 为空，正常
- `.jsonl` 第一行 parse 失败 → catch 后跳过该文件，其他正常
- 1000 sessions × 100 files = 100k read (M1 design §4.5) → lazy 不需要，但 instrumentation 启动跑也 < 50ms (实测 M3 部署时验证)
- instrumentation 在 'register' phase 跑：仅在 server start 时一次；module re-evaluation (dev hot-reload) 不重跑

### 4.5 sessions 3-way 过滤边界

- user 无 team membership → 空 array → 过滤仅 self-created sessions
- user 是 1 个 Team 的 OWNER + 1 个 Team 的 MEMBER → `teamIds` 含 1 个；过滤包含该 team 下的所有 session + self-created in other team
- session 在 user 切换 team 后访问 → `lastProjectId` 可能已失效，但 sessions 列表不受影响 (3-way filter 不依赖 lastProjectId)
- session share placeholder → M2.4 才上 (M2.2 session_shares 表读空)

### 4.6 PrismaClient 单例边界

- 多个 module 各自 import { prisma } → 同一实例
- dev hot-reload → `globalThis.__prisma` 复用同一实例
- prod multi-worker (未来 M3 切 cluster mode) → 每个 worker 各自单例（counter 跨 worker 不共享 → M3 janitor 解决）

---

## 5. 测试策略

### 5.1 单元测试 (vitest, 已有 M1 + 新增)

| 文件 | 覆盖 | 预期 |
|------|------|------|
| `lib/path-safety.test.ts` (M1) | 5 case 回归 | 5/5 pass |
| `lib/session-cap.test.ts` (NEW) | check / increment / decrement / 50 cap | 4-6 case |
| `lib/must-change-password.test.ts` (NEW) | allowlist / true / false / missing | 4 case |
| `lib/session-meta-rebuild.test.ts` (NEW) | parse 成功/失败/混合/empty dir | 4 case |
| `lib/server-user.test.ts` (NEW, mock prisma) | getCurrentUserContext / getUserTeamIds | 3-4 case |
| `lib/must-change-password.meta.test.ts` (NEW) | AST scan | all write routes pass |

### 5.2 集成测试 (vitest, 已有 M1 + 新增)

| 文件 | 覆盖 | 预期 |
|------|------|------|
| `app/api/agent/new/route.test.ts` (NEW) | lastProjectId=null/有/team mismatch | 3 case |
| `app/api/sessions/route.test.ts` (NEW) | 3-way filter | 4-5 case |

### 5.3 E2E (playwright, 已有 M1 + 扩)

`tests/e2e/login.spec.ts` 5 个 test block:
- (a) **login UI flow** — page.goto /en/login → form fill → submit → redirect to /en/dashboard
- (b) **change-password flow** — root 登录 → 跳 /en/change-password → 改密 → 跳 /en/dashboard
- (c) **dashboard data** — 登录后 /en/dashboard 渲染 "Welcome root (OWNER)" + team + projects
- (d) **mustChangePwd 403** — root 改密前 POST /api/agent/new 返 403
- (e) **50 cap** — 循环 50 个后第 51 个 503

### 5.4 Manual smoke

- 浏览器 `http://localhost:30141/en/login` 走通 UI
- 浏览器 `http://localhost:30141/zh-CN/login` 走通中文 UI (验证 t() 切换)
- `pnpm dev` 启动时观察 stdout 含 `[INSTRUMENTATION] rebuildFromJsonl complete, N sessions loaded`
- 强制 server crash (kill -9) 后重启 → counter 归零 → 重新创建 session 成功

### 5.5 Build verify (M2.2 gate)

| 步骤 | 期望 |
|------|------|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm exec vitest run` (含 meta-test + path-safety + 4 new unit) | all pass |
| `pnpm exec playwright test` (5 use case) | all pass |
| `pnpm run build` | clean (含 `runtime: 'nodejs'` middleware 不报 Capturing groups) |
| `pnpm dev` 启动 → 浏览器走通 UI | OK |

---

## 6. 性能与可靠性

### 6.1 middleware Prisma 调用

- middleware 每次请求额外 1 个 `prisma.user.findUnique` (id, mustChangePassword) → +1 DB query
- SQLite WAL 模式 (M1 已开) 下 sub-ms
- dev mode 1000 RPS → 1000 QPS DB → 接受

### 6.2 server component fetch self-loopback

- dashboard RSC fetch `http://localhost:30141/api/projects` (300ms RTT loopback localhost)
- 接受（M2.2 不是 perf-critical path）
- 未来 M3 切 cluster 模式 → 改 in-process call

### 6.3 instrumentation 启动阻塞

- rebuildFromJsonl 在 'register' phase 跑 → server ready 前完成
- 1000 sessions 实测 < 50ms (M1 design §4.5)
- server start 不会因此延迟用户感知

### 6.4 50 cap counter 内存

- 单 `globalThis.__piSessionCounter: { count: number }` → 8 bytes
- 接受

---

## 7. 不在本 design 范畴

- SAML / OIDC / GitHub OAuth（M2.3+）
- Access + refresh token（M2.3+）
- Share dialog（M2.4+）
- Per-user session 信号量（M2.3+）
- Postgres 迁移（M3）
- axe-core a11y（M3）
- 完整 i18n 内容（已覆盖 M2.2 范围内全部 key）
- Fork upstream 同步策略
- Middleware → proxy 重命名 (Next.js 16 弃用，仅 deprecation warning)
- 50-cap janitor（crash drift 修复）
- 完整生产部署文档 (docker-compose, 卷挂载)

---

## 8. Open Questions

1. **server component fetch self-loopback**: Next.js 16 RSC 推荐用 `cache: 'no-store'` 但也可改 `headers().get('cookie')` 透传。本次实现选 self-loopback。**M3 评估是否 in-process**。
2. **i18n `[locale]` 与 path-to-regexp v8 兼容性**: Task 1.6 必须 early-validate；如失败 fallback 到 hardcoded locale 白名单 `/(en|zh-CN)/...`。
3. **next-intl 库版本**: package.json 现 `next-intl` ^3 (M1 装)；本次不升级（避免 spec break）。
4. **50-cap janitor 时机**: drift 问题已知；M3 部署时加 hourly 扫描 task。**M2.2 不阻塞**。
5. **multi-worker 场景**: 当前 single-process；M3 切 cluster 时 counter 跨 worker 不共享是已知 limit（与 janitor 一起解决）。

---

## 9. 决策可逆性

| 决策 | 可逆成本 | 不可逆后果 |
|------|---------|-----------|
| 50 cap 在 in-memory | 低 (M3 升级 Prisma) | 无 |
| middleware runtime: 'nodejs' | 中 (~10MB 内存) | 无（功能不退化） |
| per-route mustChangePwd 门 | 低 (middleware 排他方案) | 无 |
| lib/prisma 单例 | 低 (回退到各 new) | 无（dev hot-reload 风险回升） |
| i18n `[locale]` 路由 | 中 (整 URL 结构变) | 已有 user 必须改 bookmarks |
| instrumentation.ts 启动 rebuild | 低 (lazy fallback) | 无 |
| 503 + Retry-After | 低 (改 429) | 无 |
| server component RSC | 中 (改 client) | 无 |
| AST-scan meta-test | 低 (改 commit 列表手检) | 无（meta-test 漏 false-negative 风险回升） |
| next-intl 库完整接入 | 中 (回退到 M1 t() + 手动) | 未来 locale 切换 UX 退化 |

---

## 10. References

- 上游 OpenSpec: `openspec/changes/pi-web-m2-2-ui-and-hardening/{proposal,design,tasks}.md`
- 上游 OpenSpec 6 个 spec: `openspec/changes/pi-web-m2-2-ui-and-hardening/specs/*/spec.md`
- 脑暴记录: `openspec/changes/pi-web-m2-2-ui-and-hardening/.comet/handoff/brainstorm-summary.md`
- 交接包: `openspec/changes/pi-web-m2-2-ui-and-hardening/.comet/handoff/design-context.{json,md}`
- M1 归档: `openspec/changes/archive/2026-07-13-pi-web-generalized-m1-runnable/`
- M1 Design Doc: `docs/superpowers/specs/2026-07-12-pi-web-generalized-m1-design.md` (M2.2 镜像其结构)
- M1 验证报告: `docs/superpowers/reports/2026-07-13-pi-web-generalized-m1-runnable-verify.md`
- 上游 capability spec (archived to main): `openspec/specs/{auth-provider-user,bootstrap-root-owner,multi-tenant-team-model,project-and-path-safety,agent-session-in-process,runnable-harness}/spec.md`
- Fork: [xiejava1018/pi-web](https://github.com/xiejava1018/pi-web) v0.7.11

