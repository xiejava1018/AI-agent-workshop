---
comet_change: pi-web-generalized-m1-runnable
role: technical-design
canonical_spec: openspec
archived-with: 2026-07-13-pi-web-generalized-m1-runnable
status: final
---

# 设计文档 — M1 通用 web 多用户 AI agent 工作台

> Language: zh-CN
> 反链上游：[proposal.md](../changes/pi-web-generalized-m1-runnable/proposal.md)、[design.md](../changes/pi-web-generalized-m1-runnable/design.md)、[tasks.md](../changes/pi-web-generalized-m1-runnable/tasks.md)、6 个 capability spec、脑暴记录 [brainstorm-summary.md](../changes/pi-web-generalized-m1-runnable/.comet/handoff/brainstorm-summary.md)、交接包 design-context.{json,md}。

本设计文档是基于 OpenSpec open 阶段产物的**深化**，不是替代：高层架构决策、Cap 选项、根取舍已在 `openspec/changes/pi-web-generalized-m1-runnable/design.md` v2 中记录。

---

## 1. 范围与上下文

M1 范围在 fork 之上叠加多用户封装层。代码实操落地路径（**注**：在 build 阶段以 git remote/子路径确定；M1 文档不假定具体合并方式）：

- 仓库根 `/Users/xiejava/AIproject/AI-agent-workshop/` 作为 OpenSpec change 与 markdown docs 的存放位置
- fork 仓库 `/Users/xiejava/AIproject/pi-web/`（[xiejava1018/pi-web](https://github.com/xiejava1018/pi-web) clean fork of agegr/pi-web v0.7.11）作为 fork origin
- 在 build 阶段建立 fork 与主仓库的同步策略（M1 范围里还没涉及，待 build 时按 superpowers:using-git-worktrees 与 working-tree 审视决定）

**本设计文档的目的**：把 OpenSpec open 阶段的"做什么、cap 选项"落到"具体怎么落地、数据流、边界条件、测试策略"。

---

## 2. 架构与数据流

### 2.1 模块图（fork 之上）

```
                         Browser
                            │
                            ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Next.js 16 App Router (fork pi-web)                   │
   │                                                         │
   │   app/(shell)         middleware.ts (新增)              │
   │   ├── login/page         ↳ decode JWT → x-user-id header│
   │   ├── change-password                                    │
   │   └── dashboard          例外: /api/auth/*              │
   │                                                         │
   │   app/api (fork 28 路由)                               │
   │   ├── auth/user-login (新增)                             │
   │   ├── auth/user-logout (新增)                           │
   │   ├── auth/change-password (新增)                       │
   │   ├── auth/{providers,login,logout,...} (fork 保持)    │
   │   ├── projects/route.ts (新增)                          │
   │   ├── projects/[id]/bind/route.ts (新增)                │
   │   ├── agent/[id]/events (fork; 加 assertCanReadSession) │
   │   ├── agent/new (fork; cwd 改 Project)                  │
   │   └── ... 28 个路由 (fork 保持)                         │
   └─────────────────────────────────────────────────────────┘
              │                                       │
              ▼                                       ▼
   ┌──────────────────────────┐         ┌───────────────────────────────┐
   │ SQLite via Prisma (新增) │         │ pi-coding-agent SDK (fork)    │
   │   users                  │         │   rpc-manager.ts             │
   │   teams                  │         │   session-reader.ts           │
   │   team_members           │         │   allowed-roots.ts           │
   │   projects               │         │   file-access.ts              │
   └──────────────────────────┘         └───────────────────────────────┘
                                                       │
                                                       ▼
                                              .jsonl on filesystem
                                              ~/.pi/agent/sessions/*
```

### 2.2 数据流一：用户登录

```
用户 POST /api/auth/user-login {username, password}
       │
       ▼
[handler] lib/auth-provider.ts::LocalPasswordAuthProvider.authenticate
       │
       ├─ prisma.user.findUnique({username})
       │   未找到? prisma.user.create({username, password_hash: bcrypt()})
       │
       ├─ bcrypt.compare(password, password_hash)
       │
       ├─ sign JWT (jose) { sub: userId, exp: now+15min }
       │
       └─ response 200 + Set-Cookie "pw_at=<jwt>; HttpOnly; Path=/"
       │
       ▼
   重定向至 /  (若是 root + must_change_password=true → /change-password)
```

### 2.3 数据流二：AgentSession 创建

```
用户 POST /api/agent/new { type: "ensure_session" }  (cwd 留空, 用 last_project_id)
       │
       ▼
[middleware] 解 JWT → 注入 x-user-id header
       │
       ▼
[handler] app/api/agent/new/route.ts (fork)
       ├─ 读 x-user-id → user
       ├─ 读 prisma.user.findUnique(user.id).last_project_id
       ├─ 不存在 → 400 "no project selected"
       ├─ 读 projects.findUnique(last_project_id) → 校验 active
       ├─ cwd = project.root_path
       ├─ lib/session-meta.recordSessionMeta(tempKey, user.id, project.id)   ← 新增
       ├─ allowFileRoot(cwd)  (复用 fork lib/file-access.ts)                  ← 已有
       │
       ├─ startRpcSession(tempKey, "", cwd, ...) → RpcSessionWrapper
       │
       └─ response { sessionId: realId, ... }
```

### 2.4 数据流三：SSE 事件流 (单用户多 tab fan-out)

```
browser tab A        browser tab B
   │                    │
   GET /events/A          GET /events/B (same sessionId)
   │                    │
   ▼                    ▼
[middleware 解 JWT]   (同样)
   │                    │
   ▼                    ▼
[handler fork app/api/agent/[id]/events]
   ├─ assertCanReadSession(user, id)                  ← 新增（仅一行）
   │     ├─ read lib/session-meta.get(id)
   │     ├─ 若 userId === user.id → 通过
   │     ├─ 若 userRole IN ('OWNER','ADMIN') [WHERE team match] → 通过
   │     └─ 若 userId IN session_shares.shared_with_user_id → 通过
   │
   ├─ getRpcSession(id) 或 startRpcSession(id, file)
   │     ← 复用 fork rpc-manager
   │
   ├─ const unsubscribe = session.onEvent(e => encode(e))
   │     ← fork 已有; B 端打开时也 register 同一个 subscriptions set
   │
   └─ stream SSE
        heartbeat 30s, cleanup on req.signal.abort
```

### 2.5 数据流四：路径白名单

```
UI: user 选 Project P1, 调 POST /api/projects/[id]/bind
       │
       ▼
[handler] app/api/projects/[id]/bind/route.ts (新增)
   ├─ assertCanReadProject(user, id)
   ├─ assertWithinRoot(project.root_path, project.root_path)  (自检)
   ├─ allowFileRoot(project.root_path)                        (写入 fork cache)
   ├─ prisma.user.update(last_project_id = project.id)
   └─ response 200

UI: agent session 想读 file /api/files/P1/src/index.ts
       │
       ▼
[handler] lib/file-access.ts (fork) 读 path → assertWithinRoot(...)
       ├─ 若 root 在 globalThis.__piAdditionalAllowedRoots → 通过
       └─ 否则 403  (fork 既有行为)
```

---

## 3. 关键技术细节

### 3.1 Prisma schema (v1)

```prisma
model User {
  id                 String   @id @default(cuid())
  username           String   @unique
  passwordHash       String   // bcryptjs
  mustChangePassword Boolean  @default(false)
  lastProjectId      String?  // 装填: 上一次选的 Project
  createdAt          DateTime @default(now())
  teams              TeamMember[]
}

model Team {
  id          String   @id @default(cuid())
  name        String
  ownerUserId String   // creator
  createdAt   DateTime @default(now())
  members     TeamMember[]
  projects    Project[]
}

model TeamMember {
  teamId   String
  userId   String
  role     Role     @default(MEMBER)
  joinedAt DateTime @default(now())
  team     Team @relation(fields: [teamId], references: [id])
  user     User @relation(fields: [userId], references: [id])
  @@id([teamId, userId])
}

enum Role { OWNER ADMIN MEMBER }

model Project {
  id        String   @id @default(cuid())
  teamId    String
  name      String
  rootPath  String   // 唯一 (teamId, rootPath) 防重复
  createdBy String
  createdAt DateTime @default(now())
  team      Team @relation(fields: [teamId], references: [id])
  @@unique([teamId, rootPath])
}
```

### 3.2 middleware.ts (Next.js)

```ts
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SECRET = process.env.PI_WEB_JWT_SECRET || "";  // M1 placeholder

export const config = {
  // 拦截 /api/* 但放过 /api/auth/* + /api/bootstrap/*
  matcher: ["/api/((?!auth/|bootstrap/).*)"],
};

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get("pw_at")?.value;
  if (!cookie) return new NextResponse(JSON.stringify({ error: "auth required" }), { status: 401 });
  try {
    const { payload } = await jwtVerify(cookie, new TextEncoder().encode(SECRET));
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-user-id", String(payload.sub));
    // M1: 简化, M2 才解码完整 teams
    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    return new NextResponse(JSON.stringify({ error: "invalid session" }), { status: 401 });
  }
}
```

注：`PI_WEB_JWT_SECRET` 在 M1 是单 secret。M2 接 AuthProvider 抽象后, secret 可能来自 KMS。

### 3.3 路径白名单 (`lib/path-safety.ts`)

```ts
import { realpathSync } from "fs";
import { resolve, normalize, isAbsolute } from "path";

export class PathTraversalError extends Error {
  constructor(public readonly input: string, public readonly root: string) {
    super(`path outside root: ${input} not within ${root}`);
  }
}

export function assertWithinRoot(input: string, root: string): string {
  const fullInput = isAbsolute(input) ? normalize(input) : resolve(root, input);
  const fullRoot = resolve(root);
  const realInput = (() => { try { return realpathSync(fullInput); } catch { return fullInput; } })();
  const realRoot = realpathSync(fullRoot);
  const rel = require("path").relative(realRoot, realInput);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathTraversalError(input, root);
  }
  return realInput;
}
```

### 3.4 Session metadata (`lib/session-meta.ts`)

```ts
declare global {
  var __piSessionMeta: Map<string, SessionMetaRow> | undefined;
}

type SessionMetaRow = {
  userId: string | null;          // null = 匿名（server restart 残留）
  projectId: string | null;
  createdAt: number;
};

function getMetaMap(): Map<string, SessionMetaRow> {
  if (!globalThis.__piSessionMeta) {
    globalThis.__piSessionMeta = new Map();
    rebuildFromJsonl(globalThis.__piSessionMeta);  // server 启动时被动重建
  }
  return globalThis.__piSessionMeta;
}

export function recordSessionMeta(realSessionId: string, userId: string | null, projectId: string | null) {
  const map = getMetaMap();
  if (!map.has(realSessionId)) {
    map.set(realSessionId, { userId, projectId, createdAt: Date.now() });
  }
}

export function getSessionMeta(realSessionId: string): SessionMetaRow | undefined {
  return getMetaMap().get(realSessionId);
}
```

未来 M2 加接口化 (`interface SessionMetaStore`) 让 Prisma row 替代内存 Map。

### 3.5 三路并集查询（Prisma query 形态）

```ts
// GET /api/sessions
async function listVisibleSessions(userId: string) {
  const me = await prisma.user.findUnique({ where: { id: userId }, include: { teams: { include: { team: true } } } });
  const teamIds = me.teams.map(tm => tm.teamId);
  const adminOrOwnerTeams = me.teams.filter(tm => ["OWNER","ADMIN"].includes(tm.role)).map(tm => tm.teamId);

  // 注: current SessionInfo from fork 仅列 cwd + name; 我们通过 cwd JOIN project via teamId 关联 team
  return listAllSessions()  // fork 现有
    .filter(s => {
      // 与 session-meta 的 userId 字段比对
      const meta = getSessionMeta(s.id);
      const createdByUser = meta?.userId === userId;
      const isAdminVisible = (s.projectRoot && /* project.teamId in adminOrOwnerTeams */);
      const isShared = /* M2 reserved, M1 永 false */;
      return createdByUser || isAdminVisible || isShared;
    });
}
```

M1 简化: `createdByUser || isAdminVisible`, **没 isShared** (M1 schema 留表, 读空)。

---

## 4. 边界与错误处理

### 4.1 AuthProvider authenticate 失败策略

- 用户不存在 vs 密码错 → **统一错误** "invalid credentials"（不告诉用户存在与否）
- bcryptjs compare 失败抛错 → 500
- DB 连不上 → 500

### 4.2 Middleware race conditions

- 多个请求并发 → jwtVerify 各自独立，无共享状态
- Session cookie 被多 tab 共享 → 正常访问所有 tab

### 4.3 Path safety 边界

- 路径不存在 → realpathSync 抛 ENOENT → `assertWithinRoot` 抛 PathTraversalError（fallback）
- 非授权 root 但是非符号链接 → realpathSync 返回实际路径，比 relative 检查正常处理
- 路径含 null byte → 不允许，ENAMETOOLONG 或 EILSEQ

### 4.4 Session list 性能

- fork 现有 `globalThis.__piSessionListPromise` 单例保护 + `loadAllSessions` 一次性扫描
- 我们在 list 阶段增加 memory Map 查 userId；不开新表，单进程内 O(1) 查询
- 1000 sessions 量级：listVisibleSessions 单次 < 50ms（M1 不做 N+1 benchmark）

### 4.5 Server restart 残留 session

- jsonl 依然存在，memory meta 没了 → rebuild 阶段标 userId=null
- 用户主动触发该 session（`/api/agent/S/events`）→ admin 看到 403，member 看到 403
- recordSessionMeta 只在 metadata 不存在时 set；重启后第一次访问 → 写入新 user_id
- **风险**：member 创建的匿名 session，admin 删除账号后 userId 错了 → 标"找不到 user_id"；M2 加 inconsistency cleanup task

---

## 5. 测试策略

### 5.1 单元测试（Vitest）

| 模块 | 用例 |
|---|---|
| `lib/path-safety.ts` | `..` 路径; 符号链接指向外; 绝对路径越界; URL 编码; null byte; 合法路径规范化 |
| `lib/auth-provider.ts` (LocalPasswordAuthProvider) | 登录成功; 失败密码返回 invalid; 切换实现类 |
| `lib/session-meta.ts` | record idempotent; get miss; meta persistence across same process |

### 5.2 Playwright E2E (UI smoke)

| Spec | 验证内容 | 依赖 |
|---|---|---|
| `login.spec.ts` | `/` → 跳 `/login` → 输入 root 临时密码 → `/change-password` → 改密 → `/dashboard` 可见 | 起 dev server + 一份干净 SQLite |
| `project.spec.ts` (M2) | 添加 Project → 选 Project → bind → list | M2 用 LLM mock fixture |

### 5.3 Manual smoke checklist（M1 验收）

- [ ] `pnpm db:migrate && pnpm dev` 启动有 `[BOOTSTRAP] root username=root password=...` 日志
- [ ] `/` 跳 `/login`；输入 root + 临时密码 → 进 `/change-password`
- [ ] 改密后进 dashboard
- [ ] 创建一个 Project (host 路径)；能正确 bind
- [ ] `POST /api/agent/new` (cwd 已 bind) → sessionId 返回
- [ ] `GET /api/agent/S/events` → SSE 流；不同 tab 同时订阅都收到
- [ ] `assertWithinRoot("../../etc/passwd")` → 单测通过

---

## 6. 性能与可靠性

### 6.1 In-process 模型约束

- pi 的 AgentSession 是不可重入常驻对象；M1 不上 50 session 全局硬限额（M2 上）
- 单 server 500 sessions 内是 deadline；M2 才加 per-user 信号量

### 6.2 SQLite 并发

- SQLite WAL 模式默认开启；Prisma 用 transaction
- 多进程需要 → M3 切 Postgres；M1 不引入

### 6.3 SSE 心跳

- fork 现有 30s heartbeat（已实现）；M1 不引入新规约
- Last-Event-ID 重连 → M3

### 6.4 文件路径 I/O

- assertWithinRoot 默认同步 fs.realpath；O(1) per call
- 1000 个 session × 100 files/session = 100k realpath calls/s；没问题

---

## 7. 不在本 design 范畴

- sandbox runtime, multi-process, load balancing → M3+
- SAML/OIDC/GitHub OAuth → M2 接口已留
- Access + refresh 双 token → M2
- Share dialog → M2
- 50 session 全局硬上限 + per-user 信号量 → M2
- Postgres → M3
- axe-core a11y → M3
- i18n 实际内容（中文） → M3

---

## 8. Open Questions

- `PI_WEB_JWT_SECRET` 默认值如何？M1 启动时生成并 `.env` 写入？还是必须用户设置？
- middleware matcher 的 Next.js 16 实际语法要 review（path-to-regexp v6+？）
- fork 在 v0.7.11 后是否会改 `RpcSessionManager` 接口？锁版本号是必须的，但 follow upstream 安全补丁策略 M1 不必建

---

## 9. 决策可逆性

| 决策 | 可逆成本 | 不可逆后果 |
|---|---|---|
| 内存 Map 存 session meta | 低：M2 替换为 Prisma 实现 | 无 |
| Middleware 默认拦截 /api/* | 中：matcher regex 错误要重写 | 无（fail-open 401 可以立刻被 CI 抓住） |
| assertWithinRoot 同步 fs.realpath | 低：M2/M3 换异步不破坏接口 | 无 |
| bcryptjs cost=10 | 低：M2 改 cost | 无 |
| cuid ID | 中：迁移 | 无 |
| Session cwd 锁死创建时 | 低：M2 让 session 显式 updateProject | 无 |

---

## 10. References

- 上游设计: [design.md](../changes/pi-web-generalized-m1-runnable/design.md) — 高层方案框架
- 上游任务: [tasks.md](../changes/pi-web-generalized-m1-runnable/tasks.md) — 18 个 task, 4 大组
- 脑暴记录: [brainstorm-summary.md](../changes/pi-web-generalized-m1-runnable/.comet/handoff/brainstorm-summary.md) — Q1-Q4 + Spec Patches
- 交接包: [design-context.md](../changes/pi-web-generalized-m1-runnable/.comet/handoff/design-context.md) — OpenSpec 摘录
- fork 调研: [xiejava1018/pi-web](https://github.com/xiejava1018/pi-web) v0.7.11
- 上游 OpenSpec 主要 capability: `multi-tenant-team-model`, `auth-provider-user`, `project-and-path-safety`, `agent-session-in-process`, `bootstrap-root-owner`, `runnable-harness`
