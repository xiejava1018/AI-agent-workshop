# Comet Design Handoff

- Change: pi-web-m2-2-ui-and-hardening
- Phase: design
- Mode: compact
- Context hash: aea867d6c2970330e156d76fdfb84cdbda06c0779e1e31d9ac85b60117df30f4

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/pi-web-m2-2-ui-and-hardening/proposal.md

- Source: openspec/changes/pi-web-m2-2-ui-and-hardening/proposal.md
- Lines: 1-74
- SHA256: b9c72aefd6e063600f72a02affe560420e9c03f2b3665e165a365090374ca01d

```md
## Why

M1 (`pi-web-generalized-m1-runnable`，已归档) 在 fork `xiejava1018/pi-web` v0.7.11 之上叠加了多用户后端层：JWT 认证、Project 绑定、路径白名单、session 权限校验、bootstrap root owner。**但 M1 没有 UI 页面**——所有能力只能通过 API/curl 测试，用户无法在浏览器中走完"登录→改密→dashboard"流程。

同时 M1 verify 报告 deferred 了 5 项 WARNING + 多项 SUGGESTION，最关键的两项是 (a) `mustChangePassword` 字段没真正拦截写 API，(b) `app/api/agent/new` 没读 `user.lastProjectId` 而是继续接受 body.cwd——这两个都是用户使用 M1 时会撞到的实际 gap。

本 change（M2.2）交付**最小登录 UI**让流程可在浏览器跑通，同时收回 M1 deferred 中能在不引入新能力的前提下修掉的部分。

## What Changes

- **新增 3 个 UI 页面** + i18n `[locale]` 路由 wiring：`/en/login` `/en/change-password` `/en/dashboard`
- **`mustChangePassword` 写 API 门**：每个 `/api/*` 写路由（除 change-password 自身）顶部加 helper 检查；root 改密前 POST 返回 403
- **`app/api/agent/new` 改读 `user.lastProjectId`**：取代 `body.cwd`；与 Project 绑定语义一致
- **`app/api/sessions` 3 路并集过滤**：self + 同 team OWNER/ADMIN 可见的 session + 未来 M2.4 session_share
- **`lib/session-meta.rebuildFromJsonl` 真正实现**：server 启动时扫 `<PI_WEB_DATA_DIR>/**/*.jsonl` 第一行元数据，写入 memory map（userId=null 标匿名）
- **50 session 全局硬上限**：通过 server-side 计数器；超限 POST `/api/agent/new` 返回 503
- **`lib/prisma.ts` 单例**：避免 M1 中多模块各自 `new PrismaClient()` 的 hot-reload 风险
- **`Dockerfile` 补 `prisma migrate deploy`**：M1 verify 报告 SUGGESTION #7
- **i18n `[locale]` 路由 wiring**：扩 `messages/{en,zh-CN}.json`；`lib/i18n.ts` 已存在（M1 末补）补 `locale` 解析
- **E2E 扩 3-4 个 use case**：`tests/e2e/login.spec.ts` 扩 login UI → change-password → dashboard 流程 + mustChangePassword 403 检查

## Capabilities

### New Capabilities

- `user-auth-ui`: 浏览器可见的登录 / 改密 / dashboard 页面；i18n `[locale]` 路由；与 M1 后端 auth provider 接口对齐
- `session-cap`: 50 session 全局硬上限 + 拒绝第 51 次创建（503）；per-user 信号量留后续 M2.3+
- `session-visibility-filter`: `GET /api/sessions` 3 路并集过滤（self / team admin / M2.4 shared placeholder）

### Modified Capabilities

- `multi-tenant-team-model`: mustChangePassword 写 API 拦截作为强制改密契约的运行时实现
- `agent-session-in-process`: `app/api/agent/new` 改用 `user.lastProjectId` 作为 cwd 来源；server-startup metadata rebuild 从 no-op 升级为真扫 .jsonl
- `runnable-harness`: i18n `[locale]` 完整 wiring（messages/ 已存在，扩 key + lib/i18n.ts 加 locale 解析）；Dockerfile 补 `prisma migrate deploy`

## Impact

**Affected code**:
- 新增 `app/[locale]/layout.tsx` + 3 page.tsx（~250 行 TSX + CSS）
- 新增 `lib/{must-change-password,session-cap,server-user,prisma}.ts`（~150 行）
- 修改 `middleware.ts`（matcher 加 locale 例外 + `runtime: 'nodejs'` 以跑 Prisma）
- 修改 6 个 `/api/*` 写路由 + `app/api/agent/new` + `app/api/sessions` + `Dockerfile`
- 扩 `tests/e2e/login.spec.ts`（不新建 spec 文件）

**Affected APIs**:
- `POST /api/agent/new` 请求体不再读 `cwd`；返回 503 当 session cap 满
- `GET /api/sessions` 响应过滤为 3 路并集
- 6 个写 API 返回新 403 `{ error: "password change required" }` 当 mustChangePassword=true

**Affected fork files**:
- `app/api/agent/[id]/events/route.ts`：M1 已 additive 加 `assertCanReadSession`，M2 不再改
- `app/api/agent/[id]/route.ts`：M1 已 additive 加 GET+POST gate，M2 不再改
- `components/SessionSidebar.tsx`：M1 已 wire SidebarProjectPicker，M2 不再改

**Affected dependencies**: 无新增 npm 依赖。`next-intl`、`@prisma/client`、`bcryptjs`、`jose`、`vitest`、`@playwright/test` 均已在 M1 安装。

**Affected non-functional**:
- `runtime: 'nodejs'` middleware 替代默认 edge runtime —— Prisma 启动开销 + ~10MB 内存（Next.js 16 dev 模式不变，prod 影响可接受）
- 50 session 计数器是 in-memory Map，重启丢失（M2.3+ 可升级到 Prisma）

## Open Questions (carried from M1)

下列项**不在本 change 范围**（已 deferred 后续）：

| 项 | 后续 change |
|----|-------------|
| SAML / OIDC / GitHub OAuth | M2.3 |
| Access + refresh token | M2.3 |
| Share dialog | M2.4 |
| 50 session 的 per-user 信号量（当前仅全局硬上限） | M2.3 |
| Postgres 迁移 | M3 |
| Dockerfile 完整部署文档 | M3 |
| axe-core a11y 测试 | M3 |
| next-intl `[locale]` 与 path-to-regexp v8 兼容性（已发现 M1 中间件有过此问题，需 build 早期验证） | M2.2 内解决 |

```

## openspec/changes/pi-web-m2-2-ui-and-hardening/design.md

- Source: openspec/changes/pi-web-m2-2-ui-and-hardening/design.md
- Lines: 1-151
- SHA256: c8e6fbc3e5f5653b38760469e34a494049b1d7fb2c7570f97ce05b21768e6a7e

[TRUNCATED]

```md
## Context

M1 (`pi-web-generalized-m1-runnable`) 在 fork `xiejava1018/pi-web` v0.7.11 之上叠加了多用户后端层（auth、project、path safety、session authz）。M1 验证报告 deferred 5 项 WARNING + 多项 SUGGESTION（见 proposal §Open Questions）。M1 没有 UI 页面，用户只能通过 API 验证功能。

本 change（M2.2）解决两类问题：

1. **UI gap**：浏览器不可见 → 交付 `/en/login` `/en/change-password` `/en/dashboard` + i18n `[locale]` 路由
2. **M1 deferred**：mustChangePassword 门 / agent/new lastProjectId / sessions 3 路过滤 / rebuildFromJsonl / PrismaClient 单例 / Dockerfile migrate deploy

**约束**:
- 不引入新 npm 依赖（next-intl、prisma、bcryptjs、jose、vitest、playwright 均已在 M1 装好）
- 不引入新 capability（无 SAML/OIDC、share dialog、refresh token、Postgres）
- 必须在 Next.js 16 + path-to-regexp v8 下验证 middleware matcher 不再因"Capturing groups"挂掉（M1 已遇此问题）
- 复用 M1 已存在的所有 `lib/` 与 `app/api/auth/*`（无重写）

**利益相关方**:
- 你（dev 体验验收）：能打开浏览器跑完整登录流程
- 后续 M2.3+（OAuth、token 刷新）：M2.2 改密门 + i18n wiring 给它们铺路
- 后续 M3（Postgres、部署）：M2.2 的 Dockerfile migrate deploy 步骤是前置

## Goals / Non-Goals

**Goals:**
- 浏览器中：访问 `/en/login` → 输密码 → 改密 → 进 `/en/dashboard` 看 user + team + projects
- 写 API 强制改密门：mustChangePassword=true 时所有写操作 403
- `POST /api/agent/new` 用 `user.lastProjectId` 作 cwd 来源（与 bind 路由一致）
- `GET /api/sessions` 3 路并集过滤（self + team admin + M2.4 placeholder）
- 50 session 全局硬上限（per-user 信号量留 M2.3）
- server 启动时 `rebuildFromJsonl` 真正扫 .jsonl
- `lib/prisma.ts` 单例消除 hot-reload 风险
- Dockerfile 含 `prisma migrate deploy`
- E2E 覆盖 login UI / change-password / dashboard / mustChangePassword 403 / sessions 过滤 5 个 use case

**Non-Goals:**
- 新增 SAML / OIDC / GitHub OAuth（留 M2.3）
- Access + refresh token（留 M2.3）
- Share dialog（留 M2.4）
- Per-user session 信号量（仅全局硬上限）
- 切 Postgres（留 M3）
- axe-core a11y（留 M3）
- 完整 i18n 内容（仅扩 messages key 覆盖本次 UI 用到的字符串）
- Fork upstream 同步

## Decisions

### D1. i18n 路由: `[locale]` 动态段

**选择**: `app/[locale]/login/page.tsx` 等结构，URL 形如 `/en/login` `/zh-CN/dashboard`

**替代**:
- `app/(locale)/` 路由组（URL 不带 locale）— 否决，用户需可分享带 locale 的链接
- 不加 locale（defer 完整 i18n）— 否决，next-intl 已装半年

**理由**: next-intl 官方推荐方式；URL 自描述；未来加新 locale 零摩擦；M1 `lib/i18n.ts` 已暴露 `t(key, locale)` 与 `getMessages(locale)` 仅需扩 locale 解析。

### D2. `mustChangePassword` 门: per-route helper

**选择**: 新增 `lib/must-change-password.ts::enforceNotMustChange(req) -> Response | null`；每个写路由顶部加 `const gate = enforceNotMustChange(req); if (gate) return gate;`

**替代**:
- middleware matcher 排他（强制只允许 /api/auth/change-password）— 否决：M1 中间件 matcher 与 path-to-regexp v8 反复踩坑；再加更复杂的 matcher 风险大
- JWT claim 携带 mustChangePwd — 否决：每个路由都要从 payload 拿 claim 而非 header；与现有 `x-user-id` header 风格不一致

**理由**: 显式、可见、易测试、易绕过。OpenSpec spec 写明契约，per-route check 是最直接的实现；后续 M2.3 OAuth 切换时也只需改 helper 内部。

### D3. `app/api/agent/new` cwd 来源: `user.lastProjectId`

**选择**: handler 第一步 `const user = await prisma.user.findUnique({ where: { id: userId }, select: { lastProjectId: true } })`；null → 400 "no project selected"；有 → `prisma.project.findUnique` + `cwd = project.rootPath`

**替代**: 保留 body.cwd 但加白名单校验 — 否决：fork 现有会话语义已经是"用户选定 Project 后所有 session 都在该 root 下"，body.cwd 接受反而是 backdoor

**理由**: M1 design §2.3 数据流明确说"cwd 来自 user 当前 last_project_id"；M1 是 storage 写好了，handler 没改；M2.2 闭合此契约。

### D4. 50 session cap: in-memory counter (重启丢)

**选择**: `globalThis.__piSessionCounter: { count: number }`；`app/api/agent/new` 顶部 `if (count >= 50) return 503`；`SessionManager.open` 成功 +1、`close` 时 -1（fork 已有 close hook）

**替代**:
- Prisma 持久化（`Session` 行加 lifecycle 状态） — 否决：scope creep 太大
- 进程间协调（Redis） — 否决：M2 仍是单进程

```

Full source: openspec/changes/pi-web-m2-2-ui-and-hardening/design.md

## openspec/changes/pi-web-m2-2-ui-and-hardening/tasks.md

- Source: openspec/changes/pi-web-m2-2-ui-and-hardening/tasks.md
- Lines: 1-63
- SHA256: d4f66c49642aa19d1b39cde98ee05401617757dc1d5b972864f626f456bade65

```md
# M2.2 Tasks: UI 补齐 + 修 M1 deferred + 50 session cap

> 产物语言：**zh-CN**
> 基于 M1：`openspec/changes/archive/2026-07-13-pi-web-generalized-m1-runnable/`（已归档）
> 6 个新/改 spec：`user-auth-ui`, `session-cap`, `session-visibility-filter` (新); `multi-tenant-team-model`, `agent-session-in-process`, `runnable-harness` (改)
> 6 大组共 18 个任务，按依赖排序。每个任务规模控制在单一 session 内（≤2 小时）。

## 1. 基础设施（i18n + Prisma 单例 + 写 API 门）

- [ ] 1.1 创建 `lib/prisma.ts`：导出 `prisma` 单例（`globalThis.__prisma ?? new PrismaClient()`，dev hot-reload 复用）
- [ ] 1.2 重构 M1 中所有 `new PrismaClient()` 调用为 `import { prisma } from "@/lib/prisma"`（auth-provider-local, user-role, auth routes, projects routes, projects/[id]/bind）
- [ ] 1.3 创建 `lib/must-change-password.ts`：导出 `enforceNotMustChange(req: NextRequest): NextResponse | null`（读 `x-must-change-password` header，返回 null 通过或 403）
- [ ] 1.4 创建 `lib/server-user.ts`：server-side helper `getCurrentUserContext(userId)` 返回 `{ user, role, teamIds, mustChangePassword }`，复用 `getUserHighestRole` 并新增 `getUserTeamIds`
- [ ] 1.5 修改 `middleware.ts`：加 `runtime: 'nodejs'` + 注入 `x-must-change-password` header（从 prisma.user 读 `mustChangePassword`）
- [ ] 1.6 验证 `pnpm dev` middleware matcher 在 path-to-regexp v8 下不报 "Capturing groups"（如 i18n matcher 冲突需 fix）

## 2. i18n `[locale]` 路由 + 文案

- [ ] 2.1 创建 `app/[locale]/layout.tsx`：根 layout for locale（next-intl `NextIntlClientProvider` + 注入 `messages`）
- [ ] 2.2 扩 `lib/i18n.ts`：加 locale 解析（`/{locale}/...` URL path → `getMessages(locale)`）+ default-locale 推断
- [ ] 2.3 扩 `messages/en.json`：login/changePassword/dashboard/common key 全填（不占位）
- [ ] 2.4 扩 `messages/zh.json`：同上，中文值完整
- [ ] 2.5 修改 `middleware.ts` matcher：加 `/{locale}/(login|change-password|dashboard)` 例外（不挡 UI 页面）

## 3. Login / ChangePassword / Dashboard UI 页面

- [ ] 3.1 创建 `app/[locale]/login/page.tsx`（client component）：表单 + `t('login.*')` 文案 + 成功后跳 `/{locale}/change-password`（mustChangePassword=true）或 `/{locale}/dashboard`
- [ ] 3.2 创建 `app/[locale]/change-password/page.tsx`：表单 + `t('changePassword.*')` + 成功后跳 `/{locale}/dashboard`
- [ ] 3.3 创建 `app/[locale]/dashboard/page.tsx`（server component）：调 `getCurrentUserContext(userId)` + `GET /api/projects` 拉数据；展示 user / team / projects / mustChangePassword 状态

## 4. M1 deferred WARNINGs 修复

- [ ] 4.1 6 个写路由顶部加 `enforceNotMustChange` 调用：`app/api/agent/new` `app/api/projects` (POST) `app/api/projects/[id]/bind` `app/api/agent/[id]/events` `app/api/agent/[id]` (POST) `app/api/agent/[id]` (GET)
- [ ] 4.2 修改 `app/api/agent/new/route.ts`：删 `cwd` 从 body 读取；改用 `user.lastProjectId` → `project.rootPath`（含 membership check）
- [ ] 4.3 修改 `app/api/sessions/route.ts`：实现 3 路并集过滤（self / team admin / share placeholder）
- [ ] 4.4 修改 `lib/session-meta.ts::rebuildFromJsonl`：真正扫 `<PI_WEB_DATA_DIR>/**/*.jsonl` 第一行元数据
- [ ] 4.5 创建 `lib/session-cap.ts`：50 session 全局硬上限 in-memory counter；提供 `checkAndIncrement()` + `decrement()`
- [ ] 4.6 修改 `app/api/agent/new/route.ts`：调用 `lib/session-cap.ts::checkAndIncrement()`，超 50 返 503
- [ ] 4.7 修改 `Dockerfile`：在 `prisma generate` 后加 `RUN pnpm exec prisma migrate deploy`

## 5. 元测试 + E2E 扩

- [ ] 5.1 创建 `lib/must-change-password.meta.test.ts`（vitest）：扫描 `app/api/**/route.ts` 所有 POST/PUT/DELETE handler，断言非 `/api/auth/change-password` 都引用 `enforceNotMustChange`（meta-test 防遗漏）
- [ ] 5.2 扩 `tests/e2e/login.spec.ts`（已有 M1 smoke）：加 4 个 test block
  - (a) `login UI → dashboard via page.goto`（Playwright browser 走 UI 流程）
  - (b) `mustChangePassword 403 check`（root 改密前 POST /api/agent/new 返 403）
  - (c) `sessions 3-way filter`（创建 fake session，验证 member 看不到，admin 看到）
  - (d) `50 session cap`（循环创建 50 个 + 第 51 个应 503）

## 6. 验证与收尾

- [ ] 6.1 `pnpm exec tsc --noEmit` clean
- [ ] 6.2 `pnpm exec vitest run`（含新 meta-test + path-safety 回归）all pass
- [ ] 6.3 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="是" pnpm exec playwright test`（含 5 个 use case）all pass
- [ ] 6.4 `pnpm run build` clean（含 `runtime: 'nodejs'` middleware 不报 Capturing groups）
- [ ] 6.5 浏览器手动 smoke：访问 `http://localhost:30141/en/login` → 输密码 → 改密 → 进 dashboard → 看到 user + team + projects

