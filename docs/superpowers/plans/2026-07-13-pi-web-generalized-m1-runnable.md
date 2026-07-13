---
change: pi-web-generalized-m1-runnable
design-doc: docs/superpowers/specs/2026-07-12-pi-web-generalized-m1-design.md
base-ref: b3bcb4c58eec1c29704e7dbbad5d6904b36f05d7
archived-with: 2026-07-13-pi-web-generalized-m1-runnable
---

# M1 通用 web 多用户 AI agent 工作台 — 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **产物语言：** zh-CN（与 `.comet.yaml` language 一致）
>
> **设计文档**：[docs/superpowers/specs/2026-07-12-pi-web-generalized-m1-design.md](../specs/2026-07-12-pi-web-generalized-m1-design.md)
>
> **OpenSpec 任务清单**：[openspec/changes/pi-web-generalized-m1-runnable/tasks.md](../../openspec/changes/pi-web-generalized-m1-runnable/tasks.md)

## Goal

在 `xiejava1018/pi-web` v0.7.11 fork 之上叠加多用户封装层（User auth + Team/Project + 路径白名单 + 会话可见性），输出一个能本地 `pnpm dev` 起服务、首启动 bootstrap root owner、Playwright 登录→改密→dashboard smoke 通过的 M1 起步版本。

## Architecture

**不重写 fork**。在 fork 已有 28 个 API 路由、`lib/rpc-manager.ts`、`lib/allowed-roots.ts`、`lib/session-reader.ts`、UI 17 个目录之上，**新增** 4 类文件：

1. **数据层**：`prisma/schema.prisma` + `prisma/migrations/`（SQLite）
2. **Auth 层**：`lib/auth-provider.ts` 接口 + `lib/auth-provider-local.ts` + `scripts/bootstrap-root.ts` + `app/api/auth/{user-login,user-logout,change-password}/route.ts` + 根 `middleware.ts`
3. **路径安全层**：`lib/path-safety.ts::assertWithinRoot` + `lib/session-meta.ts` + `app/api/projects/{route.ts,[id]/bind/route.ts}` + 修 `app/api/agent/[id]/{events,route.ts}` read-path 权限
4. **Smoke 层**：`tests/e2e/login.spec.ts` + `playwright.config.ts` + 最小 `Dockerfile`

**唯一的 fork 文件修改** = 3 处：`app/api/agent/[id]/events/route.ts` read-path 加权限校验、`app/api/agent/[id]/route.ts` POST handler 加权限校验、sidebar cwd 输入控件改为 Project 选择 dropdown。

## Tech Stack

| 类别 | 选型 |
|---|---|
| 框架 | Next.js 16 (fork 已用) + React 19 (fork 已用) |
| ORM | Prisma 5.x + SQLite |
| 认证 | bcryptjs (cost=10) + jose (JWT, HS256) |
| 并发 | async-mutex（仅为将来预留，M1 单实例） |
| 测试 | Vitest (单元) + Playwright (E2E) + axe-core (a11y, M3) |
| i18n | next-intl (占位, M1 仅英文) |

## Working Repo 初始化

**重要**：本计划开始执行前，build 阶段步骤 4 会初始化 git 仓库（路径待 comet-build step 4 决定，候选 `/Users/xiejava/AIagent-workshop/` 或当前 `.comet.yaml` 配置位置）。**本计划不预设 git 操作**——所有 task 的"commit"步骤在仓库初始化后追加；如果仍无 git，本计划要求 executor 用 commit-only-but-no-git fallback (留 commit message 在每个 task 的 `Acceptance` 注释里、累积到 Handoff doc)。

待 build executor 在执行 step 1 (1.1) 前完成：
1. `comet-build step 4 init` 完成 git 仓库初始化
2. 把 fork `/Users/xiejava/AIproject/pi-web/` 内容 copy/sync 到 working repo（叠加形态）
3. 创建分支 `feature/m1-runnable` 并切换

---

## 文件布局（fork 之上增量）

下表给出本计划要新增/修改的文件全貌。后续每个 Task 的"Files"小节会再次精确列出。

```
{working-repo}/
├── prisma/                                          [新增]
│   ├── schema.prisma                                (Task 1.1)
│   └── migrations/                                  (auto)
├── lib/
│   ├── auth-provider.ts                             (Task 2.1) [新增]
│   ├── auth-provider-local.ts                       (Task 2.2) [新增]
│   ├── path-safety.ts                               (Task 3.1) [新增]
│   ├── path-safety.test.ts                          (Task 3.2) [新增]
│   └── session-meta.ts                              (Task 4.1 同任务) [新增]
├── scripts/
│   └── bootstrap-root.ts                            (Task 2.3) [新增]
├── app/api/
│   ├── auth/
│   │   ├── user-login/route.ts                      (Task 2.4) [新增]
│   │   ├── user-logout/route.ts                     (Task 2.5) [新增]
│   │   └── change-password/route.ts                 (Task 2.7) [新增]
│   ├── projects/
│   │   ├── route.ts                                 (Task 3.3) [新增]
│   │   └── [id]/bind/route.ts                       (Task 3.4) [新增]
│   └── agent/[id]/
│       ├── events/route.ts                          (Task 4.1) [修改]
│       └── route.ts                                 (Task 4.2) [修改]
├── middleware.ts                                    (Task 2.6) [新增, 根目录]
├── components/sidebar/                              (Task 3.5) [修改]
│   └── SidebarCwdInput.tsx → SidebarProjectPicker.tsx
├── tests/
│   └── e2e/
│       └── login.spec.ts                            (Task 4.3) [新增]
├── playwright.config.ts                             (Task 4.3) [新增]
├── .env.example                                     (Task 1.4) [新增]
├── data/.gitkeep                                    (Task 1.5) [新增]
├── Dockerfile                                       (Task 4.4) [新增, 最小 build 验证]
└── package.json                                     (Task 1.2、1.3) [修改]
```

