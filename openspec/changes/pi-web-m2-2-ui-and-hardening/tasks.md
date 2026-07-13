# M2.2 Tasks: UI 补齐 + 修 M1 deferred + 50 session cap

> 产物语言：**zh-CN**
> 基于 M1：`openspec/changes/archive/2026-07-13-pi-web-generalized-m1-runnable/`（已归档）
> 6 个新/改 spec：`user-auth-ui`, `session-cap`, `session-visibility-filter` (新); `multi-tenant-team-model`, `agent-session-in-process`, `runnable-harness` (改)
> 6 大组共 18 个任务，按依赖排序。每个任务规模控制在单一 session 内（≤2 小时）。

## 1. 基础设施（i18n + Prisma 单例 + 写 API 门）

- [x] 1.1 创建 `lib/prisma.ts`：导出 `prisma` 单例（`globalThis.__prisma ?? new PrismaClient()`，dev hot-reload 复用）
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