> **Notes**：
> - **Task 1.6** 是关键 risk gate：i18n matcher 与 path-to-regexp v8 兼容性；M1 已遇过此问题；如失败立即 hardcode locale 白名单 fallback
> - **Task 5.1** 是 meta-test 防 mustChangePassword 门遗漏；运行时间 < 1s
> - **Task 5.2 (c)** sessions 3-way 过滤 E2E 需要 mock session 创建（fork `startRpcSession` 不易直接调）；E2E 可能需要用 `recordSessionMeta` 手动注入 fake meta，绕开真实 agent 启动
> - **Task 4.4** rebuildFromJsonl 启动扫描可能慢（M1 design §4.5 承诺 < 50ms for 1000 sessions）；首次实现如有性能问题降级为 lazy on first access
> - **不在 M2.2 范围**：SAML/OIDC、refresh token、share dialog、per-user 信号量、Postgres、axe-core a11y、middleware→proxy rename —— 留 M2.3+/M3

```

## openspec/changes/pi-web-m2-2-ui-and-hardening/specs/agent-session-in-process/spec.md

- Source: openspec/changes/pi-web-m2-2-ui-and-hardening/specs/agent-session-in-process/spec.md
- Lines: 1-47
- SHA256: 8f9d7f1074124a9b7b1774c70c6491c0db804f6c6d8253a0e173a4c8d8d8a24a

```md
## MODIFIED Requirements