---

## 第 1 组：项目基础叠加（Task 1.x）

### Task 1: Prisma schema 与 SQLite 初始化（对应 tasks.md 1.1）

**Files:**
- Create: `prisma/schema.prisma`

**Source artifact:** tasks.md § 1.1

**Step 1: 写 schema.prisma**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id                 String   @id @default(cuid())
  username           String   @unique
  passwordHash       String
  mustChangePassword Boolean  @default(false)
  lastProjectId      String?
  createdAt          DateTime @default(now())
  teams              TeamMember[]
}

model Team {
  id          String   @id @default(cuid())
  name        String
  ownerUserId String
  createdAt   DateTime @default(now())
  members     TeamMember[]
  projects    Project[]
}

model TeamMember {
  teamId   String
  userId   String
  role     Role     @default(MEMBER)
  joinedAt DateTime @default(now())
  team     Team     @relation(fields: [teamId], references: [id])
  user     User     @relation(fields: [userId], references: [id])
  @@id([teamId, userId])
}

enum Role {
  OWNER
  ADMIN
  MEMBER
}

model Project {
  id        String   @id @default(cuid())
  teamId    String
  name      String
  rootPath  String
  createdBy String
  createdAt DateTime @default(now())
  team      Team     @relation(fields: [teamId], references: [id])
  @@unique([teamId, rootPath])
}

// M2 reserved — schema 留空表, M1 永 false
model SessionShare {
  sessionId         String
  sharedWithUserId  String
  createdAt         DateTime @default(now())
  @@id([sessionId, sharedWithUserId])
}
```

**Acceptance:**
- 文件存在、`pnpm exec prisma validate` 通过
- enum `Role` 包含 `OWNER` `ADMIN` `MEMBER` 三值
- 5 张 model (User/Team/TeamMember/Project/SessionShare) 全部有 `String @id @default(cuid())`
- `TeamMember` 的 `@@id` 是 `[teamId, userId]` 复合
- `Project` 的 `@@unique` 是 `[teamId, rootPath]`

**Test commands:** `pnpm exec prisma validate`

---

### Task 2: 安装依赖与版本锁（对应 tasks.md 1.2）

**Files:**
- Modify: `package.json` (devDependencies + dependencies + scripts)

**Source artifact:** tasks.md § 1.2

**Step 1: 装包**

```bash
pnpm add prisma @prisma/client bcryptjs jose async-mutex next-intl
pnpm add -D @prisma/client @playwright/test @axe-core/playwright vitest @vitest/coverage-v8
```

**Step 2: 在 package.json 锁定关键版本（不带 ^）**

修改 `dependencies` 段，把 fork 已有的下面这两条从 `^x.y.z` 改为精确锁：

```json
{
  "@earendil-works/pi-coding-agent": "<从 fork package.json 抄写当前精确版本>",
  "@earendil-works/pi-ai": "<从 fork package.json 抄写当前精确版本>"
}
```

**Acceptance:**
- `package.json` 含 `prisma`、`@prisma/client`、`bcryptjs`、`jose`、`async-mutex`、`next-intl`、`@playwright/test`、`@axe-core/playwright`、`vitest`
- `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-ai` 版本号前缀无 `^`
- `pnpm install` 成功（无 peer dep 警告升级为 error 即可）

**Test commands:** `pnpm install`

---

### Task 3: package.json scripts（对应 tasks.md 1.3）

**Files:**
- Modify: `package.json` (scripts 段)

**Source artifact:** tasks.md § 1.3

**Step 1: 追加脚本**

```json
{
  "scripts": {
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:reset": "prisma migrate reset --force",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "start": "tsx scripts/bootstrap-root.ts && next start",
    "dev": "prisma generate && tsx scripts/bootstrap-root.ts && next dev",
    "prebuild": "prisma generate",
    "build": "next build"
  }
}
```

**Acceptance:**
- 8 个新脚本存在：`db:migrate`、`db:generate`、`db:reset`、`test`、`test:watch`、`test:e2e`、`start`、`prebuild`
- `pnpm run db:migrate --help` 返回 Prisma 帮助（验证脚本链）
- `pnpm run db:generate` 产出 `node_modules/.prisma/client/index.d.ts`

**Test commands:** `pnpm run db:migrate --help`

---

### Task 4: .env.example 与 data 目录（对应 tasks.md 1.4、1.5）

**Files:**
- Create: `.env.example`
- Create: `data/.gitkeep`

**Source artifact:** tasks.md § 1.4、1.5

**Step 1: .env.example**

```
DATABASE_URL=file:./data/dev.db
PI_WEB_DATA_DIR=./data
PI_WEB_JWT_SECRET=
```

**Step 2: data/.gitkeep + data/.gitignore**

```
# data/.gitignore
*
!.gitignore
!.gitkeep
```

**Step 3: README 段落（追加到 fork 现有 README.md 末尾，标记 TODO M3）**

```markdown
## 数据持久化（M1 本地）

