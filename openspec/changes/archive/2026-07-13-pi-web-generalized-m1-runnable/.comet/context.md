# Comet Design Handoff

- Change: pi-web-generalized-m1-runnable
- Phase: design
- Mode: compact
- Context hash: b6cc83d48548eef88c2f8f4c545261e8c7f55ea5be902686a0c1996210edb8ec

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/pi-web-generalized-m1-runnable/proposal.md

- Source: openspec/changes/pi-web-generalized-m1-runnable/proposal.md
- Lines: 1-58
- SHA256: 89d4e8a80766e474285fa0308cb2d66cb71d668986fa7eccb3c4f06ff1769406

```md
# M1 通用 web 多用户 AI agent 工作台 - 能跑通

> 产物语言：**zh-CN**
> change 路径：`openspec/changes/pi-web-generalized-m1-runnable/`
> **上游仓库**：[xiejava1018/pi-web](https://github.com/xiejava1018/pi-web)（clean fork of [agegr/pi-web](https://github.com/agegr/pi-web)，v0.7.11），被我们作为基础仓库参考与改造起点。
> 上游设计沉淀（反链，不动）：
> - `pi-web.md` — pi-web 产品 entity 页
> - `pi-web-multi-tenant-ai-minisoc-design.md` — AI-miniSOC 嵌入式集成原始设计
> - `docs/plans/2026-07-12-pi-web-generalized-design.md` — 通用化版本设计（上游主源）
> - `/Users/xiejava/AIproject/pi-web/` — 实际 fork 仓库的本地路径

## Why

把已存在的 `pi-web`（fork of [agegr/pi-web](https://github.com/agegr/pi-web)，v0.7.11）封装为**多人共享、单进程、Team 隔离**的 web 工作台起步版本。pi-web 已经实现了 70% 的基础设施（Next.js 16、React 19、AgentSession 接入、SSE、`allowed-roots` 路径白名单、provider auth），但它是**单用户单进程**前提 —— 没有 user auth、Team 模型、Project 概念。M1 缺口：**user auth 层、Team/Project/ProjectBinding 数据层、会话三路并集可见性、UI cwd 改 Project 选**。

剥离 AI-miniSOC 业务耦合、抽到通用形态，是本里程碑的目标。**不是发布产品**，是验证"现成 fork + 多用户封装 = 起步版本"的可行性。

## What Changes

- **基于 fork 改造**：本 change 不重写 pi-web；所有新逻辑以"新增 / 替换 / 包装"形式落到 fork 上
- **新增** User auth 层：bcryptjs 哈希 + JWT + HttpOnly cookie（**与 pi-web 现有 model provider auth 共存**）
- **新增** Prisma + SQLite 数据层：在 fork 之上引入 ORM；现有 `.jsonl` 会话格式**保留**（不重写）
- **新增** 数据库表：`users` / `teams` / `team_members` / `projects`（其余表 schema 预留，M2 启用）
- **新增** `AuthProvider` 接口与 `LocalPasswordAuthProvider` MVP 实现，**不实现** SAML/OIDC/OAuth，但接口位必须留
- **新增** 首启动自动生成 `root` owner + 随机临时密码到启动日志
- **新增** `Project` + `assertWithinRoot` 在 `allowed-roots.ts` 之上叠加：路径穿越依然拦下（白名单=只允 Project.root_path 内）
- **新增** 全局 `middleware.ts` 拦截除 `/api/auth/user-login`、`/api/bootstrap/status`、`/` 之外的请求，要求带 user session cookie
- **修改** `app/api/agent/[id]/events` SSE 端点的 read-path：先做 user 权限校验（user = session.user_id OR role IN (owner, admin)）
- **修改** cwd 注入：把 UI 的 cwd 自由选择改为 Project 选择，后端沿用现有 `cwd/validate` + `allowFileRoot` 链路
- **新增** Playwright 脚手架 + Dockerfile single-stage + i18n 占位（`next-intl`，M1 仅英文，M3 上双语）
- **保留** pi-web 现有 model provider auth 接口与 `~/.pi/models.json` 兼容
- **保留** 所有内部 ID 为 string/cuid（不自增）
- **不改** `rpc-manager.ts`、`session-reader.ts`、UI 组件结构（任务 5.1-5.3 已经在 fork 内）
- **不做** Model Provider 加密（Key 在 M1 由 pi-web 自己存，M2 接管）；不做 access + refresh 双 token（M2）；不做 Share dialog / 搜索 / Admin UI（M2/M3）；不做 SSE `Last-Event-ID` 重连（M3）；不做 webhook 钩子（M3）；不做 50 session 全局硬上限 / per-user 信号量（M2）

## Capabilities

### New Capabilities

- `multi-tenant-team-model`: Team / TeamMember / User 三表，含 `role` 在 `team_members` 上而非 `users.role`、用户可加入多 Team
- `auth-provider-user`: 与 pi-web 现有 model provider auth 并存的 user auth；`AuthProvider` 接口与 `LocalPasswordAuthProvider` MVP
- `project-binding`: `Project` 表 + `assertWithinRoot` 在 `lib/allowed-roots.ts` 之上的接入层；UI cwd 改为 Project 选择
- `bootstrap-root-owner`: 首启动自动生成 root owner + 随机临时密码写日志
- `session-visibility-three-way`: session 列表查询走"自己创建 OR 被分享 OR owner/admin"三路并集
- `runtnable-harness`: Playwright 脚手架 + Dockerfile single-stage + i18n `next-intl` 占位骨架（M1 中通过"现有项目增量添加"形态）

### Modified Capabilities

（仓库内尚无既存 spec，因此无 modified 项）

## Impact

- **Affected code**：在 fork 之上叠加，不重写 pi-web 现有代码；新增/修改点集中在 `prisma/`、`app/api/auth/user-login/`、新增的 `middleware.ts`、`lib/auth-provider*.ts`、`lib/path-safety.ts`、`lib/session-bus.ts`、UI 的 cwd 选择控件
- **New packages**：Prisma + `@prisma/client`、`bcryptjs`、`jose`、`async-mutex`、`next-intl`、`@playwright/test`、`@axe-core/playwright`
- **Database**：SQLite 在 fork 之上的 dev data 目录（建议 `data/dev.db`），`prisma migrate` 跑出首版 schema；`.jsonl` 会话文件落 `<data_dir>/users/<user_id>/sessions/<sid>.jsonl`（project_id 暂未引入 `agent_sessions.team_id`，M2 再加）
- **DEPLOYMENT**：Dockerfile single-stage，SQLite 数据目录挂载说明；本 M1 不上 docker-compose（等 M3 Postgres）
- **Reuse**：`@earendil-works/pi-coding-agent` SDK（直接复用 fork 的 `lib/rpc-manager.ts` 接法）、`@earendil-works/pi-ai`、`allowed-roots.ts`、`session-reader.ts` 全部不动
- **Tests**：Vitest 单元测试覆盖 `assertWithinRoot`；Playwright smoke test 覆盖 S1.1-S1.6 中的关键 2 个

```