### Requirement: SSE 端点 cwd 与 Project.root_path 一致

`POST /api/agent/new` handler MUST 改用 `user.lastProjectId` 对应的 `Project.root_path` 作为 cwd（而非 UI 自由输入 body.cwd）。如 `lastProjectId` 缺失或对应 project 不存在或 project.teamId 与 user 无 membership，handler 返回 400。`assertWithinRoot` 在创建 session 前调用以双验。

M2.2 实现：handler 顶部 `const user = await prisma.user.findUnique({ where: { id: userId }, select: { lastProjectId: true } })`；null → 400 "no project selected"；`prisma.project.findUnique` + membership check + `cwd = project.rootPath` + `assertWithinRoot(project.rootPath, project.rootPath)` + `statSync` + `allowFileRoot`。

#### Scenario: 新建 session 的 cwd 与 Project root_path 一致
- **WHEN** `POST /api/agent/new` 被 user 调，user 的 `last_project_id` 绑定到 `projects.root_path = /tmp/demo`
- **THEN** handler 取 `cwd = /tmp/demo`，调 `assertWithinRoot` + `statSync` + `allowFileRoot(/tmp/demo)` 后启动 session；不发生路径拼接 / 路径变换

#### Scenario: user 未绑 project
- **WHEN** user 调用 `POST /api/agent/new` 但 `user.lastProjectId` 为 null
- **THEN** 返回 400 `{ error: "no project selected" }`
- **AND** 不创建 session