启动前确保 `./data` 目录存在。Docker 启动时挂载 `-v $(pwd)/data:/app/data`。

> TODO M3: 写完整 README 部署文档（docker-compose、Postgres、上游 fork 同步策略）。
```

**Acceptance:**
- `.env.example` 存在且含三条变量
- `data/.gitkeep` 存在、`data/.gitignore` 排除其他文件
- README 末尾含 `-v $(pwd)/data:/app/data` 与 TODO M3 标记

---

## 第 2 组：User auth 层（Task 2.x）

### Task 5: AuthProvider 接口（对应 tasks.md 2.1）

**Files:**
- Create: `lib/auth-provider.ts`

**Source artifact:** tasks.md § 2.1

**Step 1: 写接口与工厂**

```ts
export interface AuthenticatedUser {
  id: string;
  username: string;
  mustChangePassword: boolean;
}

export interface AuthProvider {
  authenticate(username: string, password: string): Promise<AuthenticatedUser>;
  revoke(userId: string): Promise<void>;
}

let _provider: AuthProvider | null = null;

export function registerAuthProvider(p: AuthProvider): void {
  _provider = p;
}

export function getAuthProvider(): AuthProvider {
  if (!_provider) throw new Error("AuthProvider not registered");
  return _provider;
}
```

**Acceptance:**
- 导出 `AuthProvider`、`AuthenticatedUser`、`registerAuthProvider`、`getAuthProvider`
- `getAuthProvider()` 在未注册时抛带 "AuthProvider not registered" 的 Error
- TypeScript 严格模式下编译通过（Provider 接口形态完整）

**Test commands:** `pnpm exec tsc --noEmit lib/auth-provider.ts`

---

### Task 6: LocalPasswordAuthProvider 实现（对应 tasks.md 2.2）

**Files:**
- Create: `lib/auth-provider-local.ts`

**Source artifact:** tasks.md § 2.2

**Step 1: 写实现**

```ts
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";
import { AuthProvider, AuthenticatedUser } from "./auth-provider";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod";
const COST = 10;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(JWT_SECRET);
}

