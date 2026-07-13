---
change: pi-web-m2-2-ui-and-hardening
design-doc: docs/superpowers/specs/2026-07-13-pi-web-m2-2-ui-and-hardening-design.md
base-ref: 934f21aab2b6c2a4513398689bcd76592cee7da5
archived-with: 2026-07-13-pi-web-m2-2-ui-and-hardening
---

# M2.2 pi-web UI + 硬化 + 50 session cap 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 M1 之上叠加三件事：(a) 补齐浏览器 UI 入口（login / change-password / dashboard，i18n `[locale]` 路由 + next-intl 文案）、(b) 修复 M1 verify 报告中 defer 的 5 项 WARNING（mustChangePassword 门 / agent/new body.cwd / sessions 3-way 过滤 / rebuildFromJsonl 真正实现 / Dockerfile 补 prisma migrate deploy）、(c) 新增 50 session 全局硬上限守卫。

**Architecture:** fork 仓库 `/Users/xiejava/AIproject/pi-web/` 在 M1 之上增量构建，保持 fork 单分支快速推进；新增 `lib/{prisma,server-user,must-change-password,session-cap}.ts` 4 个 helper；新增 `app/[locale]/{layout,login/page,change-password/page,dashboard/page}` UI；新增 `instrumentation.ts` Next.js 16 'register' phase 触发 `rebuildFromJsonl`；修改 `middleware.ts` 加 `runtime: 'nodejs'` + `x-must-change-password` 注入；写 meta-test AST 扫描防门遗漏。

**Tech Stack:** Next.js 16 App Router、Prisma + SQLite（dev）/ migrate deploy（prod）、jose JWT、bcrypt、next-intl ^3、vitest、playwright、path-to-regexp v8（关键 risk gate）。

---

## 0. 前置准备

### 0.1 切到 worktree（build 阶段隔离）

**Files:**
- Worktree: `/Users/xiejava/AIproject/AI-agent-workshop-worktrees/pi-web-m2-2-ui-and-hardening/`

**Step 1: 加载 worktree skill 并创建 worktree**

REQUIRED SUB-SKILL: `superpowers:using-git-worktrees`

```bash
cd /Users/xiejava/AIproject/AI-agent-workshop
git worktree add -b feat/pi-web-m2-2-ui-and-hardening \
  /Users/xiejava/AIproject/AI-agent-workshop-worktrees/pi-web-m2-2-ui-and-hardening \
  934f21aab2b6c2a4513398689bcd76592cee7da5
```

**Step 2: 在 worktree 内确认 base state**

```bash
cd /Users/xiejava/AIproject/AI-agent-workshop-worktrees/pi-web-m2-2-ui-and-hardening
git log -1 --oneline
ls openspec/changes/archive/2026-07-13-pi-web-generalized-m1-runnable/
```

Expected: HEAD = `934f21a…`，归档目录存在。

**Step 3: 复制并验证 M1 现有产物**

```bash
pnpm install
pnpm exec tsc --noEmit
pnpm exec vitest run lib/path-safety.test.ts
```

Expected: tsc exit 0；path-safety 5/5 pass。

---

## 任务 1: 基础设施（i18n + Prisma 单例 + 写 API 门）

### Task 1.1: 创建 `lib/prisma.ts` 单例

**Files:**
- Create: `lib/prisma.ts`

**Step 1: 写文件**

参考 design doc §3.1：

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

**Step 2: 验证单例语义**

```bash
cd /Users/xiejava/AIproject/AI-agent-workshop-worktrees/pi-web-m2-2-ui-and-hardening
node -e "
const { prisma } = await import('./lib/prisma.ts');
const p2 = (await import('./lib/prisma.ts')).prisma;
console.log('same instance:', prisma === p2);
"
```

Expected: `same instance: true`

**Step 3: 提交**

```bash
git add lib/prisma.ts
git commit -m "feat(prisma): add singleton wrapper for dev hot-reload reuse"
```

---

### Task 1.2: 重构 M1 中所有 `new PrismaClient()` 为单例 import

**Files:**
- Modify: `lib/auth-provider-local.ts:6`
- Modify: `lib/user-role.ts:3`
- Modify: `app/api/auth/user-login/route.ts:3`
- Modify: `app/api/auth/change-password/route.ts:3`
- Modify: `app/api/projects/route.ts:4`
- Modify: `app/api/projects/[id]/bind/route.ts:7`
- Skip: `app/api/auth/user-logout/route.ts`（无 prisma）

**Step 1: 改 `lib/auth-provider-local.ts`**

```diff
-import { PrismaClient } from "@prisma/client";
-const prisma = new PrismaClient();
+import { prisma } from "@/lib/prisma";
```

**Step 2: 改 `lib/user-role.ts`**

```diff
-import { PrismaClient } from "@prisma/client";
-const prisma = new PrismaClient();
+import { prisma } from "@/lib/prisma";
```

**Step 3: 改 4 个 API route 顶部**

```diff
-import { PrismaClient } from "@prisma/client";
-const prisma = new PrismaClient();
+import { prisma } from "@/lib/prisma";
```

应用到：
- `app/api/auth/user-login/route.ts`
- `app/api/auth/change-password/route.ts`
- `app/api/projects/route.ts`
- `app/api/projects/[id]/bind/route.ts`

**Step 4: 编译检查**

```bash
pnpm exec tsc --noEmit
```

Expected: exit 0

**Step 5: 跑 M1 回归**

```bash
pnpm exec vitest run lib/auth-provider-local.test.ts
```

Expected: all pass（M1 测试不应因重构失败）

**Step 6: 提交**

```bash
git add lib/auth-provider-local.ts lib/user-role.ts \
        app/api/auth/user-login/route.ts app/api/auth/change-password/route.ts \
        app/api/projects/route.ts app/api/projects/[id]/bind/route.ts
git commit -m "refactor(prisma): replace ad-hoc PrismaClient instances with singleton import"
```

---

### Task 1.3: 创建 `lib/must-change-password.ts`

**Files:**
- Create: `lib/must-change-password.ts`
- Create: `lib/must-change-password.test.ts`

**Step 1: 写失败的测试**