#### Scenario: user 非 project 所在 team member
- **WHEN** user 调用 `POST /api/agent/new` 但 user 不是 `project.teamId` 的 member
- **THEN** 返回 403 `{ error: "forbidden" }`
- **AND** 不创建 session

### Requirement: Server 启动时 metadata rebuild 失败降级

`lib/session-meta.ts::rebuildFromJsonl` MUST 在 server 启动时（lazy on first `getSessionMeta` call）扫描 `<PI_WEB_DATA_DIR>/**/*.jsonl` 第一行元数据。对于无法反推 userId 的 session，**MUST** 标 `userId = null`（匿名）。扫描失败 catch 后 log warning 继续；不阻塞 server 启动。

匿名 session 的 read-path 行为（继承 M1 spec）：
- `userId === null` 且 `userRole IN (OWNER, ADMIN)` 所在 team 内 → **通过**（admin 可调查遗留）
- `userId === null` 且 user 是 member → **拒绝**（403）
- `userId === null` 且 user 是 OWNER/ADMIN 但不在创建该 session 的 team 内 → **拒绝**

#### Scenario: Server 启动扫描标 userId = null
- **WHEN** server 启动时 `rebuildFromJsonl` 扫描到 session `S` 的 jsonl，其第一行不含可解析的 userId
- **THEN** `recordSessionMeta(S, null, null)` 被调用；metadata map 写一行 `userId = null`