export class LocalPasswordAuthProvider implements AuthProvider {
  async authenticate(username: string, password: string): Promise<AuthenticatedUser> {
    let user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      // 首次自动注册（OpenSpec 行为：username 唯一即可自动创建）
      const hash = await bcrypt.hash(password, COST);
      user = await prisma.user.create({
        data: { username, passwordHash: hash },
      });
    } else {
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) throw new Error("invalid credentials");
    }
    return {
      id: user.id,
      username: user.username,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async signJwt(userId: string): Promise<string> {
    return await new SignJWT({ sub: userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secretKey());
  }

  async revoke(userId: string): Promise<void> {
    // M1: no-op; M2 will invalidate token in store
  }
}
```

**Acceptance:**
- 导出 `LocalPasswordAuthProvider`、方法 `authenticate`、`signJwt`、`revoke`
- bcrypt cost=10
- JWT 用 `HS256`，exp `15m`
- 统一错误：密码错返回 `Error("invalid credentials")`；不区分"用户不存在"与"密码错"

**Test commands:** `pnpm exec tsc --noEmit lib/auth-provider-local.ts`

---

### Task 7: bootstrap-root 脚本（对应 tasks.md 2.3）

**Files:**
- Create: `scripts/bootstrap-root.ts`

**Source artifact:** tasks.md § 2.3

**Step 1: 写脚本**

```ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.user.count();
  if (count > 0) return;

  const password = randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      username: "root",
      passwordHash,
      mustChangePassword: true,
    },
  });

  // 这一行专门给运维/启动日志捕获
  // eslint-disable-next-line no-console
  console.log(`[BOOTSTRAP] root username=root password=${password}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

**Acceptance:**
- 导出方式：CLI 直接 `tsx scripts/bootstrap-root.ts`
- `prisma.user.count() === 0` 时 create root, mustChangePassword=true
- 密码：`randomBytes(18).toString("base64url")` —— ≥16B URL-safe base64
- stdout 含一行 `[BOOTSTRAP] root username=root password=<secret>`
- 已存在 user 时脚本静默退出（不重置密码）

**Test commands:** `pnpm run db:migrate` （先建表）→ `pnpm exec tsx scripts/bootstrap-root.ts` 期望 stdout 出一行 `[BOOTSTRAP]...`，再跑一次静默

---

### Task 8: user-login 路由（对应 tasks.md 2.4）

**Files:**
- Create: `app/api/auth/user-login/route.ts`

**Source artifact:** tasks.md § 2.4

**Step 1: 写 handler**

```ts
import { NextRequest, NextResponse } from "next/server";
import { LocalPasswordAuthProvider } from "@/lib/auth-provider-local";

const provider = new LocalPasswordAuthProvider();

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: "missing credentials" }, { status: 400 });
  }
  try {
    const user = await provider.authenticate(username, password);
    const jwt = await provider.signJwt(user.id);
    const res = NextResponse.json({
      id: user.id,
      username: user.username,
      mustChangePassword: user.mustChangePassword,
    });
    res.cookies.set("pw_at", jwt, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 15,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
}
```

**Acceptance:**
- POST JSON body 解析 `{username, password}`
- 缺参数 400
- 凭据错 401 `{ error: "invalid credentials" }`（不暴露用户名是否存在）
- 成功 200 + Set-Cookie `pw_at` (`HttpOnly; Path=/; Max-Age=900`)
- 必须**不**在 middleware matcher 例外名单内（middleware 阶段会处理，但本路由自身不能 require session — 即不能 return 401 if no session）

**Test commands:** `pnpm exec tsc --noEmit app/api/auth/user-login/route.ts`

---

### Task 9: user-logout 路由（对应 tasks.md 2.5）

**Files:**
- Create: `app/api/auth/user-logout/route.ts`

**Source artifact:** tasks.md § 2.5

**Step 1: 写 handler**

```ts
import { NextRequest, NextResponse } from "next/server";
import { LocalPasswordAuthProvider } from "@/lib/auth-provider-local";

const provider = new LocalPasswordAuthProvider();

export async function POST(req: NextRequest) {
  // userId 从 cookie 拿不到时静默清 cookie（M1: 无 revoke 表）
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("pw_at");
  return res;
}
```

**Acceptance:**
- POST 200 `{ ok: true }` + 清 `pw_at` cookie
- 即使未登录也返回 200（幂等 logout）

**Test commands:** `pnpm exec tsc --noEmit`

---

### Task 10: middleware.ts（对应 tasks.md 2.6）

**Files:**
- Create: `middleware.ts` （repo root）

**Source artifact:** tasks.md § 2.6

**Step 1: 写 middleware**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SECRET = process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod";

export const config = {
  matcher: [
    // 拦截 /api/*, 但放过:
    //  - user-login, user-logout
    //  - fork 现有 model provider auth: providers/login/logout/api-key/all-providers
    //  - 静态资源
    "/((?!_next/|favicon|api/auth/(user-login|user-logout)|api/auth/(providers|login|logout|all-providers|api-key)).*)",
    // 显式拦 /api/* 一律
    "/api/((?!auth/(user-login|user-logout|providers|login|logout|all-providers|api-key)).*)",
  ],
};

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get("pw_at")?.value;
  if (!cookie) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }
  try {
    const { payload } = await jwtVerify(cookie, new TextEncoder().encode(SECRET));
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-user-id", String(payload.sub));
    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    return NextResponse.json({ error: "invalid session" }, { status: 401 });
  }
}
```

**Acceptance:**
- 导出 `config.matcher` 含两条规则
- 无 cookie → 401 `{ error: "auth required" }`
- JWT 校验失败 → 401 `{ error: "invalid session" }`
- 成功 → `req.headers["x-user-id"]` = JWT `sub`
- `/`、`/api/auth/user-login`、`/api/auth/user-logout`、`/api/auth/providers`、`/api/auth/login`、`/api/auth/logout`、`/api/auth/all-providers`、`/api/auth/api-key`、静态资源 `_next/*`、`favicon*` 不被拦

**Test commands:** `pnpm exec tsc --noEmit middleware.ts`

---

### Task 11: change-password 路由（对应 tasks.md 2.7）

**Files:**
- Create: `app/api/auth/change-password/route.ts`

**Source artifact:** tasks.md § 2.7

**Step 1: 写 handler**

```ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const { newPassword } = await req.json();
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "password too short" }, { status: 400 });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hash, mustChangePassword: false },
  });
  return NextResponse.json({ ok: true });
}
```

**Acceptance:**
- 缺少 `x-user-id` header → 401
- `newPassword` < 8 字符 → 400
- 成功 → 200 `{ ok: true }` + DB 的 `mustChangePassword` 变 false
- 这是 acceptance S1.1 smoke 的最后一个被勾选的步骤（详见 Task 25）

**Test commands:** `pnpm exec tsc --noEmit`

---

## 第 3 组：Project 绑定 + 路径白名单接入（Task 3.x）

### Task 12: path-safety 实现（对应 tasks.md 3.1）

**Files:**
- Create: `lib/path-safety.ts`

**Source artifact:** tasks.md § 3.1

**Step 1: 写实现**

```ts
import { realpathSync } from "fs";
import { resolve, normalize, isAbsolute, relative } from "path";

export class PathTraversalError extends Error {
  constructor(public readonly input: string, public readonly root: string) {
    super(`path outside root: ${input} not within ${root}`);
    this.name = "PathTraversalError";
  }
}

export function assertWithinRoot(input: string, root: string): string {
  const fullInput = isAbsolute(input) ? normalize(input) : resolve(root, input);
  const fullRoot = resolve(root);
  let realInput: string;
  try {
    realInput = realpathSync(fullInput);
  } catch {
    realInput = fullInput;
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(fullRoot);
  } catch (e) {
    throw new PathTraversalError(input, root);
  }
  const rel = relative(realRoot, realInput);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathTraversalError(input, root);
  }
  return realInput;
}
```

**Acceptance:**
- 导出 `assertWithinRoot` 与 `PathTraversalError`
- 路径不存在（`realInput` ENOENT） → 用 `fullInput` 兜底，relative 检查仍正确
- root 不存在 → 直接抛 `PathTraversalError`
- `..` 路径跨 root → 抛 `PathTraversalError`
- 符号链接指向 root 外 → 抛（realpath 解析后再 relative）
- URL 编码 `%2e%2e` 不被解码 → Node `path` 不解码，relative 检查照常工作

**Test commands:** 留到 Task 13 的单测一起跑

---

### Task 13: path-safety 单元测试（TDD — 对应 tasks.md 3.2）

**Files:**
- Create: `lib/path-safety.test.ts`

**Source artifact:** tasks.md § 3.2

**TDD Note:** 此任务按 RED-GREEN-IMPLEMENT 流程。先写测试、跑测试确认 fail，再保证 Task 12 的实现存在后跑测试确认 pass。

**Step 1: 写测试（vitest）**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assertWithinRoot, PathTraversalError } from "./path-safety";