```ts
// lib/must-change-password.test.ts
import { describe, it, expect, vi } from "vitest";
import { enforceNotMustChange } from "./must-change-password";

function mockReq(pathname: string, flag: string | null) {
  return {
    nextUrl: { pathname },
    headers: { get: (k: string) => (k === "x-must-change-password" ? flag : null) },
  } as any;
}

describe("enforceNotMustChange", () => {
  it("returns null on allowlisted change-password route", () => {
    expect(enforceNotMustChange(mockReq("/api/auth/change-password", "true"))).toBeNull();
  });

  it("returns 403 when flag is true on non-allowlisted path", () => {
    const r = enforceNotMustChange(mockReq("/api/agent/new", "true"));
    expect(r).not.toBeNull();
    expect(r!.status).toBe(403);
  });

  it("returns null when flag is false", () => {
    expect(enforceNotMustChange(mockReq("/api/agent/new", "false"))).toBeNull();
  });

  it("returns null when flag is missing (dev curl case)", () => {
    expect(enforceNotMustChange(mockReq("/api/agent/new", null))).toBeNull();
  });
});
```

**Step 2: 跑测试验失败**

```bash
pnpm exec vitest run lib/must-change-password.test.ts
```

Expected: FAIL with "Cannot find module './must-change-password'"

**Step 3: 写实现**（参考 design doc §3.3）

```ts
// lib/must-change-password.ts
import { NextRequest, NextResponse } from "next/server";

const ALLOWLIST = new Set(["/api/auth/change-password"]);

export function enforceNotMustChange(req: NextRequest): NextResponse | null {
  if (ALLOWLIST.has(req.nextUrl.pathname)) return null;

  const flag = req.headers.get("x-must-change-password");
  if (flag === "true") {
    return NextResponse.json(
      { error: "password change required" },
      { status: 403 }
    );
  }
  return null;
}
```

**Step 4: 跑测试验通过**

```bash
pnpm exec vitest run lib/must-change-password.test.ts
```

Expected: 4 pass

**Step 5: 提交**

```bash
git add lib/must-change-password.ts lib/must-change-password.test.ts
git commit -m "feat(auth): add enforceNotMustChange per-route gate helper"
```

---

### Task 1.4: 创建 `lib/server-user.ts`

**Files:**
- Create: `lib/server-user.ts`
- Create: `lib/server-user.test.ts`

**Step 1: 写失败的测试（mock prisma）**

```ts
// lib/server-user.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    teamMember: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { getCurrentUserContext, getUserTeamIds, getUserHighestRole } from "./server-user";

describe("getCurrentUserContext", () => {
  it("returns null when user not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    expect(await getCurrentUserContext("u1")).toBeNull();
  });

  it("returns user + role OWNER + teamIds", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
      username: "root",
      mustChangePassword: false,
    } as any);
    vi.mocked(prisma.teamMember.findMany).mockResolvedValue([
      { userId: "u1", teamId: "t1", role: "OWNER" },
      { userId: "u1", teamId: "t2", role: "MEMBER" },
    ] as any);

    const ctx = await getCurrentUserContext("u1");
    expect(ctx?.user.username).toBe("root");
    expect(ctx?.role).toBe("OWNER");
    expect(ctx?.teamIds.sort()).toEqual(["t1", "t2"]);
  });
});

describe("getUserHighestRole", () => {
  it("prefers OWNER > ADMIN > MEMBER > null", async () => {
    vi.mocked(prisma.teamMember.findMany).mockResolvedValue([
      { userId: "u1", teamId: "t1", role: "ADMIN" },
      { userId: "u1", teamId: "t2", role: "MEMBER" },
    ] as any);
    expect(await getUserHighestRole("u1")).toBe("ADMIN");
  });

  it("returns null when no memberships", async () => {
    vi.mocked(prisma.teamMember.findMany).mockResolvedValue([] as any);
    expect(await getUserHighestRole("u1")).toBeNull();
  });
});

describe("getUserTeamIds", () => {
  it("returns array of team ids", async () => {
    vi.mocked(prisma.teamMember.findMany).mockResolvedValue([
      { userId: "u1", teamId: "t1", role: "MEMBER" },
      { userId: "u1", teamId: "t2", role: "ADMIN" },
    ] as any);
    expect((await getUserTeamIds("u1")).sort()).toEqual(["t1", "t2"]);
  });
});
```

**Step 2: 跑测试验失败**

```bash
pnpm exec vitest run lib/server-user.test.ts
```

Expected: FAIL "Cannot find module './server-user'"

**Step 3: 写实现**（参考 design doc §3.4）

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
  if (tms.some((t) => t.role === "OWNER")) return "OWNER";
  if (tms.some((t) => t.role === "ADMIN")) return "ADMIN";
  if (tms.some((t) => t.role === "MEMBER")) return "MEMBER";
  return null;
}

export async function getUserTeamIds(userId: string): Promise<string[]> {
  const tms = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true },
  });
  return tms.map((t) => t.teamId);
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

**Step 4: 跑测试验通过**

```bash
pnpm exec vitest run lib/server-user.test.ts
```

Expected: 5/5 pass

**Step 5: 提交**

```bash
git add lib/server-user.ts lib/server-user.test.ts
git commit -m "feat(user): add server-side user context helpers"
```

---

### Task 1.5: 修改 `middleware.ts`（runtime + mustChangePwd 注入）

**Files:**
- Modify: `middleware.ts`

**Step 1: 阅读当前 middleware.ts**

`cat middleware.ts` — 确认 M1 当前 matcher / JWT 验证逻辑。

**Step 2: 按 design doc §3.2 完整替换**

```ts
// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

const SECRET = process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod";

export const config = {
  runtime: "nodejs",
  matcher: [
    "/((?!_next/|favicon|api/auth/(?:user-login|user-logout|change-password|providers|login|logout|all-providers|api-key)|(?:en|zh-CN)/(?:login|change-password|dashboard)).*)",
    "/api/((?!auth/(?:user-login|user-logout|change-password|providers|login|logout|all-providers|api-key)).*)",
  ],
};

export async function middleware(req: NextRequest) {
  // 1. UI 页面短路
  const localeMatch = req.nextUrl.pathname.match(/^\/(en|zh-CN)\//);
  if (localeMatch) return NextResponse.next();

  // 2. JWT 验证
  const cookie = req.cookies.get("pw_at")?.value;
  if (!cookie) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }
  try {
    const { payload } = await jwtVerify(cookie, new TextEncoder().encode(SECRET));
    const userId = String(payload.sub);

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

**Step 3: 类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: exit 0

**Step 4: 提交**

```bash
git add middleware.ts
git commit -m "feat(middleware): add runtime nodejs + inject x-must-change-password"
```

---

### Task 1.6: 验证 matcher 不报 "Capturing groups" (CRITICAL RISK GATE)

**Files:** 无新增文件 — 仅验证

> **🛑 CRITICAL RISK GATE**: i18n matcher 含 `(?:en|zh-CN)` 非捕获组 + `[^/]` 字符类；M1 已踩过 path-to-regexp v8 "Capturing groups" 坑。如失败立即 fallback 到 hardcoded locale 白名单。

**Step 1: 编译期校验**

```bash
pnpm exec tsc --noEmit
```

Expected: exit 0（编译期 path-to-regexp v8 不在这里检查）

**Step 2: dev 启动 → 观察 Next.js 16 启动日志**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
sleep 6
grep -E "Capturing groups|Invalid middleware|middleware" /tmp/dev.log | head -20
kill %1
```