#### Scenario: 重建期间部分 jsonl 损坏
- **WHEN** `<PI_WEB_DATA_DIR>/sessions/foo.jsonl` 第一行 JSON parse 失败
- **THEN** 该 session 标 `userId = null`；其他正常 jsonl 仍被记录
- **AND** server 启动不被阻塞

#### Scenario: 匿名 session 被 member 探查被拒
- **WHEN** member `M` 调 `GET /api/agent/S/events`，session `S` 的 metadata `userId === null`
- **THEN** handler 返回 403；不暴露 S 的存在

#### Scenario: 匿名 session 被 admin 探查可读
- **WHEN** admin `A` 在创建 `S` 的 team 内，调 `GET /api/agent/S/events`
- **THEN** handler 通过；SSE 流正常返回

```

## openspec/changes/pi-web-m2-2-ui-and-hardening/specs/multi-tenant-team-model/spec.md

- Source: openspec/changes/pi-web-m2-2-ui-and-hardening/specs/multi-tenant-team-model/spec.md
- Lines: 1-59
- SHA256: 6e450a94a493e2bbd2280fda29ca431b854dd0acee65cee0258de1fbd157e5ed

```md
## MODIFIED Requirements

### Requirement: Session 列表三路并集可见性

查询 session 列表时 MUST 走三路并集：`user_id = :me OR :me IN (SELECT shared_with_user_id FROM session_shares WHERE session_id = s.id) OR :me_role IN (owner, admin) AND session.project.teamId IN (:my_admin_team_ids)`。普通 member 仅看到自己创建或被分享的 session；owner / admin 仅在自己 Team 内看到全部（不是跨 Team）。`session_shares` 表在 M1 已 schema 预留但读空（M2.4 才上 share dialog）。

M2.2 实现细节：filter 通过新增 helper `getUserTeamIds(userId): Promise<string[]>` 实现，session 通过其关联 project 的 teamId 与 user 的 admin teamIds 求交集。

#### Scenario: 普通 member 仅看自己创建
- **WHEN** member `M` 调 `GET /api/sessions`
- **THEN** 返回的 session 列表中每条 `user_id` 都等于 `M.id`，或 `M.id` 存在于对应的 `session_shares.shared_with_user_id`

#### Scenario: admin 看全 Team
- **WHEN** admin `A` 调 `GET /api/sessions?team_id=T`
- **AND** A 是 Team T 的 OWNER/ADMIN
- **THEN** 返回 Team T 下所有 session，不论 `user_id`

#### Scenario: 跨 Team admin 不可见
- **WHEN** user O1 是 Team T1 的 OWNER
- **AND** session S 在 Team T2 下某 project 关联
- **THEN** user O1 GET /api/sessions 不包含 S

#### Scenario: 多 Team user 跨 Team 可见
- **WHEN** user X 是 Team T1 与 Team T2 的 MEMBER
- **AND** session S1 在 T1 关联 project 下
- **AND** session S2 在 T2 关联 project 下
- **THEN** 响应同时包含 S1 与 S2（user X 是两边 owner）

#### Scenario: 匿名 session 仅 admin 可见
- **WHEN** server 重启后内存 metadata 重建时,某 session `S` 的 jsonl 文件依然存在,但无任何 user 主动访问过（`userId = null`）
- **THEN** member `M` 调 `GET /api/sessions` 看不到 `S`；team 内 OWNER 或 ADMIN 调同一接口能看到 `S`，并显示 "(anonymous)" 标记

## ADDED Requirements

### Requirement: 写 API 必须拒绝 mustChangePassword === true 的用户

系统 SHALL 在所有 `/api/*` 写路由（除 `/api/auth/change-password` 自身）中，header `x-must-change-password === 'true'` 时返回 403 `{ error: "password change required" }`。读路由不强制。

M2.2 实现：`middleware.ts` 在注入 `x-user-id` 时同时从 `prisma.user.findUnique` 读 `mustChangePassword` 并设 `x-must-change-password: 'true' | 'false'`；每个写路由顶部加 `const gate = enforceNotMustChange(req); if (gate) return gate;`。`enforceNotMustChange` 在 `lib/must-change-password.ts`。