let root: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "path-safety-"));
  outside = mkdtempSync(join(tmpdir(), "path-safety-out-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.ts"), "// hello");
  // 符号链接指向外
  try {
    symlinkSync(join(outside, "leak.txt"), join(root, "src", "leak.txt"));
    writeFileSync(join(outside, "leak.txt"), "secret");
  } catch {}
});

afterAll(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

describe("assertWithinRoot", () => {
  it("accepts legitimate child path", () => {
    const r = assertWithinRoot(join(root, "src", "index.ts"), root);
    expect(r).toContain("index.ts");
  });

  it("rejects .. traversal", () => {
    expect(() => assertWithinRoot(join(root, "src", "..", "..", "etc", "passwd"), root))
      .toThrow(PathTraversalError);
  });

  it("rejects absolute escape", () => {
    expect(() => assertWithinRoot("/etc/passwd", root)).toThrow(PathTraversalError);
  });

  it("rejects symlink pointing outside root", () => {
    expect(() => assertWithinRoot(join(root, "src", "leak.txt"), root))
      .toThrow(PathTraversalError);
  });

  it("accepts relative input resolved under root", () => {
    const r = assertWithinRoot("src/index.ts", root);
    expect(r).toContain("index.ts");
  });
});
```

**Step 2: 先跑测试确认 RED（Task 12 还没实现）**

```bash
pnpm exec vitest run lib/path-safety.test.ts
```

期望：FAIL（`./path-safety` 模块不存在）

**Step 3: 确认 Task 12 已完成（assertWithinRoot 已写），再跑测试**

```bash
pnpm exec vitest run lib/path-safety.test.ts
```

期望：5 个 case 全 PASS

**Acceptance:**
- 5 个测试 case 全 pass
- `pnpm exec vitest run` 报告 coverage: `path-safety.ts` 100% line coverage
- 文件以 `.test.ts` 结尾，与 vitest 约定一致

**Test commands:** `pnpm exec vitest run lib/path-safety.test.ts` 与 `pnpm exec vitest run --coverage lib/path-safety.test.ts`

---

### Task 14: session-meta 内存索引（与 Task 4.1 协同，但本 Task 先建文件）

**Files:**
- Create: `lib/session-meta.ts`

**Step 1: 写实现（设计文档 § 3.4 完整还原）**

```ts
declare global {
  var __piSessionMeta: Map<string, SessionMetaRow> | undefined;
}

export type SessionMetaRow = {
  userId: string | null;
  projectId: string | null;
  createdAt: number;
};

function getMetaMap(): Map<string, SessionMetaRow> {
  if (!globalThis.__piSessionMeta) {
    globalThis.__piSessionMeta = new Map();
    rebuildFromJsonl(globalThis.__piSessionMeta);
  }
  return globalThis.__piSessionMeta;
}

async function rebuildFromJsonl(_map: Map<string, SessionMetaRow>): Promise<void> {
  // M1: no-op（fork 的 .jsonl 重启时本身就是空 meta, 标 userId=null 重启）
  // 后续可扫描 <PI_WEB_DATA_DIR>/**/*.jsonl 第一行元数据
}

export function recordSessionMeta(
  realSessionId: string,
  userId: string | null,
  projectId: string | null
) {
  const map = getMetaMap();
  if (!map.has(realSessionId)) {
    map.set(realSessionId, { userId, projectId, createdAt: Date.now() });
  }
}

export function getSessionMeta(realSessionId: string): SessionMetaRow | undefined {
  return getMetaMap().get(realSessionId);
}

export function listSessionMeta(): SessionMetaRow[] {
  return Array.from(getMetaMap().values());
}

export function assertCanReadSession(
  userId: string,
  userRole: "OWNER" | "ADMIN" | "MEMBER" | null,
  sessionId: string
): boolean {
  const meta = getSessionMeta(sessionId);
  if (!meta) return false;
  if (meta.userId === userId) return true;
  if (userRole && ["OWNER", "ADMIN"].includes(userRole)) {
    // 注: M1 简化, 不做 teamId 检查（owner/admin 总可见）
    return true;
  }
  return false;
}
```

**Acceptance:**
- 导出 `recordSessionMeta`、`getSessionMeta`、`listSessionMeta`、`assertCanReadSession`
- `assertCanReadSession` 三分支：self / role IN (OWNER, ADMIN) / 否则 false
- `recordSessionMeta` 幂等（同 sessionId 已存在不覆盖）

**Test commands:** `pnpm exec tsc --noEmit lib/session-meta.ts`

---

### Task 15: projects 列表与创建路由（对应 tasks.md 3.3）

**Files:**
- Create: `app/api/projects/route.ts`

**Source artifact:** tasks.md § 3.3

**Step 1: 写 handler**

```ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { statSync } from "fs";
import { allowFileRoot } from "@/lib/allowed-roots";  // fork 已有

const prisma = new PrismaClient();

async function assertCanCreate(userId: string): Promise<{ teamId: string; role: string } | null> {
  const tm = await prisma.teamMember.findFirst({
    where: { userId, role: { in: ["OWNER", "ADMIN"] } },
  });
  if (!tm) return null;
  return { teamId: tm.teamId, role: tm.role };
}

export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });
  // M1 简化: 列 user 加入的 team 下的所有 projects
  const memberships = await prisma.teamMember.findMany({ where: { userId } });
  const teamIds = memberships.map(m => m.teamId);
  const projects = await prisma.project.findMany({ where: { teamId: { in: teamIds } } });
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const authz = await assertCanCreate(userId);
  if (!authz) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { name, root_path } = await req.json();
  if (!name || !root_path) return NextResponse.json({ error: "missing fields" }, { status: 400 });

  try {
    statSync(root_path);  // 校验路径存在
  } catch {
    return NextResponse.json({ error: "root_path does not exist" }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: { name, rootPath: root_path, teamId: authz.teamId, createdBy: userId },
  });
  allowFileRoot(root_path);  // fork 的白名单 cache
  return NextResponse.json({ project });
}
```

**Acceptance:**
- GET 401 if no `x-user-id`
- GET 返回 `{ projects: [...] }`，teamId 命中 user 的 membership
- POST 401 / 403 / 400 / 200 路径齐
- POST 创建成功后调 `allowFileRoot(root_path)` 把 root 加进 fork cache
- 路径不存在 → 400 `root_path does not exist`

**Test commands:** `pnpm exec tsc --noEmit`

---

### Task 16: projects bind 路由（对应 tasks.md 3.4）

**Files:**
- Create: `app/api/projects/[id]/bind/route.ts`

**Source artifact:** tasks.md § 3.4

**Step 1: 写 handler**

```ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { allowFileRoot, cwdValidate } from "@/lib/allowed-roots";  // 复用 fork 的 cwdValidate
import { assertWithinRoot } from "@/lib/path-safety";