Expected: **NO "Capturing groups" error**.

**Step 3: 实测匹配 — 拉 UI 页面看是否不挡**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
sleep 6
curl -sS -o /dev/null -w "%{http_code}" http://localhost:30141/en/login
# 期望 200 (UI 页面被短路放行)
echo
curl -sS -o /dev/null -w "%{http_code}" http://localhost:30141/api/auth/user-login
# 期望 405 或 4xx for GET (POST 端点不被 middleware 挡)
echo
kill %1
```

Expected: `200` for `/en/login`；`405`/`4xx` for GET on `/api/auth/user-login`（这 endpoint 仅 POST，但关键是不返 `401 auth required` 即可）。

**Step 4a: 如遇 "Capturing groups"**

**STOP** — 不要继续往下做。立即改 matcher 为 hardcoded fallback：

```ts
// Fallback: 用两个显式路径替代非捕获组
matcher: [
  "/((?!_next/|favicon|api/auth/user-login|api/auth/user-logout|api/auth/change-password|api/auth/providers|api/auth/login|api/auth/logout|api/auth/all-providers|api/auth/api-key|en/login|en/change-password|en/dashboard|zh-CN/login|zh-CN/change-password|zh-CN/dashboard).*)",
  "/api/((?!auth/(?:user-login|user-logout|change-password|providers|login|logout|all-providers|api-key)).*)",
],
```

并在 plan 标注 `/Users/xiejava/AIproject/AI-agent-workshop/docs/superpowers/plans/2026-07-13-pi-web-m2-2-ui-and-hardening.md` "Known deviations" 一节。

**Step 4b: 如通过则继续**

无需提交（middleware 已在 1.5 提交）；记录 `pnpm dev` 输出到 `docs/superpowers/reports/2026-07-13-m2-2-task-1.6-verify.md`。

---

## 任务 2: i18n `[locale]` 路由 + 文案

### Task 2.1: 创建 `app/[locale]/layout.tsx`

**Files:**
- Create: `app/[locale]/layout.tsx`

**Step 1: 写 layout**（参考 design doc §3.7）

```tsx
// app/[locale]/layout.tsx
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@/lib/i18n";
import { notFound } from "next/navigation";

const SUPPORTED = ["en", "zh-CN"] as const;
type Locale = (typeof SUPPORTED)[number];

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!SUPPORTED.includes(locale as Locale)) notFound();
  const messages = getMessages(locale as Locale);
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

**Step 2: 类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: exit 0

**Step 3: 提交**

```bash
git add app/[locale]/layout.tsx
git commit -m "feat(i18n): add [locale] layout with NextIntlClientProvider"
```

---

### Task 2.2: 扩 `lib/i18n.ts`（locale 解析）

**Files:**
- Modify: `lib/i18n.ts`

**Step 1: 阅读 `lib/i18n.ts` 现状（M1 已有 `getMessages(locale)` fallback 逻辑）**

`cat lib/i18n.ts`

**Step 2: 扩：加 `resolveLocale(pathname)` + 在未指定 locale 时回退 DEFAULT**

```ts
// lib/i18n.ts (扩展)
const DEFAULT_LOCALE = "en";
const SUPPORTED = ["en", "zh-CN"] as const;

export function resolveLocale(pathname: string): "en" | "zh-CN" {
  const m = pathname.match(/^\/(en|zh-CN)(?:\/|$)/);
  return (m?.[1] as "en" | "zh-CN") ?? DEFAULT_LOCALE;
}

export function getMessages(locale: string): Record<string, any> {
  if (locale === "zh-CN") return require("@/messages/zh.json");
  return require("@/messages/en.json");
}
```

确保与 M1 已有导出兼容（如 M1 已导出 `getMessages` 则保留签名，向下扩展）。

**Step 3: 单元测试**

```ts
// lib/i18n.test.ts
import { describe, it, expect } from "vitest";
import { resolveLocale } from "./i18n";

describe("resolveLocale", () => {
  it("extracts en from /en/login", () => {
    expect(resolveLocale("/en/login")).toBe("en");
  });
  it("extracts zh-CN from /zh-CN/dashboard", () => {
    expect(resolveLocale("/zh-CN/dashboard")).toBe("zh-CN");
  });
  it("defaults to en when no prefix", () => {
    expect(resolveLocale("/foo")).toBe("en");
  });
});
```

**Step 4: 跑测试**

```bash
pnpm exec vitest run lib/i18n.test.ts
```

Expected: 3/3 pass

**Step 5: 提交**

```bash
git add lib/i18n.ts lib/i18n.test.ts
git commit -m "feat(i18n): add resolveLocale helper for URL-based locale detection"
```

---

### Task 2.3: 扩 `messages/en.json`

**Files:**
- Modify: `messages/en.json`

**Step 1: 阅读现状 + 加 keys**

```json
{
  "login": {
    "title": "Sign in",
    "username": "Username",
    "password": "Password",
    "submit": "Sign in",
    "error": "Invalid username or password"
  },
  "changePassword": {
    "title": "Change password",
    "newPassword": "New password (≥ 8 chars)",
    "submit": "Update password",
    "tooShort": "Password must be at least 8 characters",
    "error": "Failed to change password"
  },
  "dashboard": {
    "title": "Dashboard",
    "welcome": "Welcome {username} ({role})",
    "mustChangePassword": "Must change password",
    "projects": "Projects",
    "mustLogin": "Please sign in to view dashboard",
    "userNotFound": "User not found",
    "noProjects": "No projects in your team yet"
  },
  "common": {
    "loading": "Loading…",
    "back": "Back"
  }
}
```

合并入 M1 已有 keys（M1 已有部分 key, 如 `common.loading`; 不冲突）。

**Step 2: JSON 校验**

```bash
node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf-8'));console.log('ok')"
```

Expected: `ok`

**Step 3: 提交**

```bash
git add messages/en.json
git commit -m "feat(i18n): add en.json keys for login/change-password/dashboard"
```

---

### Task 2.4: 扩 `messages/zh.json`

**Files:**
- Modify: `messages/zh.json`