#### Scenario: root 未改密时 POST /api/agent/new
- **WHEN** root 登录后 mustChangePassword=true
- **THEN** POST /api/agent/new 返回 403 `{ error: "password change required" }`
- **AND** 不创建新 session

#### Scenario: root 改密后 POST /api/agent/new
- **WHEN** root 已通过 /api/auth/change-password 改密
- **AND** mustChangePassword=false
- **THEN** POST /api/agent/new 正常返回 200 + sessionId

#### Scenario: change-password 自身可绕过门
- **WHEN** mustChangePassword=true
- **THEN** POST /api/auth/change-password 正常返回 200（白名单）
- **AND** 改密后 mustChangePassword=false，后续写 API 正常

#### Scenario: user-login 自身可绕过门
- **WHEN** mustChangePassword=true 用户重新登录
- **THEN** POST /api/auth/user-login 正常返回 200 + 新 cookie
- **AND** 响应体中 `mustChangePassword: true` 仍携带（让客户端跳到 /change-password）

```

## openspec/changes/pi-web-m2-2-ui-and-hardening/specs/runnable-harness/spec.md

- Source: openspec/changes/pi-web-m2-2-ui-and-hardening/specs/runnable-harness/spec.md
- Lines: 1-69
- SHA256: b6c8618a6dfd6cd2fa4a9bcf37ff1533d1fdc4d391fe46ce192133e380131ee4

```md
## MODIFIED Requirements

### Requirement: Playwright 脚手架

仓库 MUST 包含 `playwright.config.ts`，声明 `tests/e2e/` 为 E2E 测试目录。`pnpm playwright test` 命令 MUST 可运行。M1 阶段 MUST 至少包含一个 `tests/e2e/login.spec.ts` 跑通登录 → 改密 → dashboard 的 API 烟雾测试。M2.2 阶段扩到 5 个 use case（login UI、change-password、dashboard、mustChangePassword 403、sessions 3-way 过滤、50 session cap）。

#### Scenario: Playwright 配置可用
- **WHEN** `pnpm playwright test --list` 被执行
- **THEN** 输出至少 1 个 spec 文件包含 5 个 test block

### Requirement: 最小 Dockerfile（仅 build 验证）

仓库 MUST 包含单 stage `Dockerfile`，能在 `docker build` 后跑完 `prisma generate`、`prisma migrate deploy`、`next build`、`next start -p 30141`。SQLite 数据落 `/app/data`。

注：完整 README 启动说明、docker-compose、卷挂载语法在 M3 才补足；M2.2 阶段此 Dockerfile 仅作为本地 build 验证（不要求 production-grade）。

#### Scenario: docker build 通过
- **WHEN** `docker build -t pi-web-m2:test .` 被执行
- **THEN** 镜像成功 build；`docker run pi-web-m2:test` 时启动日志包含 `[BOOTSTRAP]` 一行（如数据库空）+ `prisma migrate deploy` 输出 + `next start` 监听 30141

### Requirement: i18n 完整 wiring

仓库 MUST 安装 `next-intl` 且 MUST 通过 `[locale]` 路由段 (`app/[locale]/...`) 暴露所有 UI 页面。所有 key 必须在 `messages/en.json` 与 `messages/zh.json` 中存在对应值（中英文内容均填全，不留占位）。`lib/i18n.ts` MUST 暴露 `t(key, locale)` 与 `getMessages(locale)`。

M2.2 范围覆盖的 key：
- `login.{title,username,password,submit,error}`
- `changePassword.{title,newPassword,confirm,submit,tooShort,success}`
- `dashboard.{title,welcome,team,projects,recentSessions,mustChangePassword,changeNow}`
- `common.{logout,language}`

#### Scenario: 切换 en.json 中 key 值，UI 文字随之改变
- **WHEN** 修改 `messages/en.json` 的 `login.title`
- **THEN** 浏览器刷新后 `/en/login` 页面标题变更
- **AND** `/zh-CN/login` 标题不变（仍走 zh.json）

#### Scenario: 切换 locale URL
- **WHEN** 浏览器从 `/en/dashboard` 导航到 `/zh-CN/dashboard`
- **THEN** 页面文案切到中文
- **AND** 用户会话 cookie 仍有效（locale 切换不重新登录）

#### Scenario: zh.json 含完整值
- **WHEN** `cat messages/zh.json` 被执行
- **THEN** 输出包含所有 login / changePassword / dashboard / common key 的中文值
- **AND** 无 "TODO" / "占位" / 空字符串值

### Requirement: PrismaClient 单例

仓库 MUST 在 `lib/prisma.ts` 暴露唯一 `prisma` 实例（Next.js dev hot-reload 期间不漏连接）。所有路由与 lib 模块 MUST 从 `lib/prisma.ts` import，而非各自 `new PrismaClient()`。

M2.2 实施：把 M1 中 `lib/auth-provider-local.ts`, `app/api/auth/*`, `app/api/projects/*`, `app/api/projects/[id]/bind/route.ts`, `lib/user-role.ts` 中现有的 `new PrismaClient()` 替换为 `import { prisma } from "@/lib/prisma"`。

#### Scenario: 单 import 复用
- **WHEN** 任意路由处理请求时
- **THEN** `globalThis.__prisma` 在 dev hot-reload 期间保持同一实例
- **AND** 不出现 "too many connections" 错误