const prisma = new PrismaClient();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  // membership 校验
  const tm = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: project.teamId, userId } },
  });
  if (!tm) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 路径自检
  try {
    assertWithinRoot(project.rootPath, project.rootPath);
  } catch {
    return NextResponse.json({ error: "path invalid" }, { status: 500 });
  }

  // 复用 fork 的 cwdValidate + allowFileRoot
  await cwdValidate(project.rootPath);
  allowFileRoot(project.rootPath);

  // 写 last_project_id
  await prisma.user.update({
    where: { id: userId },
    data: { lastProjectId: id },
  });

  return NextResponse.json({ ok: true, lastProjectId: id });
}
```

**Acceptance:**
- 401 / 403 / 404 / 500 / 200 路径齐
- bind 成功：user.lastProjectId = project.id, project.rootPath 进 fork cache
- 不存在 project → 404
- 非 team member → 403

**Test commands:** `pnpm exec tsc --noEmit`

---

### Task 17: sidebar cwd 改 Project 选择（对应 tasks.md 3.5）

**Files:**
- Modify: `components/sidebar/SidebarCwdInput.tsx`（fork 现有）→ 替换为 `SidebarProjectPicker.tsx`

**Source artifact:** tasks.md § 3.5

**Step 1: 创建新组件 `components/sidebar/SidebarProjectPicker.tsx`**

> 注：M1 简化版 — **直接复用 fork 现有组件 props 形态的最小替换**。具体 fork 代码形态在执行时 review，executor 必须遵循"用 fork 现有 cw 组件的相同 styled shell"原则。

示意代码（执行时按 fork 实际样式调）：

```tsx
"use client";
import { useEffect, useState } from "react";

type Project = { id: string; name: string; rootPath: string };