**Step 1: 写中文值**

```json
{
  "login": {
    "title": "登录",
    "username": "用户名",
    "password": "密码",
    "submit": "登录",
    "error": "用户名或密码错误"
  },
  "changePassword": {
    "title": "修改密码",
    "newPassword": "新密码（≥ 8 字符）",
    "submit": "更新密码",
    "tooShort": "密码至少 8 个字符",
    "error": "修改密码失败"
  },
  "dashboard": {
    "title": "仪表盘",
    "welcome": "欢迎 {username}（{role}）",
    "mustChangePassword": "需要修改密码",
    "projects": "项目列表",
    "mustLogin": "请先登录",
    "userNotFound": "用户不存在",
    "noProjects": "您的团队尚无项目"
  },
  "common": {
    "loading": "加载中…",
    "back": "返回"
  }
}
```

**Step 2: JSON 校验**

```bash
node -e "JSON.parse(require('fs').readFileSync('messages/zh.json','utf-8'));console.log('ok')"
```

Expected: `ok`

**Step 3: 提交**

```bash
git add messages/zh.json
git commit -m "feat(i18n): add zh.json keys for login/change-password/dashboard"
```

---

### Task 2.5: 修改 middleware matcher 加 i18n UI 路由白名单

> **本任务可能已在 Task 1.5 / 1.6 完成**（design §3.2 matcher 已含 `(?:en|zh-CN)/(?:login|change-password|dashboard)`）。

**Files:**
- Modify: `middleware.ts`（如 1.5 未含）

**Step 1: 检查 middleware.ts matcher**

```bash
grep -E "en\|zh-CN" middleware.ts
```

如已含 `(?:en|zh-CN)/(?:login|change-password|dashboard)` → 跳过此任务，标 done。

如未含 → 见 Task 1.5 Step 2 matcher 块。

**Step 2: 实测放行**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
sleep 6
curl -sS -o /dev/null -w "%{http_code}" http://localhost:30141/en/login
echo
kill %1
```

Expected: `200`

---

## 任务 3: Login / ChangePassword / Dashboard UI 页面

### Task 3.1: 创建 `app/[locale]/login/page.tsx` (client form)

**Files:**
- Create: `app/[locale]/login/page.tsx`

**Step 1: 写页面**（参考 design §3.7）

```tsx
// app/[locale]/login/page.tsx
"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // ... use(params) → locale
  // ... 表单 + fetch + router.push(/{locale}/dashboard or /{locale}/change-password)
}
```

参考 design doc §3.7：

```tsx
"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { use } from "react";
import { useState } from "react";

export default function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
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
    router.push(body.mustChangePassword ? `/${locale}/change-password` : `/${locale}/dashboard`);
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>{t("title")}</h1>
      <input name="username" placeholder={t("username")} required />
      <input name="password" type="password" placeholder={t("password")} required />
      {error && <p className="error">{error}</p>}
      <button type="submit">{t("submit")}</button>
    </form>
  );
}
```

**Step 2: 类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: exit 0

**Step 3: 浏览器手动测试**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
sleep 6
# 浏览器访问 http://localhost:30141/en/login
# 期望看到 username + password 表单
kill %1
```

**Step 4: 提交**

```bash
git add app/[locale]/login/page.tsx
git commit -m "feat(ui): add [locale]/login client form with t() and mustChangePassword routing"
```

---

### Task 3.2: 创建 `app/[locale]/change-password/page.tsx` (client form)

**Files:**
- Create: `app/[locale]/change-password/page.tsx`

**Step 1: 写页面**

```tsx
// app/[locale]/change-password/page.tsx
"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { use, useState } from "react";

export default function ChangePasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  const t = useTranslations("changePassword");
  const router = useRouter();
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const newPassword = String(fd.get("newPassword") ?? "");
    if (newPassword.length < 8) { setError(t("tooShort")); return; }

    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
    if (!res.ok) { setError(t("error")); return; }
    router.push(`/${locale}/dashboard`);
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>{t("title")}</h1>
      <input name="newPassword" type="password" placeholder={t("newPassword")} required />
      {error && <p className="error">{error}</p>}
      <button type="submit">{t("submit")}</button>
    </form>
  );
}
```

**Step 2: 类型检查 + 提交**

```bash
pnpm exec tsc --noEmit
git add app/[locale]/change-password/page.tsx
git commit -m "feat(ui): add [locale]/change-password client form"
```

---

### Task 3.3: 创建 `app/[locale]/dashboard/page.tsx` (RSC)

**Files:**
- Create: `app/[locale]/dashboard/page.tsx`

**Step 1: 写 server component**（参考 design §3.7）

```tsx
// app/[locale]/dashboard/page.tsx
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

  const cookieStore = await cookies();
  const token = cookieStore.get("pw_at")?.value;
  if (!token) return <p>{t("mustLogin")}</p>;

  const { payload } = await jwtVerify(
    token,
    new TextEncoder().encode(process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod")
  );
  const userId = String(payload.sub);

  const ctx = await getCurrentUserContext(userId);
  if (!ctx) return <p>{t("userNotFound")}</p>;

  const projects = await prisma.project.findMany({
    where: { teamId: { in: ctx.teamIds } },
  });

  return (
    <div>
      <h1>{t("title")}</h1>
      <p>{t("welcome", { username: ctx.user.username, role: ctx.role ?? "—" })}</p>
      <p>{t("mustChangePassword")}: {String(ctx.mustChangePassword)}</p>
      <h2>{t("projects")}</h2>
      {projects.length === 0
        ? <p>{t("noProjects")}</p>
        : <ul>{projects.map(p => <li key={p.id}>{p.name} ({p.rootPath})</li>)}</ul>}
    </div>
  );
}
```

**Step 2: 类型检查**

```bash
pnpm exec tsc --noEmit
```

Expected: exit 0

**Step 3: 浏览器手动验证**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
sleep 6
# 浏览器: 登录 → 改密 → 进 /en/dashboard
# 期望看到: Welcome root (OWNER), mustChangePassword: false, projects 列表
kill %1
```

**Step 4: 提交**

```bash
git add app/[locale]/dashboard/page.tsx
git commit -m "feat(ui): add [locale]/dashboard RSC with user/team/projects render"
```

---

## 任务 4: M1 deferred WARNINGs 修复

### Task 4.1: 6 个写路由加 `enforceNotMustChange` 门

**Files:**
- Modify: `app/api/agent/new/route.ts`
- Modify: `app/api/projects/route.ts` (POST)
- Modify: `app/api/projects/[id]/bind/route.ts`
- Modify: `app/api/agent/[id]/events/route.ts`
- Modify: `app/api/agent/[id]/route.ts` (POST)
- Modify: `app/api/agent/[id]/route.ts` (GET — 不在白名单同样加固)

**Step 1: 在每个写路由顶部加 4 行**

```diff
 import type { NextRequest } from "next/server";