## ADDED Requirements

### Requirement: mustChangePassword 写 API 门

仓库 MUST 在所有 `/api/*` 写路由（除 `/api/auth/change-password` 自身白名单）实现 `enforceNotMustChange` 拦截，header `x-must-change-password === 'true'` 时返回 403。

参见 `multi-tenant-team-model` spec §"写 API 必须拒绝 mustChangePassword === true 的用户"。

#### Scenario: vitest meta-test 覆盖所有写路由
- **WHEN** `pnpm exec vitest run lib/must-change-password.meta.test.ts`
- **THEN** 测试扫描 `app/api/**/route.ts` 中所有 POST/PUT/DELETE handler
- **AND** 断言每个 handler（非 `/api/auth/change-password`）都包含 `enforceNotMustChange` 调用
- **AND** 任何遗漏导致测试失败

```

## openspec/changes/pi-web-m2-2-ui-and-hardening/specs/session-cap/spec.md

- Source: openspec/changes/pi-web-m2-2-ui-and-hardening/specs/session-cap/spec.md
- Lines: 1-35
- SHA256: 96a5034d51957cd51ef17fc2233e9fab4668527eeacbc0d1698d43ed31e3288c

```md
## ADDED Requirements

### Requirement: 服务端必须有 50 session 全局硬上限

系统 SHALL 维护一个 server-side in-memory 计数器，统计当前活跃的 agent session 数。当 `POST /api/agent/new` 收到请求时，先检查计数 ≥ 50 → 返回 503；否则允许创建并在成功创建后 +1。

#### Scenario: 正常路径 50 session 内
- **WHEN** 已有 49 个活跃 session 时 POST `/api/agent/new`
- **THEN** 创建成功（200 + sessionId）
- **AND** 计数器 +1（= 50）

#### Scenario: 第 51 个请求被拒
- **WHEN** 已有 50 个活跃 session 时 POST `/api/agent/new`
- **THEN** 返回 503 `{ error: "session cap reached (50 active sessions)" }`
- **AND** 不创建新 session
- **AND** 计数器不变

#### Scenario: session 关闭释放配额
- **WHEN** 一个活跃 session 关闭（`SessionManager.close`）
- **THEN** 计数器 -1
- **AND** 后续 `POST /api/agent/new` 可正常创建直到再次达到 50

#### Scenario: 重启后计数归零
- **WHEN** server 重启
- **THEN** 计数器重置为 0
- **AND** 行为降级：可创建超过 50（直到真实 50 个活跃）；文档中标记 M2.3+ 升级到 Prisma 持久化

### Requirement: 计数器只对 POST /api/agent/new 生效

系统 SHALL 仅在创建 session 的入口（`POST /api/agent/new`）检查与递增 50 session cap。其他 agent 相关路由（`GET /api/agent/[id]`、`POST /api/agent/[id]`、`GET /api/agent/[id]/events`）不受 cap 影响。

#### Scenario: 读路由不消耗配额
- **WHEN** 已有 50 个活跃 session 时 `GET /api/agent/S1/state`
- **THEN** 200（只要 S1 是用户的）
- **AND** 计数器不变

```

## openspec/changes/pi-web-m2-2-ui-and-hardening/specs/session-visibility-filter/spec.md

- Source: openspec/changes/pi-web-m2-2-ui-and-hardening/specs/session-visibility-filter/spec.md
- Lines: 1-42
- SHA256: 5ff9bac9cb7efc1e5beb68d4bcd44e0dec357d7037a567209ce08643f6f808c8

```md
## ADDED Requirements

### Requirement: GET /api/sessions 返回当前用户可见的 session 列表

系统 SHALL 在 `GET /api/sessions` 中过滤 session 列表为三路并集：(1) 当前用户是 session owner（meta.userId === userId）；(2) 当前用户是 session owner 所在 team 的 OWNER/ADMIN；(3) M2.4 session_share placeholder（当前永远空）。

#### Scenario: 普通 member 仅看自己创建
- **WHEN** user A (MEMBER of Team T) GET /api/sessions
- **AND** session S1 是 user A 创建
- **AND** session S2 是 user B (MEMBER of Team T) 创建
- **THEN** 响应只包含 S1
- **AND** 不包含 S2

#### Scenario: OWNER 看全 Team session
- **WHEN** user O (OWNER of Team T) GET /api/sessions
- **AND** session S1 是 user A 创建
- **AND** session S2 是 user B 创建
- **AND** S1 + S2 都关联到 Team T 的某个 project
- **THEN** 响应包含 S1 + S2

#### Scenario: 多 Team user 跨 Team 不可见
- **WHEN** user X 是 Team T1 的 MEMBER 与 Team T2 的 MEMBER
- **AND** session S1 在 Team T1 关联 project 下
- **AND** session S2 在 Team T2 关联 project 下
- **THEN** 响应同时包含 S1 与 S2（user X 是两边 owner）

#### Scenario: 匿名 session 仅 admin 可见
- **WHEN** user A (MEMBER) GET /api/sessions
- **AND** session S_anon 的 meta.userId === null（server 重启残留）
- **THEN** 响应不包含 S_anon
- **AND** user O (OWNER) GET /api/sessions 同一时间
- **THEN** 响应包含 S_anon

### Requirement: 跨 Team admin 不应见其他 Team 的 session