export function SidebarProjectPicker({ onPick }: { onPick: (p: Project) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects").then(r => r.json()).then(d => {
      setProjects(d.projects || []);
      setLoading(false);
    });
  }, []);

  async function pick(id: string) {
    const r = await fetch(`/api/projects/${id}/bind`, { method: "POST" });
    if (r.ok) {
      const p = projects.find(x => x.id === id);
      if (p) onPick(p);
    }
  }

  if (loading) return <div>Loading projects…</div>;
  return (
    <select
      onChange={(e) => pick(e.target.value)}
      className="w-full rounded border bg-bg px-2 py-1"
      aria-label="Select project"
    >
      <option value="">Select a project…</option>
      {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.rootPath})</option>)}
    </select>
  );
}
```

**Step 2: 在 fork 现有 sidebar 容器中替换 `<SidebarCwdInput />` 为 `<SidebarProjectPicker onPick={...} />`**

执行时 executor 需要：
1. `grep -r "SidebarCwdInput" components/` 定位父组件
2. 把 import 与 JSX 都换掉
3. onPick 回调接到 fork 现有 startRpcSession 调用处

**Acceptance:**
- 文件 `components/sidebar/SidebarProjectPicker.tsx` 存在
- 没有 SidebarCwdInput.tsx 的残留 import
- 选择 project 后调 `POST /api/projects/{id}/bind`，再触发 fork 现有 startRpcSession 路径
- **不**引入新 SessionBus

**Test commands:** `pnpm exec tsc --noEmit`

---

## 第 4 组：会话可见性 + 同步 + smoke（Task 4.x）

### Task 18: SSE events 路由 read-path 权限（对应 tasks.md 4.1）

**Files:**
- Modify: `app/api/agent/[id]/events/route.ts`（fork 现有）

**Source artifact:** tasks.md § 4.1

**Step 1: 在 read-path 第一行加 `assertCanReadSession`**

```ts
import { assertCanReadSession } from "@/lib/session-meta";
// ... 原 fork 代码 ...

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = req.headers.get("x-user-id");
  if (!userId) return new NextResponse("auth required", { status: 401 });

  // 找用户的最高 role（OWNER > ADMIN > MEMBER）
  const userRole = await getUserHighestRole(userId);  // 见 Step 2

  if (!assertCanReadSession(userId, userRole, id)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  // ... fork 原有 SSE 代码 ...
}
```

**Step 2: 顺带在 `lib/session-meta.ts` 加 `getUserHighestRole` helper（如未存在）**

```ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function getUserHighestRole(userId: string): Promise<"OWNER" | "ADMIN" | "MEMBER" | null> {
  const tms = await prisma.teamMember.findMany({ where: { userId } });
  if (tms.some(t => t.role === "OWNER")) return "OWNER";
  if (tms.some(t => t.role === "ADMIN")) return "ADMIN";
  if (tms.some(t => t.role === "MEMBER")) return "MEMBER";
  return null;
}
```

**Acceptance:**
- 无 user cookie → 401
- `assertCanReadSession` 返回 false → 403
- self / owner / admin → 通过
- M1 schema 中 `SessionShare` 表存在但永远读空

**Test commands:** `pnpm exec tsc --noEmit`

---

### Task 19: agent POST 路由 read-path 权限（对应 tasks.md 4.2）

**Files:**
- Modify: `app/api/agent/[id]/route.ts`（fork 现有）

**Source artifact:** tasks.md § 4.2

**Step 1: 在 POST handler 第一行加 `assertCanReadSession`**

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const userRole = await getUserHighestRole(userId);
  if (!assertCanReadSession(userId, userRole, id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // ... fork 原有 POST handler ...
}
```

**Acceptance:**
- 与 Task 18 同：401/403 路径齐

**Test commands:** `pnpm exec tsc --noEmit`

---

### Task 20: Playwright 配置（对应 tasks.md 4.3 的前置）

**Files:**
- Create: `playwright.config.ts`

**Source artifact:** tasks.md § 4.3 (Playwright 脚手架)

**Step 1: 写最小配置**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    port: 3000,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PI_WEB_JWT_SECRET: "m1-test-secret",
    },
  },
});
```

**Acceptance:**
- 文件存在
- `pnpm exec playwright --version` 能识别
- `pnpm exec playwright test --list` 列出 tests/e2e/**/*.spec.ts

**Test commands:** `pnpm exec playwright test --list`

---

### Task 21: login E2E smoke（对应 tasks.md 4.3，对应 acceptance S1.1 + S1.2）

**Files:**
- Create: `tests/e2e/login.spec.ts`

**Source artifact:** tasks.md § 4.3；design § 5.3

**TDD Note:** E2E 测试按 RED-GREEN：
1. 先把 `pnpm dev` 起服（webServer 配置已自动），写测试，run 期望 FAIL（playwright 启动失败或 selector 不存在）
2. 完成所有前置 (bootstrap-root + change-password 路由 + login 路由) 后再 run 期望 PASS

**Step 1: 写测试**

```ts
import { test, expect } from "@playwright/test";
import { execSync } from "child_process";

let rootPassword: string;