+import { enforceNotMustChange } from "@/lib/must-change-password";

 export async function POST(req: NextRequest) {
+  const gate = enforceNotMustChange(req);
+  if (gate) return gate;
   // ... 既有逻辑
 }
```

> 注意：`app/api/agent/[id]` (POST/GET) middleware 已挡但 design doc §4.6 说"GET 也要门" — **实际 GET 是读路由不需要门**，只 POST 路由加。

更精确清单（仅写）：
- `app/api/agent/new` POST
- `app/api/projects` POST
- `app/api/projects/[id]/bind` POST
- `app/api/agent/[id]/events` POST/PUT/DELETE
- `app/api/agent/[id]` POST

跳过：
- `app/api/agent/[id]` GET (读路由)
- `app/api/auth/user-login` (entry, 在 matcher 白名单)
- `app/api/auth/user-logout` (idempotent)
- `app/api/auth/change-password` (门自身白名单)

**Step 2: 类型检查**

```bash
pnpm exec tsc --noEmit
```

**Step 3: 提交**

```bash
git add app/api/agent/new/route.ts app/api/projects/route.ts \
        app/api/projects/[id]/bind/route.ts \
        app/api/agent/[id]/events/route.ts app/api/agent/[id]/route.ts
git commit -m "feat(auth): gate 5 write routes with enforceNotMustChange"
```

---

### Task 4.2: 修改 `app/api/agent/new/route.ts` 用 `lastProjectId`

**Files:**
- Modify: `app/api/agent/new/route.ts`

**Step 1: 阅读当前 handler**

```bash
grep -nE "cwd|body\." app/api/agent/new/route.ts | head -30
```

**Step 2: 替换 body.cwd 读取逻辑**

```diff
- const { cwd } = await req.json();
- const project = await prisma.project.findFirst({ where: { rootPath: cwd } });
+ // 使用用户最近项目
+ const user = await prisma.user.findUnique({
+   where: { id: userId },
+   select: { lastProjectId: true },
+ });
+ if (!user?.lastProjectId) {
+   return NextResponse.json({ error: "no project selected" }, { status: 400 });
+ }
+ const project = await prisma.project.findUnique({ where: { id: user.lastProjectId } });
+ if (!project) {
+   return NextResponse.json({ error: "project not found" }, { status: 404 });
+ }
+ // 校验 membership
+ const member = await prisma.teamMember.findFirst({
+   where: { userId, teamId: project.teamId },
+ });
+ if (!member) {
+   return NextResponse.json({ error: "forbidden" }, { status: 403 });
+ }
```

并删 `cwd` 类型/AST 引用。

**Step 3: 集成测试**

```ts
// app/api/agent/new/route.test.ts (新)
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    teamMember: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/must-change-password", () => ({
  enforceNotMustChange: () => null,
}));

import { POST } from "./route";

describe("POST /api/agent/new", () => {
  it("returns 400 when user has no lastProjectId", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ lastProjectId: null } as any);
    const req = new Request("http://test/api/agent/new", { method: "POST", body: "{}" });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it("returns 403 when user not member of project team", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ lastProjectId: "p1" } as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({ id: "p1", teamId: "t1" } as any);
    vi.mocked(prisma.teamMember.findFirst).mockResolvedValueOnce(null);
    const req = new Request("http://test/api/agent/new", { method: "POST", body: "{}" });
    const res = await POST(req as any);
    expect(res.status).toBe(403);
  });
});
```

**Step 4: 跑测试**

```bash
pnpm exec vitest run app/api/agent/new/route.test.ts
```

Expected: 2 pass

**Step 5: 提交**

```bash
git add app/api/agent/new/route.ts app/api/agent/new/route.test.ts
git commit -m "fix(agent): drop cwd from body, use user.lastProjectId + membership check"
```

---

### Task 4.3: 修改 `app/api/sessions/route.ts`（3-way 过滤）

**Files:**
- Modify: `app/api/sessions/route.ts`
- Create: `app/api/sessions/route.test.ts`

**Step 1: 阅读当前 handler**

`cat app/api/sessions/route.ts`

**Step 2: 替换查询逻辑**（参考 design §2.6）

```ts
// app/api/sessions/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });

  // 1. 用户的 teamIds
  const memberships = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true },
  });
  const teamIds = memberships.map((m) => m.teamId);

  // 2. 用户是 OWNER/ADMIN 的 team 下的 project ids
  const adminRoles = memberships.filter((m) => m.role === "OWNER" || m.role === "ADMIN");
  const adminTeamIds = adminRoles.map((m) => m.teamId);
  const adminProjects = await prisma.project.findMany({
    where: { teamId: { in: adminTeamIds } },
    select: { id: true },
  });
  const adminProjectIds = adminProjects.map((p) => p.id);

  // 3. M2.4 share placeholder（读 session_shares 留接口）
  const sharedSessions = await prisma.sessionShare.findMany({
    where: { sharedWithUserId: userId },
    select: { sessionId: true },
  });
  const sharedSessionIds = sharedSessions.map((s) => s.sessionId);

  // 4. OR-filter
  const sessions = await prisma.session.findMany({
    where: {
      OR: [
        { userId },
        { projectId: { in: adminProjectIds } },
        { id: { in: sharedSessionIds } },
      ],
    },
  });

  return NextResponse.json({ sessions });
}
```

> **Prisma schema 验证**：`session_shares` / `SessionShare` 模型在 M1 是否已存在？若 M1 仅有 placeholder 占位字段，本步用 `prisma.sessionShare.findMany()` 会运行期报错。

**Fallback（若 SessionShare 模型未建）**：catch 整体或退化：

```ts
let sharedSessionIds: string[] = [];
try {
  const sharedSessions = await prisma.sessionShare.findMany(...);
  sharedSessionIds = sharedSessions.map((s) => s.sessionId);
} catch {
  sharedSessionIds = [];
}
```

并在脑暴文档记录"M2.4 share 真正接入时移除 try/catch"。

**Step 3: 集成测试**

参考 design §5.2；mock prisma 验证 3 路：

```ts
// app/api/sessions/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    teamMember: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
    sessionShare: { findMany: vi.fn() },
    session: { findMany: vi.fn() },
  },
}));

import { GET } from "./route";