## openspec/changes/pi-web-generalized-m1-runnable/design.md

- Source: openspec/changes/pi-web-generalized-m1-runnable/design.md
- Lines: 1-123
- SHA256: b81cd24a11942bfc35cb7fa2f9aa360443e24e8220542e9486eb4e90eaa77fd3

[TRUNCATED]

```md
# M1 Design: 通用 web 多用户 AI agent 工作台

> 产物语言：**zh-CN**
> 反链上游设计：`docs/plans/2026-07-12-pi-web-generalized-design.md`
> **基于 fork**：本地 `/Users/xiejava/AIproject/pi-web/`（[xiejava1018/pi-web](https://github.com/xiejava1018/pi-web) v0.7.11，clean fork of agegr/pi-web）

## Context

- **当前状态**：仓库根有两份 markdown 资料 + `docs/plans/...` 通用版 Design Doc。`/Users/xiejava/AIproject/pi-web/` 是干净的 v0.7.11 fork（与 upstream 一致，**无用户私有 commit**），已经具备 Next.js 16 + React 19 + App Router + 全部 API 路由骨架 + `lib/rpc-manager.ts`（36KB 多 session 管理）+ `lib/allowed-roots.ts`（白名单）+ `lib/session-reader.ts` + `components/` 17 个目录的完整前端。
- **改造成果**：本 change **不重写** pi-web，**只在 fork 之上叠加一层多用户封装**。fork 已有的部分（除"加 user auth 中间件"和"加权限校验到 SSE 端点"和"UI cwd 改 Project 选"之外）**保持原样**。
- **核心约束**：9 项硬约束（路径白名单、.jsonl 不重写、不动 pi 源码、ID 用 string、AuthProvider 抽象、root bootstrap 等）必须继续成立。
- **Stakeholders**：自托管小团队 admin（首个 root owner）、团队成员、agent session 嵌入方。

## Goals / Non-Goals

**Goals**：
- 在 fork 之上引入 user auth 层（与 fork 现有 model provider auth 共存）
- 引入 Prisma + SQLite，写首版 schema
- 新增 `Project` 模型与 `assertWithinRoot` 接入，把 UI 的 cwd 自由选择改为 Project 选择
- 全局 `middleware.ts` 拦截 `/api/*`（除 `/api/auth/user-login`、`/api/bootstrap/status`、`/`）
- SSE `/api/agent/[id]/events` read-path 加权限校验
- Playwright 脚手架 + Dockerfile + i18n 占位

**Non-Goals**：
- 不重写 pi-web 现有 `lib/`、`app/api/{agent,files,worktrees,skills,...}`、`components/` 任何代码
- 不引入 model provider 加密 / Team 共享 Provider（M2）
- 不上 access + refresh 双 token；M1 用 session cookie 临时方案（M2）
- 不上 Share dialog / 搜索 / 50 session 全局硬限额 / per-user 信号量（M2/M3）
- 不上 SSE `Last-Event-ID` 重连（M3）
- 不上 Postgres（dev/prod 均为 SQLite；M3 才考虑）

## Decisions

### D1. 改造形态：在 fork 之上叠加，不重写

**Why**：fork 已经覆盖 70% 基础设施，本 change 的目标是"多用户封装层"。从零搭会抛弃 fork 已实现的高质量代码（特别是 `lib/rpc-manager.ts` 的多 session 调度与 `lib/session-reader.ts` 的 .jsonl 解析）。

**How**：所有新增文件落到 fork 标准目录布局下；不改 fork 已存在的同名文件，除非明确在 "What Changes" 列出（如 SSE 端点 read-path 权限校验）。

### D2. 与 fork 现有 model provider auth 共存 —— **不接管**

**Why**：fork 现有的 `/api/auth/login/[provider]` 是 OAuth Provider 登录（Anthropic 等），用于驱动 `~/.pi/models.json` 的 key 管理。这是 fork 自身的功能（**多用户也可以共享这些 model**）。本 M1 的 User auth 层独立于 model provider auth 存在。

**M1 形态**：
- `/api/auth/user-login` —— 新增，用户名密码登录，签 user JWT，写 HttpOnly cookie
- `/api/auth/providers`、`/api/auth/login/[provider]` —— 保留，model provider OAuth（**任意登录用户用同一份 key**）
- `must_change_password` 标志仅用于 user 维度，不影响 model 维度

**M2/M3 接管**：
- `model_providers` 表存 `api_key_encrypted`（AES-256-GCM），`model_provider_id` 在 `team_id` 范围下
- fork 现有 `/api/auth/api-key/[provider]` 演化为"读/写 team 共享 provider 的 key"接口

### D3. Prisma + SQLite

**Why**：fork 本身不引入 ORM（`.jsonl` 是文件系统）；user / team / project 表需要关系建模。Prisma 文档与社区最强；SQLite 起步免运维。

**Where**：`prisma/schema.prisma`、`prisma/migrations/`、`.env.example` 含 `DATABASE_URL=file:./data/dev.db`。

### D4. cuid ID（string），不自增

**Why**：未来接外部账号系统预留位。

### D5. assertWithinRoot 接入 fork 的 `allowed-roots`

**Why**：fork 已有的 `allowFileRoot(path)` + globalThis cache 是"允许"语义。我们需要"用户请求 path → 校验是否在 user 的某个 Project.root_path 内"的**主动校验**语义。

**How**：在 `lib/path-safety.ts` 新增 `assertWithinRoot(absolutePath, rootPath): string`，对**任何** path 参数（新 file route、CWD 注入、UI 文件浏览器 fetch）调一次；同时 `Project` 创建时调 `allowFileRoot(root_path)`，让 fork 现有 file router 自动放行。

**避免重复**：保留 fork 的 `allowed-roots.ts` 行为 —— 不动 globalThis cache 的逻辑，只在新增的 helper 函数层加白名单校验。

### D6. SessionBus 在 `lib/rpc-manager.ts` 之上叠加，不重写

**Why**：fork 已经有完整的 RPC session 管理（`getRpcSession`、`startRpcSession`）。**M1 不需要新写 SessionBus**——M1 的多用户需求只是"在 fork 已有 RPC 基础上加 read-path 权限校验"。

**Where**：仅在 `app/api/agent/[id]/events/route.ts` 入口加权限校验；在 `/api/agent/[id]/route.ts` 加权限校验。

**Per-session mutex（M1 不上）**：fork 已有的 `startRpcSession` 内部已有串行锁（M1 不需要新加）。M2 上一层 `Map<sessionId, Promise<void>>` 也是不需要的（复用 fork 内置即可）。

### D7. 全局 `middleware.ts` 拦截 /api/*


```

Full source: openspec/changes/pi-web-generalized-m1-runnable/design.md

## openspec/changes/pi-web-generalized-m1-runnable/tasks.md

- Source: openspec/changes/pi-web-generalized-m1-runnable/tasks.md
- Lines: 1-42
- SHA256: 90865c02fc2e5168e9f61a99ea5f5d5e557d5917e8bbef01f69c1c025e905d63

```md
# M1 Tasks: 在 fork 之上叠加 — 通用 web 多用户 AI agent 工作台

> 产物语言：**zh-CN**
> 基于 fork：`xiejava1018/pi-web` v0.7.11（本地 `/Users/xiejava/AIproject/pi-web/`）。
> 4 大组共 18 个任务，按依赖排序。每个任务规模控制在单一 session 内（≤2 小时）。

## 1. 项目基础叠加（不重写 fork）

- [ ] 1.1 在 fork 仓库根创建 `prisma/schema.prisma`；包含 `users` / `teams` / `team_members` / `projects`，全部 ID 用 `String @id @default(cuid())`；`team_members.role` 用 enum `OWNER | ADMIN | MEMBER`
- [ ] 1.2 安装依赖：`prisma` + `@prisma/client` + `bcryptjs` + `jose` + `async-mutex` + `next-intl` + `@playwright/test` + `@axe-core/playwright`；在 `package.json` 锁定 `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-ai` 版本（不带 `^`）
- [ ] 1.3 配置 `package.json` 脚本：`db:migrate` = `prisma migrate dev`、`db:generate` = `prisma generate`、`start` = 预先 `scripts/bootstrap-root.ts` 后 `next start`
- [ ] 1.4 创建 `.env.example`，含 `DATABASE_URL=file:./data/dev.db`、`PI_WEB_DATA_DIR=./data`、`PI_WEB_MASTER_KEY=`
- [ ] 1.5 创建 `data/.gitkeep`，README 强调 `-v $(pwd)/data:/app/data` 持久化

## 2. User auth 层（AuthProvider + root bootstrap）

- [ ] 2.1 创建 `lib/auth-provider.ts` 接口：`AuthProvider { authenticate, revoke }` 与 DI 工厂
- [ ] 2.2 创建 `lib/auth-provider-local.ts`：`LocalPasswordAuthProvider` 使用 bcryptjs（cost=10）+ jose 签 JWT；首次登录强制改密
- [ ] 2.3 创建 `scripts/bootstrap-root.ts`：`prisma.user.count() === 0` 时 create root + 随机密码（≥16B URL-safe base64）→ bcrypt 哈希入库 → stdout 写 `[BOOTSTRAP] root username=root password=<secret>` 一行
- [ ] 2.4 创建 `app/api/auth/user-login/route.ts`：调 `provider.authenticate`；签 JWT（15min）；写 HttpOnly cookie `pw_at`
- [ ] 2.5 创建 `app/api/auth/user-logout/route.ts`：清 cookie、调 `provider.revoke`
- [ ] 2.6 创建 `middleware.ts`（根目录）：拦截除 `/`、`/api/auth/user-login`、`/api/auth/user-logout`、model provider auth（`/api/auth/{providers,login,logout,all-providers,api-key}`）、静态资源外的 `/api/*`；解码 JWT 写 `req.user`；root user 加 `must_change_password=true` 标志
- [ ] 2.7 创建 `app/api/auth/change-password/route.ts`：root 改密后清 `must_change_password` 标志（acceptance S1.1 smoke）

## 3. Project 绑定 + 路径白名单接入

- [ ] 3.1 创建 `lib/path-safety.ts`：`assertWithinRoot(absolutePath, rootPath): string`，覆盖 `..` 路径 / 符号链接 / 绝对路径绕过；抛 `PathTraversalError`
- [ ] 3.2 写 `lib/path-safety.test.ts` 单测：覆盖 `..`、符号链接指向外、合法路径、URL 编码绕过等 fuzz case（acceptance S1.5）
- [ ] 3.3 创建 `app/api/projects/route.ts`（GET/POST）：GET 列当前 Team 可见 Project；POST 仅 admin/owner；接受 `{ name, root_path }`，调 `prisma.project.create` 与 `fs.statSync` 校验，调 `allowFileRoot(root_path)` 把 root 加入 fork 的白名单 cache
- [ ] 3.4 创建 `app/api/projects/[id]/bind/route.ts`：调 `cwd/validate` + `allowFileRoot`，返回当前 user 的 `last_project_id`
- [ ] 3.5 修改 fork 现有 sidebar 的 cwd 输入控件为 Project 选择 dropdown：选 project 调 `/api/projects/[id]/bind`，再调现有 `startRpcSession` 启动 session（**不引入新 SessionBus**）

## 4. 会话可见性 + 同步 + smoke

- [ ] 4.1 修改 `app/api/agent/[id]/events/route.ts`：read-path 第一行加 `assertCanReadSession(user, id)`：user = session.user_id OR user_role IN (owner, admin) OR user_id IN session_shares（M1 后者为 schema 预留，读空）
- [ ] 4.2 修改 `app/api/agent/[id]/route.ts` 的 POST handler：调 `assertCanReadSession`
- [ ] 4.3 创建 `tests/e2e/login.spec.ts` Playwright smoke：访问 `/` → 跳 `/login` → 输入 root 临时密码 → 跳 `/change-password` → 改密 → 进 dashboard（acceptance S1.1 + S1.2 smoke）

> **Notes**：
> - 任务 5.1-5.3（per-session mutex、SSE、SSE fan-out）**在 fork 已实现**，M1 不需要新建
> - 任务 6.6-6.7（Dockerfile、README 启动说明）**保留在 M3 范畴**——本 M1 仅写一个最小 Dockerfile 验证 build 通过即可，详细 README 部署文档移到 M3
> - 任务 1.5/6.7 中的 `-v data` 持久化说明在 README 里标"TODO M3"

```

## openspec/changes/pi-web-generalized-m1-runnable/specs/agent-session-in-process/spec.md

- Source: openspec/changes/pi-web-generalized-m1-runnable/specs/agent-session-in-process/spec.md
- Lines: 1-38
- SHA256: 148a44027be370e7a3c6420682b10c8f7161d90c8a5d62993926e7c7415dce8a

```md
# Capability: agent-session-in-process

> fork 现有 [xiejava1018/pi-web](https://github.com/xiejava1018/pi-web) `lib/rpc-manager.ts` 已经覆盖 `startRpcSession` / `getRpcSession` 多 session 生命周期；M1 不引入新 SessionBus，仅在 SSE 端点 read-path 加权限校验。

## ADDED Requirements

### Requirement: 复用 fork 的 per-session 串行调度

系统 MUST 沿用 fork 的 `lib/rpc-manager.ts`（包含 `startRpcSession`、`getRpcSession`、`AgentSessionWrapper`）。M1 不需要新写 SessionBus 或新 mutex 链——fork 内部已对同一 session 串行调度（读 `startRpcSession` 实现可证）。M2 评估是否需要上层 per-user 信号量（限 3 session 并发）。

#### Scenario: 复用 fork 现有调度
- **WHEN** `app/api/agent/new/route.ts` 调 `startRpcSession(tempKey, "", cwd, ...)` 启动 session
- **THEN** fork 的串行链生效；同 session 双 prompt 不会事件交叉（**前提**：M1 仅在路由入口加权限校验，不在 fork 调度链插入新逻辑）

### Requirement: SSE 端点 read-path 强制 user 权限校验

fork `app/api/agent/[id]/events/route.ts` 的 GET handler **没有 user 检查**（单用户前提）。M1 MUST 在该 handler 的 read-path 第一行加 `assertCanReadSession(userId, sessionId)`：

- `userId == session.user_id`  → 通过
- `userId_role IN (owner, admin)` 所在 team 内 → 通过
- `userId IN (SELECT shared_with_user_id FROM session_shares WHERE session_id = s.id)`  → 通过（M1 后者 schema 预留读空）
- 其他 → 抛 `ForbiddenError`，handler 返回 403

#### Scenario: 未授权 tab 被拒订阅
- **WHEN** user `V` 无权访问 session `S`，调用 `GET /api/agent/S/events`
- **THEN** handler 内 `assertCanReadSession` 抛 `ForbiddenError`；返回 403；fork 的 `startRpcSession` 不被调用

#### Scenario: 创建者 tab 收到事件
- **WHEN** user `U` 是 session `S` 创建者
- **THEN** `assertCanReadSession` 通过；handler 调 `getRpcSession` / `startRpcSession`；SSE 流正常返回

### Requirement: SSE 端点 cwd 与 Project.root_path 一致

fork `app/api/agent/new/route.ts` 在 M1 MUST 改成：cwd 来自 user 当前 `last_project_id` 对应的 `Project.root_path`（而非 UI 自由输入）。如 `last_project_id` 缺失，则 handler 返回 400。`assertWithinRoot` 在创建 session 前调用以双验。

#### Scenario: 新建 session 的 cwd 与 Project root_path 一致
- **WHEN** `POST /api/agent/new` 被 user 调，user 的 `last_project_id` 绑定到 `projects.root_path = /tmp/demo`
- **THEN** handler 取 `cwd = /tmp/demo`，调现有 fork 链路 `statSync` + `allowFileRoot(/tmp/demo)` 后启动 session；不发生路径拼接 / 路径变换

```

## openspec/changes/pi-web-generalized-m1-runnable/specs/auth-provider-user/spec.md

- Source: openspec/changes/pi-web-generalized-m1-runnable/specs/auth-provider-user/spec.md
- Lines: 1-53
- SHA256: 4f6194581b8c72936c91f67e3c9c18e9fd496346d4a412a62b1c49765848c925

```md
# Capability: auth-provider-user

> 与 fork [xiejava1018/pi-web](https://github.com/xiejava1018/pi-web) 已有的 `/api/auth/login/[provider]`（model provider auth）**不冲突、本变更不接管其 key 存储**；M1 仅在 user 维度添加新 auth。

## ADDED Requirements

### Requirement: AuthProvider 接口必须保留扩展位

系统 MUST 暴露 `lib/auth-provider.ts` 接口：

```ts
interface AuthProvider {
  authenticate(credential: { username: string; password: string })
    : Promise<{ userId: string; displayName: string; mustChangePassword: boolean }>
  revoke(userId: string): Promise<void>
}
```

所有业务代码 MUST 通过依赖注入调用 `AuthProvider` 实例，**不许直接 import 任何具体实现**——这是为 M2/M3 接 SAML / OIDC / OAuth 留接口位。

M1 MUST 提供 `LocalPasswordAuthProvider` 一个具体实现，内部用 `bcryptjs` 哈希与 `jose` 签 JWT。**未来加 GitHub OAuth 等必须写第二个实现类，不动业务代码**。

#### Scenario: 通过 LocalPasswordAuthProvider 登录成功
- **WHEN** 调用 `provider.authenticate({ username: "alice", password: "<correct>" })`
- **THEN** 返回 `{ userId: "<cuid>", displayName: "alice", mustChangePassword: false }`，数据库中无该 user 时自动 create

#### Scenario: 切换实现类不动业务代码
- **WHEN** 业务代码调用 `provider.authenticate(credential)`
- **THEN** DI 容器根据 config 注入 `LocalPasswordAuthProvider` 或未来 `GitHubOAuthProvider`，业务代码无需改动

#### Scenario: 与 model provider auth 并存
- **WHEN** 用户已通过 `/api/auth/user-login` 登录，并访问 `/api/auth/providers`
- **THEN** 返回 200，model provider 列表可见（**不与 user auth 互斥**）

### Requirement: 全局 middleware 拦截未登录 user 的 /api/*

fork 现有 pi-web **没有全局 middleware**。本 capability MUST 新增根目录 `middleware.ts`：

- 例外：`/`（首页）、`/api/auth/user-login`、`/api/auth/user-logout`、model provider auth（`/api/auth/{providers,login,logout,all-providers,api-key}`）、静态资源（`_next/static`、`public/`、`favicon`）
- 其他 `/api/*`：解码 `pw_at` cookie 携带的 user JWT；JWT 无效或缺失 → 返回 401
- 解码成功后：`req.headers['x-user-id']` 与 `req.headers['x-user-role']` 注入用户身份；下游路由可用 `headers().get('x-user-id')` 读

#### Scenario: 未登录访问受保护 API 返回 401
- **WHEN** 未带 `pw_at` cookie 时调用 `GET /api/sessions`
- **THEN** middleware 拦截返回 401 JSON `{ error: "auth required" }`

#### Scenario: 登录后访问正常
- **WHEN** 带有效 `pw_at` cookie 调用 `GET /api/sessions`
- **THEN** middleware 通过；handler 读到 `x-user-id` header 并继续处理

#### Scenario: 静态资源不拦截
- **WHEN** 调用 `GET /favicon.ico`
- **THEN** middleware 不参与，资源返回 200

```

## openspec/changes/pi-web-generalized-m1-runnable/specs/bootstrap-root-owner/spec.md

- Source: openspec/changes/pi-web-generalized-m1-runnable/specs/bootstrap-root-owner/spec.md
- Lines: 1-27
- SHA256: 06b5009ce8bf1ef1f8e2a7b15de47554adc61d563049919f57243fb86d9df588

```md
# Capability: bootstrap-root-owner

## ADDED Requirements

### Requirement: 启动日志强制输出 root bootstrap 状态

系统 MUST 在每次启动时（通过 `scripts/bootstrap-root.ts` 串入 `npm run start`）向 stdout 写一行结构化日志，prefix 为 `[BOOTSTRAP]`。当数据库 users 表（通过 `prisma.user.count()` 查询）为空时，该行 MUST 包含 `password=<random>`；当 users 表不为空时，该行 MUST 包含 `password=<redacted>`。日志等级 MUST 是 INFO，不可被 SILENCE。运维 MUST 知道这个 root owner 存在；即便失效也能恢复。

#### Scenario: 首次启动输出密码
- **WHEN** 干净的 SQLite 数据库首次 `npm run start`
- **THEN** stdout 在 1 秒内输出一行 `[BOOTSTRAP] root username=root password=<secret> action=login-and-change-immediately`；`prisma.user.create` 一条 root 记录（`password_hash` 为 bcrypt 哈希）

#### Scenario: 重启不重新生成
- **WHEN** 系统已有 root owner 的 SQLite 数据库，再启动
- **THEN** stdout 输出 `[BOOTSTRAP] root username=root password=<redacted>`；无新 user create

### Requirement: root owner 必须强制改密才能访问其他功能

root 登录后 MUST 被强制重定向到 `/change-password`，未改密前 MUST 不能调其他任何写 API。这一约束保证 demo 过程中临时密码不会被长期保留。

#### Scenario: root 登录后被强制改密
- **WHEN** root user 登录成功的第一次请求进入应用任意路由（除 `/api/auth/user-logout`、`/api/auth/change-password`）
- **THEN** Server 识别 `must_change_password=true`，返回 302 重定向到 `/change-password`，且除改密 API 外的所有写 API 返回 403

#### Scenario: 改密后才能访问其他 API
- **WHEN** root 调 `POST /api/auth/change-password` 成功后
- **THEN** `must_change_password` 标志被清零（更新 `users.must_change_password` 为 false）；后续访问任意非改密路由返回正常业务响应

```

## openspec/changes/pi-web-generalized-m1-runnable/specs/multi-tenant-team-model/spec.md

- Source: openspec/changes/pi-web-generalized-m1-runnable/specs/multi-tenant-team-model/spec.md
- Lines: 1-29
- SHA256: 40cd9fe184106b3d923b103b7d6d3fc5eda8f55ac4f6ed31721c04398626d38e

```md
# Capability: multi-tenant-team-model

## ADDED Requirements

### Requirement: Team / TeamMember / User 三表结构

系统 MUST 在数据库中提供 `users` / `teams` / `team_members` 三张表（通过 Prisma + SQLite 落地）。Team 为顶层隔离单元（包含 Project / ModelProvider / Session 的 `team_id` 外键）。一个用户 MUST 能加入多个 Team（一人多队是允许的）。`role` MUST 存放在 `team_members` 表上，**不许放在 `users.role`**——这是与原单用户形态（fork 现有 pi-web）以及与"admin / user 全局角色"形态的根本差别。

所有内部 ID（user_id / team_id） MUST 是 `cuid()` 生成的 string，**禁止自增整数**——为未来接外部账号系统预留位。

#### Scenario: 用户加入多个 Team
- **WHEN** 用户 `U` 在 `team_members` 表中存在两行（团队 A 的 admin + 团队 B 的 member）
- **THEN** `U` 同时能用两套身份访问 A 与 B 的项目；切换激活 team 时 session 必须重新校验可见性

#### Scenario: role 不在 users 表上
- **WHEN** `SELECT role FROM users WHERE id = ?` 被执行
- **THEN** 该查询返回 NULL（因为 role 不在 users 上）

### Requirement: Session 列表三路并集可见性

查询 session 列表时 MUST 走三路并集：`user_id = :me OR :me IN (SELECT shared_with_user_id FROM session_shares WHERE session_id = s.id) OR :me_role IN (owner, admin)`。普通 member 仅看到自己创建或被分享的 session；owner / admin 在自己 Team 内看到全部。`session_shares` 表在 M1 已 schema 预留但读空（M2 才上 share dialog）。

#### Scenario: 普通 member 仅看自己创建
- **WHEN** member `M` 调 `GET /api/sessions`
- **THEN** 返回的 session 列表中每条 `user_id` 都等于 `M.id`，或 `M.id` 存在于对应的 `session_shares.shared_with_user_id`

#### Scenario: admin 看全 Team
- **WHEN** admin `A` 调 `GET /api/sessions?team_id=T`
- **THEN** 返回 Team T 下所有 session，不论 `user_id`

```

## openspec/changes/pi-web-generalized-m1-runnable/specs/project-and-path-safety/spec.md

- Source: openspec/changes/pi-web-generalized-m1-runnable/specs/project-and-path-safety/spec.md
- Lines: 1-49
- SHA256: 6748a4f4d645bdb79f1f9c68286f3364e278766cb9364c9d72bde8aab47ad832

```md
# Capability: project-and-path-safety

> 与 fork [xiejava1018/pi-web](https://github.com/xiejava1018/pi-web) 已有的 `lib/allowed-roots.ts`（globalThis cache 形式的"白名单"）**共存**。

## ADDED Requirements

### Requirement: assertWithinRoot —— 主动校验 user 路径必须落在 user 选定的 Project.root_path 内

fork 现有 `allowFileRoot(path)` 是"允许"语义（让 file router 通过）。**本 capability 新增主动校验**语义：用户请求 path → 校验是否在 user 选定的某个 `Project.root_path` 内。

系统 MUST 提供 `lib/path-safety.ts` 导出 `assertWithinRoot(absolutePath: string, rootPath: string): string`，**解析所有路径后调用，校验规范化后路径必须在 `rootPath` 之内**。返回规范化后的真实路径。

`assertWithinRoot` MUST 防御：
1. `..` 路径段（任何形式的 `../../../../etc/passwd`）
2. 符号链接指向 `rootPath` 之外
3. 绝对路径绕过
4. URL 编码 / Unicode 等价绕过（先 `path.resolve` 再 `fs.realpath`）

#### Scenario: ../ 路径被拦截
- **WHEN** 调用 `assertWithinRoot("/data/users/u1/projects/p1/../../../etc/passwd", "/data/users/u1/projects/p1")`
- **THEN** 抛出 `PathTraversalError`

#### Scenario: 符号链接指向 root 之外被拦截
- **WHEN** 调用 `assertWithinRoot("/data/users/u1/projects/p1/subdir/outside_link", ...)` 而 `subdir/outside_link` 指向 `/etc`
- **THEN** 抛出 `PathTraversalError`

#### Scenario: 合法路径返回规范化路径
- **WHEN** 调用 `assertWithinRoot("/data/users/u1/projects/p1/README.md", "/data/users/u1/projects/p1")`
- **THEN** 返回 `/data/users/u1/projects/p1/README.md`

### Requirement: Project 由 Admin 手工添加，并接入 fork 现有白名单

系统 MUST 提供 `POST /api/projects` 接收 `{ team_id, name, root_path }`。M1 MUST 仅允许 admin / owner 角色调用，Member 角色调用 MUST 返回 403。`root_path` MUST 是 server 进程可见的绝对路径；server 创建时调 fork 已有的 `lib/file-access.ts` 的 `allowFileRoot(root_path)` 将该 root 加入 fork 的 globalThis 缓存，**同时**调 `assertWithinRoot` 自验该 root 本身合法。Project 不允许在 UI 中改 `root_path`（一旦设定只能删除重建）。

#### Scenario: Admin 添加合法路径
- **WHEN** admin `A` 调 `POST /api/projects { team_id: "T1", name: "demo", root_path: "/tmp/demo" }` 且该路径可访问
- **THEN** 返回 201，projects 表新增一行；fork 的 `__piAdditionalAllowedRoots` 集合中加入 `/tmp/demo`；`A` 登录后 sidebar 可见该 Project

#### Scenario: Member 添加被拒
- **WHEN** member `M` 调 `POST /api/projects`
- **THEN** 返回 403，不创建记录；fork 白名单不变

### Requirement: cwd 注入沿用 fork 现有链

系统 MUST 新增 `POST /api/projects/[id]/bind`：该接口 MUST 调 fork 已有的 `/api/cwd/validate` 端点的等价逻辑（`statSync` + `allowFileRoot`），把 user 选定的 Project 写为 session 的 cwd。**必须不引入新 SessionBus** —— fork 的 `lib/rpc-manager.ts` 已经管多 session 生命周期。

#### Scenario: 用户切换 Project 不重启 server
- **WHEN** user `U` 已经登录，选 Project P1 (root_path=/tmp/p1) 后调 `POST /api/projects/[id]/bind`
- **THEN** `last_project_id` 写入 user 维度（内存或 DB）；后续 `POST /api/agent/new` 的 cwd 自动填入 `/tmp/p1`

```

## openspec/changes/pi-web-generalized-m1-runnable/specs/runnable-harness/spec.md

- Source: openspec/changes/pi-web-generalized-m1-runnable/specs/runnable-harness/spec.md
- Lines: 1-35
- SHA256: 60e6827c1f34d172b98ff541a028219025029e8807fe2e62b1459244c87cf75d

```md
# Capability: runnable-harness

> fork [xiejava1018/pi-web](https://github.com/xiejava1018/pi-web) 已经具备 `next build` + `next start -p 30141` 完整运行时；本 capability 只补足多用户封装后还需要的脚手架与最小部署面。

## ADDED Requirements

### Requirement: Playwright 脚手架

仓库 MUST 包含 `playwright.config.ts`，声明 `tests/e2e/` 为 E2E 测试目录。`pnpm playwright test` 命令 MUST 可运行。M1 阶段 MUST 至少包含一个 `tests/e2e/login.spec.ts` 跑通"访问首页 → 跳登录 → 输入 root 临时密码 → 跳 change-password → 改密成功"的完整路径，作为脚手架的烟雾测试。

#### Scenario: Playwright 配置可用
- **WHEN** `pnpm playwright test --list` 被执行
- **THEN** 输出至少 1 个 spec，0 个失败

### Requirement: 最小 Dockerfile（仅 build 验证）

仓库 MUST 包含单 stage `Dockerfile`，能在 `docker build` 后跑完 `prisma migrate deploy`、`next build`、`next start -p 30141`。SQLite 数据落 `/app/data`。

注：完整 README 启动说明、docker-compose、卷挂载语法在 M3 才补足；M1 阶段此 Dockerfile 仅作为本地 build 验证（不要求 production-grade）。

#### Scenario: docker build 通过
- **WHEN** `docker build -t pi-web-m1:test .` 被执行
- **THEN** 镜像成功 build；`docker run pi-web-m1:test` 时启动日志包含 `[BOOTSTRAP]` 一行（如数据库空）

### Requirement: i18n 架构占位

仓库 MUST 安装 `next-intl`，app shell 与文案通过 `next-intl` 的 API 调用。所有 key 必须在 `messages/en.json` 中存在对应值。`messages/zh.json` 文件 MUST 创建但内容为占位（不需填值），表示 M3 上中文内容的接入点。M1 阶段 UI MUST 完全可用，使用 `en.json`。

#### Scenario: 切换 en.json 中 key 值，UI 文字随之改变
- **WHEN** 修改 `messages/en.json` 的 `login.title`
- **THEN** 浏览器刷新后登录页标题变更

#### Scenario: zh.json 占位文件存在
- **WHEN** `ls messages/` 被执行
- **THEN** 输出包含 `en.json` 与 `zh.json` 两个文件

```
