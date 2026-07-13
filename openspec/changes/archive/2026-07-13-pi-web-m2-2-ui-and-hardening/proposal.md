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