describe("GET /api/sessions 3-way filter", () => {
  it("includes self-created sessions", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.teamMember.findMany).mockResolvedValue([]);
    vi.mocked(prisma.sessionShare.findMany).mockResolvedValue([]);
    vi.mocked(prisma.session.findMany).mockResolvedValue([
      { id: "s1", userId: "u1" },
    ] as any);
    // ...断言 OR 中含 userId === u1
  });
});
```

**Step 4: 跑测试 + 提交**

```bash
pnpm exec vitest run app/api/sessions/route.test.ts
git add app/api/sessions/route.ts app/api/sessions/route.test.ts
git commit -m "feat(sessions): 3-way filter (self + team admin + share placeholder)"
```

---

### Task 4.4: 实现 `lib/session-meta.ts::rebuildFromJsonl`

**Files:**
- Modify: `lib/session-meta.ts`
- Create: `lib/session-meta-rebuild.test.ts`
- Create: `instrumentation.ts`

**Step 1: 阅读现状**

```bash
cat lib/session-meta.ts
```

`recordSessionMeta` 和 `__piSessionMeta` map 应该已存在。

**Step 2: 写真实的 rebuildFromJsonl**

```ts
// lib/session-meta.ts (新增)
import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";

export async function rebuildFromJsonl(
  map: Map<string, SessionMetaRow>
): Promise<void> {
  const dataDir = process.env.PI_WEB_DATA_DIR || "./data";
  try {
    await stat(dataDir);
  } catch {
    return; // 首次启动, dir 不存在
  }

  const files: string[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".jsonl")) files.push(p);
    }
  }
  await walk(dataDir);

  for (const f of files) {
    try {
      const content = await readFile(f, "utf-8");
      const firstLine = content.split("\n")[0];
      if (!firstLine.trim()) continue;
      const meta = JSON.parse(firstLine);
      const sid = meta.sessionId ?? meta.id;
      if (!sid) continue;
      map.set(sid, {
        sessionId: sid,
        userId: meta.userId ?? null,
        projectId: meta.projectId ?? null,
      });
    } catch {
      // parse 失败 → 跳过（M1 spec §"Server 启动时 metadata rebuild 失败降级"）
    }
  }
}
```

**Step 3: 单元测试**

```ts
// lib/session-meta-rebuild.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { rebuildFromJsonl } from "./session-meta";

describe("rebuildFromJsonl", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "pi-meta-"));
    process.env.PI_WEB_DATA_DIR = tmp;
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("loads valid first lines into map", async () => {
    writeFileSync(
      join(tmp, "a.jsonl"),
      JSON.stringify({ sessionId: "s1", userId: "u1", projectId: "p1" }) + "\n"
    );
    const map = new Map();
    await rebuildFromJsonl(map);
    expect(map.get("s1")).toEqual({ sessionId: "s1", userId: "u1", projectId: "p1" });
  });

  it("skips invalid JSON without throwing", async () => {
    writeFileSync(join(tmp, "bad.jsonl"), "not json\n");
    const map = new Map();
    await expect(rebuildFromJsonl(map)).resolves.toBeUndefined();
  });

  it("returns empty map when dir missing", async () => {
    rmSync(tmp, { recursive: true });
    const map = new Map();
    await expect(rebuildFromJsonl(map)).resolves.toBeUndefined();
    expect(map.size).toBe(0);
  });

  it("walks nested directories", async () => {
    const sub = join(tmp, "sub");
    require("fs").mkdirSync(sub);
    writeFileSync(
      join(sub, "deep.jsonl"),
      JSON.stringify({ sessionId: "s2", userId: "u2" }) + "\n"
    );
    const map = new Map();
    await rebuildFromJsonl(map);
    expect(map.size).toBe(1);
  });
});
```

**Step 4: 创建 `instrumentation.ts`**（参考 design §3.6）

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { rebuildFromJsonl } = await import("@/lib/session-meta");
    const map = globalThis.__piSessionMeta ?? new Map();
    globalThis.__piSessionMeta = map;
    await rebuildFromJsonl(map);
    console.log(`[INSTRUMENTATION] rebuildFromJsonl complete, ${map.size} sessions loaded`);
  }
}
```

> 注意：`globalThis.__piSessionMeta` Map 类型在 `lib/session-meta.ts` 顶部声明（应为既有 M1 声明）。

**Step 5: 跑测试**

```bash
pnpm exec vitest run lib/session-meta-rebuild.test.ts
```

Expected: 4 pass

**Step 6: 提交**

```bash
git add lib/session-meta.ts lib/session-meta-rebuild.test.ts instrumentation.ts
git commit -m "feat(meta): implement rebuildFromJsonl + Next 16 instrumentation hook"
```

---

### Task 4.5: 创建 `lib/session-cap.ts`

**Files:**
- Create: `lib/session-cap.ts`
- Create: `lib/session-cap.test.ts`

**Step 1: 写失败的测试**

```ts
// lib/session-cap.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { sessionCapCheck, sessionCapIncrement, sessionCapDecrement, SESSION_CAP_MAX } from "./session-cap";

beforeEach(() => {
  delete globalThis.__piSessionCounter;
});

describe("sessionCap", () => {
  it("SESSION_CAP_MAX is 50", () => {
    expect(SESSION_CAP_MAX).toBe(50);
  });

  it("check returns allowed when count < MAX", () => {
    expect(sessionCapCheck().allowed).toBe(true);
  });

  it("check blocks after incrementing to MAX", () => {
    for (let i = 0; i < 50; i++) sessionCapIncrement();
    expect(sessionCapCheck().allowed).toBe(false);
    expect(sessionCapCheck().current).toBe(50);
  });

  it("decrement allows a slot", () => {
    for (let i = 0; i < 50; i++) sessionCapIncrement();
    sessionCapDecrement();
    expect(sessionCapCheck().allowed).toBe(true);
  });

  it("decrement is clamped at 0", () => {
    sessionCapDecrement();
    sessionCapDecrement();
    expect(sessionCapCheck().current).toBe(0);
  });
});
```

**Step 2: 跑测试验失败 + 实现**（参考 design §3.5）

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
  getCounter().count++;
}

export function sessionCapDecrement(): void {
  const counter = getCounter();
  if (counter.count > 0) counter.count--;
}

