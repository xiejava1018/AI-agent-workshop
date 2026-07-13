# Brainstorm Summary

- Change: pi-web-m2-2-ui-and-hardening
- Date: 2026-07-13
- Phase: design (mid-brainstorm)

## 确认的技术方案

### 基础设施层
- **`lib/prisma.ts` 单例** + 把 M1 中 6 个 `new PrismaClient()` 全部替换为 `import { prisma } from "@/lib/prisma"`
- **`lib/must-change-password.ts` helper**：`enforceNotMustChange(req)` 读 `x-must-change-password` header，返回 null / 403
- **`lib/server-user.ts`**：server-side helper 一次性返回 `{ user, role, teamIds, mustChangePassword }`
- **`middleware.ts`**：加 `runtime: 'nodejs'` + 注入 `x-must-change-password` header
- **i18n `[locale]` 路由**：用 `next-intl` 库完整接入（`NextIntlClientProvider` + `t()` + `useTranslations`）

### UI 层
- **`app/[locale]/layout.tsx`**：根 layout 包 `NextIntlClientProvider`
- **`app/[locale]/login/page.tsx`** (client)：表单 + mustChangePassword 路由分流
- **`app/[locale]/change-password/page.tsx`** (client)：表单
- **`app/[locale]/dashboard/page.tsx`** (server component RSC)：async load `getCurrentUserContext()` + `GET /api/projects` self-loopback fetch

### 业务逻辑层
- **mustChangePassword 门**：6 个写路由 + meta-test 扫描
- **agent/new 改 lastProjectId**（删 body.cwd）
- **sessions 3-way 过滤**（self + team admin + M2.4 share placeholder）
- **rebuildFromJsonl 通过 `instrumentation.ts` Next.js 16 hook 启动时跑**
- **50 session cap**：in-memory counter，**超限返 503 + `Retry-After: 60`**

### 基础设施硬化
- **`Dockerfile`**：在 `prisma generate` 后加 `prisma migrate deploy`
- **meta-test**：`lib/must-change-password.meta.test.ts` AST 扫描所有 `/api/**/route.ts` 写 handler

## 关键取舍与风险

- **不写 50-cap janitor**：crash drift 不修；M3 部署文件一起做。**已知 limit**：频繁 server crash 后 50-cap 会永远 503，需重启恢复。
- **rebuildFromJsonl 不在 `getMetaMap` lazy 触发，改 `instrumentation.ts` 启动 hook**：代价是多 1 个 Next.js 16 特定文件；收益是首次访问零延迟。`instrumentation.ts` 在 'register' phase 跑扫描。
- **next-intl 库 + M1 t() helper 并存**：M1 t() 用 server component 静态调用；client form 用 `useTranslations` hook。
- **Dashboard 用 server component**：需 `fetch self-loopback` 拿 `/api/projects`，cookie 通过 Next.js 16 自动转发。

## 测试策略

- **unit (vitest)**: path-safety 回归 + new `lib/session-cap.test.ts` + `lib/must-change-password.test.ts` + `lib/session-meta-rebuild.test.ts` (4-5 new files)
- **meta-test (vitest)**: `lib/must-change-password.meta.test.ts` 扫所有写路由防门遗漏
- **E2E (playwright)**: 5 个 use case in `tests/e2e/login.spec.ts` — login UI / change-password / dashboard / mustChangePwd 403 / sessions 3-way / 50 cap
- **build verify**: `pnpm run build` 含 `runtime: 'nodejs'` middleware 不报 Capturing groups

## Spec Patch

无 — 6 个 spec 已在 open 阶段写好，与 brainstorm 决策一致。

## 已确认决策（按时间序）

1. i18n `[locale]` 路由: `[locale]` 动态段 (vs 路由组 vs 不加)
2. mustChangePassword 门: per-route helper (vs middleware matcher 排他 vs JWT claim)
3. Dashboard 范围: 完整版（user + team + projects + recent sessions）
4. 50 session cap: 加 (合并入 M2.2)
5. E2E 范围: 扩到 3-4 个 use case
6. 50-cap janitor: 不加 (M3 follow-up)
7. rebuildFromJsonl 触发: `instrumentation.ts` hook
8. mustChangePwd meta-test: AST scan
9. i18n lib: 完整 next-intl 库
10. 50-cap HTTP: 503 + Retry-After
11. Dashboard 渲染: server component RSC