test.beforeAll(() => {
  // 重置 SQLite, 重 bootstrap-root
  execSync("pnpm run db:reset --skip-seed", { stdio: "inherit", env: { ...process.env, CI: "1" } });
  const out = execSync("pnpm exec tsx scripts/bootstrap-root.ts").toString();
  const m = out.match(/password=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("bootstrap did not output password");
  rootPassword = m[1];
});

test("login → change-password → dashboard smoke", async ({ page }) => {
  await page.goto("/");
  // 跳到 login 页
  await expect(page).toHaveURL(/\/login/);

  // 输入临时密码
  await page.getByLabel(/username/i).fill("root");
  await page.getByLabel(/password/i).fill(rootPassword);
  await page.getByRole("button", { name: /sign in|log in|登录/i }).click();

  // 必须改密
  await expect(page).toHaveURL(/\/change-password/);
  await page.getByLabel(/new password/i).fill("new-secret-pw-123");
  await page.getByLabel(/confirm/i).fill("new-secret-pw-123");
  await page.getByRole("button", { name: /change|update|保存/i }).click();

  // 进 dashboard
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
});
```

**Acceptance:**
- 文件存在
- 测试从 DB reset → bootstrap → login → change-password → dashboard 全链路通过
- `[BOOTSTRAP]` 一行能被正则解析
- 失败时 playwright trace 自动保留（trace: retain-on-failure）

**Test commands:** `pnpm exec playwright test tests/e2e/login.spec.ts`

---

### Task 22: 最小 Dockerfile build 验证（design § 5.3 acceptance）

**Files:**
- Create: `Dockerfile`

**Step 1: 写单阶段 Dockerfile**

```dockerfile
FROM node:22-slim AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec prisma generate
RUN pnpm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
```

**Acceptance:**
- `docker build -t m1-test .` 成功（无 git context 要求，build context 是 working repo）
- `docker run --rm -p 3000:3000 -v $(pwd)/data:/app/data m1-test` 启动后 stdout 含 `[BOOTSTRAP]` 行（如果 DB 空）

**Test commands:** `docker build -t m1-test .` 与 `docker run --rm -p 3000:3000 -e PI_WEB_JWT_SECRET=test-secret -v $(pwd)/data:/app/data m1-test`

> **注**：Docker build 不属于 build verify 必跑（见末尾"Build Verification"）。Dockerfile 本任务只创建文件，**不强求 build 通过 CI**；详细部署文档留 M3。

---

## Build Verification（执行完所有 22 个 Task 后必须依次跑）

按任务来源的 OpenSpec/design，executor 在跑 `comet-guard pi-web-generalized-m1-runnable build --apply` 之前必须按下列顺序执行并全部成功：

```bash
# 1. 数据库迁移（增量 + 应用到 dev.db）
pnpm run db:migrate

# 2. Prisma client 重生成
pnpm run db:generate

# 3. 类型检查
pnpm exec tsc --noEmit

# 4. 单元测试（含 path-safety 与任何 .test.ts）
pnpm exec vitest run

# 5. E2E smoke
pnpm exec playwright test

# 6. 生产构建
pnpm run build

# 7. （可选）Docker build — 本 M1 不强制
# docker build -t m1-test .
```

期望输出：
| 步骤 | 期望 |
|---|---|
| `db:migrate` | exit 0, 产出 `prisma/migrations/<timestamp>_init/migration.sql` 与 `data/dev.db` |
| `db:generate` | exit 0, 产出 `node_modules/.prisma/client/index.d.ts` |
| `tsc --noEmit` | 无错误（warning 可接受） |
| `vitest run` | 所有 `.test.ts` PASS；coverage 报告打印 |
| `playwright test` | login.spec.ts PASS；trace 在 `test-results/` 留存 |
| `pnpm run build` | `.next/` 产出，无 TS 错误，无 Prisma generate 缺失错误 |

**任何一步失败**：按 comet-build 规定，加载 `superpowers:systematic-debugging` skill 排查根因，不得直接提交绕过。

---

## Handoff 与 Commit 收尾

按 build executor 实际是否有 git 决定：

- **有 git**：每个 Task 的"完成"伴随 `git commit -m "<type>: <task-id> <short>"`（类型 = feat/fix/test/chore/docs；task-id = `1.1`/`2.4` 等）。提交信息参考 `ecc/common/git-workflow.md`。Attribution 按用户设置关闭。
- **无 git**：把所有 commit 消息累加到 `docs/superpowers/handoff/commit-log.md`（executor 自维护），末尾标注 "ready for repo init"。

---

## 任务 → 验收交叉对照表

| tasks.md item | 本计划 Task | Acceptance 引用 |
|---|---|---|
| 1.1 | Task 1 | prisma validate |
| 1.2 | Task 2 | pnpm install |
| 1.3 | Task 3 | pnpm run db:migrate --help |
| 1.4 | Task 4 | 文件存在 |
| 1.5 | Task 4 | data/.gitkeep |
| 2.1 | Task 5 | tsc |
| 2.2 | Task 6 | tsc |
| 2.3 | Task 7 | bootstrap root 日志 |
| 2.4 | Task 8 | tsc + 手动 curl |
| 2.5 | Task 9 | tsc + 手动 curl |
| 2.6 | Task 10 | tsc |
| 2.7 | Task 11 | tsc + change-password 后 mustChangePassword=false |
| 3.1 | Task 12 | tsc（覆盖率见 3.2） |
| 3.2 | Task 13 | vitest 5 case pass |
| 3.3 | Task 15 | tsc + 手动 curl |
| 3.4 | Task 16 | tsc + 手动 curl |
| 3.5 | Task 17 | tsc |
| 4.1 | Task 18 | tsc |
| 4.2 | Task 19 | tsc |
| 4.3 | Task 21 | playwright login.spec.ts pass |

注：tables 中 `tsc` 都是 `pnpm exec tsc --noEmit`（不发射文件，只验证）；具体逐文件命令见各 Task 的 "Test commands" 小节。