系统 SHALL 验证 session 所在 project 的 teamId 必须等于当前用户是 OWNER/ADMIN 的某 team。

#### Scenario: Team T1 admin 看不到 Team T2 session
- **WHEN** user O1 是 Team T1 的 OWNER
- **AND** session S 是 Team T2 下某 project 关联
- **THEN** user O1 GET /api/sessions 不包含 S
- **AND** user O2 (OWNER of T2) GET /api/sessions 包含 S

```

## openspec/changes/pi-web-m2-2-ui-and-hardening/specs/user-auth-ui/spec.md

- Source: openspec/changes/pi-web-m2-2-ui-and-hardening/specs/user-auth-ui/spec.md
- Lines: 1-74
- SHA256: d653091ff820c79bb95df9081d6a1e95356ca0b1d1d6f46b9d0a9373f4b8d832

```md
## ADDED Requirements

### Requirement: 登录页面必须能在浏览器中渲染

系统 SHALL 提供一个浏览器可访问的登录页面，URL 形如 `/{locale}/login`，其中 `locale` 是从 `messages/` 目录支持的 locale 列表中（`en` 或 `zh-CN`）由用户选择或 URL 路径决定。

#### Scenario: 未登录用户访问受保护页面
- **WHEN** 未携带 `pw_at` cookie 的浏览器访问 `/{locale}/dashboard`
- **THEN** 客户端逻辑重定向到 `/{locale}/login`
- **AND** `/api/auth/*` 之外的 `/api/*` 返回 401 JSON（middleware 拦截）

#### Scenario: 用户提交登录表单
- **WHEN** 用户在 `/{locale}/login` 提交 username + password
- **THEN** POST `/api/auth/user-login` 成功（200 + Set-Cookie `pw_at`）
- **AND** 客户端跳转到 `/{locale}/change-password` 当响应体 `mustChangePassword === true`
- **AND** 客户端跳转到 `/{locale}/dashboard` 当响应体 `mustChangePassword === false`

#### Scenario: 登录失败显示错误
- **WHEN** 用户在 `/{locale}/login` 提交错误密码
- **THEN** 页面显示来自 `messages/{locale}.json::login.error` 的本地化错误消息
- **AND** 不跳转、不显示密码

### Requirement: 改密页面强制 root 在首次登录后改密

系统 SHALL 提供 `/{locale}/change-password` 页面，强制任何 `mustChangePassword === true` 的用户在访问其他功能前修改密码。

#### Scenario: mustChangePassword 用户改密成功
- **WHEN** root 提交新密码（≥ 8 字符）到 `/{locale}/change-password`
- **THEN** POST `/api/auth/change-password` 返回 200
- **AND** 客户端跳转到 `/{locale}/dashboard`
- **AND** DB 中 `User.mustChangePassword` 被置为 `false`

#### Scenario: 新密码太短
- **WHEN** 用户提交 < 8 字符的新密码
- **THEN** 页面显示来自 `messages/{locale}.json::changePassword.tooShort` 的错误
- **AND** 不跳转

### Requirement: dashboard 页面显示当前用户、团队与项目列表

系统 SHALL 提供 `/{locale}/dashboard` 页面，登录后展示：用户名、role（OWNER/ADMIN/MEMBER）、mustChangePassword 状态、当前用户所属团队名（首个）、当前用户可见的项目列表（通过 `GET /api/projects`）。

#### Scenario: root 登录后看到 dashboard
- **WHEN** root（OWNER）登录后访问 `/{locale}/dashboard`
- **THEN** 页面渲染 "Welcome root (OWNER)" + mustChangePassword 状态 + team name "Default Team" + projects 列表（空或已有）

#### Scenario: 未授权访问 dashboard
- **WHEN** 未登录浏览器直接访问 `/{locale}/dashboard`
- **THEN** 客户端跳转到 `/{locale}/login`
- **AND** 不显示任何用户数据

### Requirement: 页面文案通过 next-intl 加载

系统 SHALL 通过 `lib/i18n.ts::t(key, locale)` 加载 `messages/{en,zh-CN}.json` 中的字符串，登录/改密/dashboard 三个页面所有可见文字均走 `t()` 调用。

#### Scenario: 切换 locale
- **WHEN** 浏览器从 `/en/login` 导航到 `/zh-CN/login`
- **THEN** 页面文案切到中文（按钮 "登录" 而不是 "Sign in"）
- **AND** 切换不重新加载用户会话

#### Scenario: 缺失 key 降级
- **WHEN** `t('not.a.real.key', 'en')` 被调用
- **THEN** 返回字符串 `'not.a.real.key'`（不抛错、不返回 undefined）

### Requirement: i18n `[locale]` 路由 wiring

系统 SHALL 在 middleware matcher 中允许 `/{locale}/(login|change-password|dashboard)` 路径不返回 401（这些是 UI 页面，不应被 JWT 验证拦截）。`/api/*` 与非 UI 路径仍按 M1 规则拦截。

#### Scenario: 静态资源 + UI 页面不被 401
- **WHEN** 浏览器加载 `/_next/static/*`、`/favicon.ico`、`/{locale}/login`、`/{locale}/change-password`、`/{locale}/dashboard`
- **THEN** 全部返回 200 或 30x；不返回 401 JSON

#### Scenario: 未知 locale 重定向到默认
- **WHEN** 浏览器访问 `/{unknown_locale}/login`
- **THEN** 客户端或 server 重定向到 `/en/login`（默认 locale）

```
