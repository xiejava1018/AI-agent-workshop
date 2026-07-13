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

**理由**: M2.2 是 hard cap + 简单实现；M2.3+ 升级到 Prisma + per-user 信号量。

### D5. middleware runtime: 显式 `nodejs`

**选择**: `export const config = { runtime: 'nodejs', matcher: [...] }`

**理由**: M1 中间件默认 edge runtime 跑 Prisma 失败（commit 882d0ee 经验）；`runtime: 'nodejs'` 显式声明接受 ~10MB 内存代价换 Prisma + Drizzle 可用。

### D6. `rebuildFromJsonl` 真正实现

**选择**: server 启动时（Next.js 16 没有 `getServerSideProps` lifecycle hook）用 module-init lazy 触发；scan `<PI_WEB_DATA_DIR>/**/*.jsonl` 第一行元数据，写入 `lib/session-meta.ts` 的 `globalThis.__piSessionMeta` map

**边界**: 仅在第一行含 `userId` 字段时记录；找不到 userId 标 `userId=null`（匿名）；扫描失败 catch 后继续（M1 spec 描述的"降级"行为）

**理由**: M1 spec §"Server 启动时 metadata rebuild 失败降级"已写契约；M2.2 真正实现。

### D7. PrismaClient 单例

**选择**: `lib/prisma.ts`:
```ts
import { PrismaClient } from '@prisma/client'
declare global { var __prisma: PrismaClient | undefined }
export const prisma = globalThis.__prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma
```

**理由**: 防止 dev hot-reload 时每个 module 重新 `new PrismaClient()` 漏连接；prod 单实例自然成立。

### D8. E2E 扩展 login.spec.ts（不新建 spec 文件）

**选择**: 复用 M1 `tests/e2e/login.spec.ts`，加 4 个 test block：
1. `login UI → dashboard via page.goto` (Playwright browser，UI flow)
2. `mustChangePassword 403 check` (API: POST /api/agent/new with new creds)
3. `sessions 3-way filter` (API: 创建 fake session, list, verify other user can't see)
4. `50 session cap` (API: 循环创建 50 个 + 第 51 个应 503)

**理由**: M1 已把 login.spec.ts 设为本项目的 E2E 入口；分多个 spec 文件会让 CI 编排复杂。

## Risks / Trade-offs

- **[Risk] i18n `[locale]` 与 path-to-regexp v8 兼容** → **Mitigation**: Task 1 第一步就跑 `pnpm dev` 验证 middleware 不报"Capturing groups"；如失败立即 fallback 到 hardcoded locale list
- **[Risk] middleware 改 `runtime: 'nodejs'` 性能下降**（~10MB 内存） → **Mitigation**: 接受。M2.2 仍是单实例；多实例在 M3+ 评估
- **[Risk] PrismaClient 单例在 serverless 环境（Vercel Edge）泄漏** → **Mitigation**: 本项目用 Docker 单进程部署；M3 切 Postgres 时再考虑
- **[Risk] 50 session cap 是 in-memory，重启归零** → **Mitigation**: 文档中标记 M2.3 升级到 Prisma；M2.2 hard cap 仅作"防止单进程 OOM"用
- **[Risk] `rebuildFromJsonl` 启动扫描慢**（100 sessions × 100 files = 100k read） → **Mitigation**: lazy on first getSessionMeta call；后台 promise 不阻塞 request handler；M1 design §4.5 已承诺 < 50ms
- **[Risk] per-route mustChangePassword 门有遗漏**（哪个路由忘了加） → **Mitigation**: 写 1 个 vitest 单测扫所有 `/api/**/route.ts` 文件，断言非 `auth/` 与非 `agent/new` 都有 `enforceNotMustChange` 调用（meta-test）

## Migration Plan

不需要数据迁移——所有改动 additive 或 refactor within existing routes。

**部署步骤**:
1. `pnpm install`（无新依赖，应无 op）
2. `pnpm run db:migrate`（启动前必须；新写 lib/prisma.ts 与 50 cap 不涉及 schema 变更）
3. `pnpm dev` 验证 `runtime: 'nodejs'` 中间件启动无 `Capturing groups` 报错
4. 浏览器访问 `http://localhost:30141/en/login` 走通 UI 流程
5. `pnpm test:e2e` 5 个 use case 全 pass

**回滚策略**:
- Per-route 门是 additive → 关掉 `enforceNotMustChange` 调用即回滚
- UI 页面是新文件 → 删 `app/[locale]/` 即回滚
- session cap 是新文件 → 删 `lib/session-cap.ts` + 移除 `app/api/agent/new` 调用即回滚
- middleware `runtime: 'nodejs'` 改回默认即回滚

## Open Questions

1. **next-intl middleware 集成方式**: 用 `next-intl/middleware` 包 vs 手写。两周内评估，倾向手写（M1 已有 lib/i18n.ts，避免再多一层抽象）
2. **dashboard 真实数据范围**: proposal 写"user + team + projects"——但是否含"最近 active session 列表"？M1 spec `agent-session-in-process` §"会话可见性 3 路并集"暗示 dashboard 该列。倾向加 1 段"Recent sessions (top 5)"。在 design 阶段确认。
3. **50 session 计数边界**: 当 agent session 异常关闭（fork crash）时，`SessionManager.close` 不会触发，counter 漏 -1 → 长期累加超 50 → 永远 503。Mitigation: 加 hourly janitor task 扫 `<PI_WEB_DATA_DIR>/**/*.jsonl` 真实数 vs counter 修正。M2.2 不做 janitor（M3 部署时再说）
4. **`rebuildFromJsonl` 触发时机**: lazy on first getSessionMeta OR 显式 `instrumentation.ts` Next.js 16 hook？两者等价，倾向 lazy（少一个 Next.js 16 特有 hook 依赖）
