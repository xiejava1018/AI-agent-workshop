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

**Why**：fork 没有全局 middleware；user auth 与现有 model provider auth 不能 inline 到每个文件。多加一层中间件统一拦截，把 user session cookie 解码后挂 `req.user` 给下游路由。

**Where**：根目录新增 `middleware.ts`（Next.js 标准位置）；**例外**：`/`、`/api/auth/user-login`、`/api/auth/user-logout`、`/api/auth/bootstrap/status`、静态资源。

### D8. UI cwd 改 Project 选

**Why**：fork 当前的 sidebar 顶部有"自由 cwd"输入框。改成"Project 选择器"，选择后调 `POST /api/projects/[id]/bind` 把 cwd 落到 `Project.root_path`，再调现有 `cwd/validate` + `allowFileRoot`。

**最小改动**：fork 现有 sidebar 的 cwd 部分换为 Project 选择 dropdown；项目列表来自 `GET /api/projects`；新增 `bind` API 记录 `last_project_id`。

### D9. i18n 用 next-intl + 单语言起步

**Why**：M3 要上中英双语。

### D10. Playwright 脚手架 + Dockerfile single-stage

**Why**：M3 才写完整 E2E + a11y。M1 安装 `@playwright/test` 写一个 smoke spec、装个 Dockerfile。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| fork 升级（v0.7.12...）改 `.jsonl` 格式 | `package.json` 锁定 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai` 版本（不带 `^`）；CI 跑解析回归 |
| `middleware.ts` 与 fork 的 path-based auth 冲突 | middleware 的例外名单明确包含 `/api/auth/{login,logout,providers,all-providers,api-key}` 与 model provider OAuth 路由 |
| Project → 现有 cwd/validate 行为不一致 | UI 强制选择 Project 后调 `/api/projects/[id]/bind`，bind 内部调 `cwd/validate` + `allowFileRoot`，避免两条路径分叉 |
| SSE 端点权限校验忘记做 | 在 SSE 路由 read-path 第一行加 `assertCanReadSession(user, sessionId)`；code review 检查清单加一行 |
| 启动日志 root 密码被 docker build context 暴露 | docker 镜像构建时 COPY 阶段不复制 `.env`；启动时 ENV 注入；M1 README 强调 |
| Prisma generate 与 TS 类型同步 | `dev` 脚本 `prisma generate && next dev`；CI 跑 `prisma generate && tsc --noEmit` |

## Migration Plan

本 M1 不做生产迁移。原因：**M1 产物不入生产** —— 仅在本地 dev + 内测。**到 M3 才考虑生产部署**（届时 fork 项目独立 release channel 与此 change 合并）。

**回滚**：因为 fork 不替换 pi-web 而是叠加，回滚成本 = 删 `prisma/`、删 `middleware.ts`、删 `lib/path-safety.ts`、删 `lib/auth-provider*.ts`、删新增 UI、删 `app/api/auth/user-login/*`。**M1 阶段没有真实用户，回滚就是 git revert**。

## Open Questions

- fork 的 `lib/rpc-manager.ts` 是否在某次改 session 生命周期时引入 per-session mutex？**已不需要**：rpc-manager.ts 内部已有串行调度。M1 不需要新 SessionBus，仅在路由入口加权限校验。
- fork 当前 `cwd/validate` 是否会把 root_path 之外的路径"放行"？验证：`allowFileRoot` 是允许语义，fork 的 file router 仅对额外允许的 root 放行，对 globalThis cache 之外的 path 仍会 403。**这正好和我们的 Project 绑定一致**。

## Summary of Decisions (1-Liner)

> **改造形态** = fork 之上 + Prisma + middleware + Project 绑定 + User auth。**改 fork 的文件数 = 2**（SSE 端点 read-path 权限、cwd UI），**新增 fork 不在的文件 = 7+**（middleware、Prisma、auth-provider、path-safety、bcrypt、jose、async-mutex、next-intl、Playwright、axe-core）。