export const SESSION_CAP_MAX = MAX;
```

**Step 3: 跑测试验通过 + 提交**

```bash
pnpm exec vitest run lib/session-cap.test.ts
git add lib/session-cap.ts lib/session-cap.test.ts
git commit -m "feat(session-cap): in-memory 50-session global counter"
```

---

### Task 4.6: `app/api/agent/new` 接入 cap

**Files:**
- Modify: `app/api/agent/new/route.ts`

**Step 1: 在 membership check 通过后、startRpcSession 前插入**

```diff
+import { sessionCapCheck, sessionCapIncrement, sessionCapDecrement } from "@/lib/session-cap";

 export async function POST(req: NextRequest) {
   const gate = enforceNotMustChange(req);
   if (gate) return gate;
+
+  // 50 session cap
+  const cap = sessionCapCheck();
+  if (!cap.allowed) {
+    return NextResponse.json(
+      { error: "session cap reached", current: cap.current },
+      { status: 503, headers: { "Retry-After": "60" } }
+    );
+  }
+
   // ... membership check ...
+
   // session 关闭时需要 sessionCapDecrement（看 startRpcSession 失败回调）
+  const { sessionId } = await startRpcSession(...);
+  sessionCapIncrement();
+  // 注: session 终止/失败时 decrement 暂不在 4.6 范围, 见脑暴 limit
```

> **已知 limit**: server crash → counter drift（不修，M3 janitor）。仅业务成功路径 + 干净失败路径保证 counter 平衡；崩溃路径接受 drift。

**Step 2: 集成测试**

扩 `app/api/agent/new/route.test.ts` 加 1 case：

```ts
it("returns 503 + Retry-After when cap reached", async () => {
  // 把 globalThis.__piSessionCounter.count 设为 50
  globalThis.__piSessionCounter = { count: 50 };
  const req = new Request(...);
  const res = await POST(req as any);
  expect(res.status).toBe(503);
  expect(res.headers.get("Retry-After")).toBe("60");
});
```

**Step 3: 提交**

```bash
git add app/api/agent/new/route.ts
git commit -m "feat(session-cap): enforce 50 cap in agent/new with 503 + Retry-After"
```

---

### Task 4.7: Dockerfile 加 `prisma migrate deploy`

**Files:**
- Modify: `Dockerfile`

**Step 1: 阅读现状**

```bash
cat Dockerfile
```

**Step 2: 在 `prisma generate` 后加一行**

```diff
 RUN pnpm exec prisma generate
+RUN pnpm exec prisma migrate deploy
 RUN pnpm run build
```

> **`prisma migrate deploy` 阻塞**：若失败会让 `docker build` 失败 — 确认 M1 schema.prisma migrations 目录已 commit 且与 DB 一致；否则需 `prisma migrate resolve` 手动标记 baseline。

**Step 3: 验证现有 migrations 目录**

```bash
ls -la prisma/migrations/ 2>&1 | head -20
```

Expected: M1 阶段应至少 2 个 migration。

**Step 4: 提交**

```bash
git add Dockerfile
git commit -m "fix(dockerfile): run prisma migrate deploy before build"
```

---

## 任务 5: 元测试 + E2E 扩

### Task 5.1: meta-test 扫描写路由门覆盖（关键防遗漏测试）

**Files:**
- Create: `lib/must-change-password.meta.test.ts`

**Step 1: 写 meta-test**（参考 design §3.8）

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
      yield p;
    }
  }
}

function hasWriteHandler(content: string): boolean {
  return /export\s+async\s+function\s+(POST|PUT|DELETE|PATCH)\b/.test(content);
}

function usesEnforceNotMustChange(content: string): boolean {
  return /enforceNotMustChange\s*\(/.test(content);
}

describe("mustChangePassword gate coverage", () => {
  for (const routeFile of walkRoutes("app/api")) {
    const rel = routeFile.replace(/\\/g, "/");
    if (ALLOWLIST.has(rel)) continue;

    it(`${rel} write handler must call enforceNotMustChange`, () => {
      const content = readFileSync(routeFile, "utf-8");
      if (!hasWriteHandler(content)) return; // 读路由
      expect(usesEnforceNotMustChange(content)).toBe(true);
    });
  }
});
```

**Step 2: 跑测试**

```bash
pnpm exec vitest run lib/must-change-password.meta.test.ts
```

Expected: all pass（M2.2 阶段所有写路由已加门）

**Step 3: 故意破坏一个路由验证测试会失败**

```bash
# 临时把 lib/must-change-password import 注释出 agent/new/route.ts
sed -i.bak 's|import { enforceNotMustChange } from "@/lib/must-change-password";|// removed for test|' app/api/agent/new/route.ts
pnpm exec vitest run lib/must-change-password.meta.test.ts 2>&1 | grep -E "FAIL|expected"
mv app/api/agent/new/route.ts.bak app/api/agent/new/route.ts
```

Expected: 至少 1 test fail（说明 meta-test 真在防遗漏）

**Step 4: 提交**

```bash
git add lib/must-change-password.meta.test.ts
git commit -m "test(meta): AST-scan write routes for mustChangePassword gate coverage"
```

---

### Task 5.2: E2E 扩 5 use case in `tests/e2e/login.spec.ts`

**Files:**
- Modify: `tests/e2e/login.spec.ts`（M1 已有 smoke）

**Step 1: 阅读现状**

```bash
cat tests/e2e/login.spec.ts
```

**Step 2: 写 5 个 use case**

```ts
// tests/e2e/login.spec.ts (M2.2 扩展)
import { test, expect } from "@playwright/test";

test.describe("M2.2 e2e", () => {
  test("(a) login UI flow via page.goto /en/login", async ({ page, request }) => {
    await page.goto("/en/login");
    await page.fill('input[name="username"]', "root");
    await page.fill('input[name="password"]', "root-password");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/en\/dashboard$|\/en\/change-password$/);
  });

  test("(b) change-password flow", async ({ page }) => {
    // root 登录 → mustChangePassword=true → 改密 → dashboard
    // ...
  });

  test("(c) dashboard data renders user + team + projects", async ({ page }) => {
    // 登录后访问 /en/dashboard
    // expect(page.locator("h1")).toContainText("Dashboard");
    // expect(page.locator("p")).toContainText("Welcome root");
  });

  test("(d) mustChangePwd 403 when writing agent before password change", async ({ request }) => {
    // 设 cookie 表示一个 mustChangePwd=true 的用户
    // POST /api/agent/new 期望 403
  });

  test("(e) 50 session cap returns 503", async ({ request }) => {
    // 在 NODE 直接灌满 globalThis.__piSessionCounter
    // 然后 POST /api/agent/new 期望 503 + Retry-After: 60
  });
});
```

> **(c) 注**：3-way 过滤 E2E 可能需用 `recordSessionMeta` 注 fake meta（不真起 RPC session）。详见 tasks.md Notes。

> **(d) 注**：cookie 注入可借 Playwright `request` fixture + 设置 cookie context。

> **(e) 注**：counter 是 `globalThis.__piSessionCounter`，dev 进程 — Playwright 起的是外部 process；**改用 NODE-side script** 或 **直接在 `/api/test/set-cap` 仅 dev 暴露的 endpoint**。如不便，最简是把 counter 设为可配置 env：M2.2 设 `SESSION_CAP_MAX=5` (env 覆盖) → 用 5 个真实请求触发 503。

```ts
// (e) 可选：env-override cap
test("(e) 50 session cap returns 503", async ({ request }) => {
  // 假设 dev server 已设 SESSION_CAP_MAX=5
  for (let i = 0; i < 5; i++) {
    await request.post("/api/agent/new", { data: {} });
  }
  const res = await request.post("/api/agent/new", { data: {} });
  expect(res.status()).toBe(503);
  expect(res.headers()["retry-after"]).toBe("60");
});
```

**Step 3: 跑 Playwright**

```bash
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="是" pnpm exec playwright test tests/e2e/login.spec.ts
```

Expected: 5/5 pass（或 5 个 case 各自跑过）

**Step 4: 提交**

```bash
git add tests/e2e/login.spec.ts
git commit -m "test(e2e): expand login.spec.ts to 5 use case (UI flow / change-pwd / dashboard / mustChange 403 / cap 503)"
```

---

## 任务 6: 验证与收尾

### Task 6.1: `pnpm exec tsc --noEmit` 干净

```bash
pnpm exec tsc --noEmit
```

Expected: exit 0, 零 error。

如失败：逐个文件修；不通过不进入下一任务。

---

### Task 6.2: `pnpm exec vitest run` 全 pass（含 meta-test + path-safety 回归）

```bash
pnpm exec vitest run
```

Expected: all pass，包含：
- M1 `lib/path-safety.test.ts` (5/5)
- `lib/session-cap.test.ts`
- `lib/must-change-password.test.ts`
- `lib/session-meta-rebuild.test.ts`
- `lib/server-user.test.ts`
- `lib/i18n.test.ts`
- `lib/must-change-password.meta.test.ts`
- `app/api/agent/new/route.test.ts`
- `app/api/sessions/route.test.ts`

---

### Task 6.3: `pnpm exec playwright test` 5 use case

```bash
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="是" pnpm exec playwright test
```

Expected: 5/5 pass.

---

### Task 6.4: `pnpm run build` 干净

```bash
pnpm run build 2>&1 | tee /tmp/build.log
grep -E "Capturing groups|Invalid middleware|Error" /tmp/build.log | head -20
```

Expected: **NO "Capturing groups"**，build exit 0。

如失败：见 Task 1.6 fallback。

---

### Task 6.5: 浏览器手动 smoke

**Step 1: 启动**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
sleep 6
grep -E "rebuildFromJsonl complete" /tmp/dev.log
```

Expected: `[INSTRUMENTATION] rebuildFromJsonl complete, N sessions loaded`

**Step 2: 浏览器 flow**

1. 访问 `http://localhost:30141/en/login`
2. 输 root / root-password → 期望跳转 `/en/change-password`
3. 输 new password (≥ 8 chars) → 跳转 `/en/dashboard`
4. 期望看到："Welcome root (OWNER)" + "mustChangePassword: false" + projects 列表
5. 同样访问 `http://localhost:30141/zh-CN/login` → 中文 UI 出现

**Step 3: 收尾**

```bash
kill %1
```

---

## 已知 limit 与 deviance 追踪

### Limit（来自 design doc + 脑暴）

1. **50-cap counter drift on server crash**：**M2.2 不修**，crash drift → 永远 503 直至重启 → M3 janitor hourly 扫描。
2. **in-memory single-process counter**：未来 M3 切 cluster 时各 worker 独立计数 → M3 改 Prisma 持久化。
3. **rebuildFromJsonl 启动开销**：< 50ms for 1000 sessions（M1 design §4.5 承诺）；如首次实现超 → 降级 lazy on first access（脑暴已允许）。
4. **server component self-loopback fetch**：`GET http://localhost:30141/api/projects` 300ms RTT；M3 评估是否 in-process call。
5. **next-intl ^3 不升级**：避免 spec break；M3 评估。
6. **middleware → proxy rename**：Next.js 16 弃用但仍能跑（M2.2 仅 fix deprecation warning 如有余力）。

### Deviance（plan 阶段已记录）

- **Task 1.6 fallback**：如 path-to-regexp v8 在 i18n matcher 报 "Capturing groups"，立即 hardcode locale 白名单 `en/login|en/change-password|en/dashboard|zh-CN/login|zh-CN/change-password|zh-CN/dashboard` 替代 `(?:en|zh-CN)/...`。
- **Task 4.3 fallback**：若 Prisma schema 未建 `session_shares` 模型，3-way 过滤第三路加 try/catch 退化；M2.4 真正接入时移除。

---

## References

- Design Doc: `/Users/xiejava/AIproject/AI-agent-workshop/docs/superpowers/specs/2026-07-13-pi-web-m2-2-ui-and-hardening-design.md`
- OpenSpec tasks: `/Users/xiejava/AIproject/AI-agent-workshop/openspec/changes/pi-web-m2-2-ui-and-hardening/tasks.md`
- Brainstorm: `/Users/xiejava/AIproject/AI-agent-workshop/openspec/changes/pi-web-m2-2-ui-and-hardening/.comet/handoff/brainstorm-summary.md`
- Proposal/design delta specs: `/Users/xiejava/AIproject/AI-agent-workshop/openspec/changes/pi-web-m2-2-ui-and-hardening/{proposal,design}.md` + 6 个 `specs/*/spec.md`
- M1 archive: `/Users/xiejava/AIproject/AI-agent-workshop/openspec/changes/archive/2026-07-13-pi-web-generalized-m1-runnable/`
- M1 verify report: `/Users/xiejava/AIproject/AI-agent-workshop/docs/superpowers/reports/2026-07-13-pi-web-generalized-m1-runnable-verify.md`
- Capability specs (archived to main): `/Users/xiejava/AIproject/AI-agent-workshop/openspec/specs/{auth-provider-user,bootstrap-root-owner,multi-tenant-team-model,project-and-path-safety,agent-session-in-process,runnable-harness}/spec.md`
- Fork repo: `https://github.com/xiejava1018/pi-web` v0.7.11
- Base ref: `934f21aab2b6c2a4513398689bcd76592cee7da5`
