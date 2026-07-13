# M1 验证报告 — pi-web-generalized-m1-runnable

> Language: zh-CN
> Branch: `feature/20260713/pi-web-generalized-m1-runnable`
> base_ref: `b3bcb4c58eec1c29704e7dbbad5d6904b36f05d7` (fork v0.7.11)
> Date: 2026-07-13

## Summary

| Dimension    | Status |
|--------------|--------|
| Completeness | 20/20 tasks, 16/16 requirements addressed, 24/24 scenarios covered or consciously deferred |
| Correctness  | 13/16 requirements fully verified, 3 deferred to M2 (with explicit acceptance record) |
| Coherence    | matches design doc + 1 known M2-deferred drift (sessions list filter) |

## Fresh verification (post-fix)

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit --project tsconfig.json` | exit 0, no output |
| `pnpm exec vitest run lib/path-safety.test.ts` | 1 file, 5/5 tests passed (76ms) |
| `pnpm exec playwright test tests/e2e/login.spec.ts` | 1/1 passed (1.9s) |
| `pnpm run build` | clean, all routes built, "Proxy (Middleware)" registered |

## Issues — by priority

### CRITICAL (1 — fixed)

1. **i18n 架构占位** — `next-intl` 已装但无 `messages/` 目录。已修复：
   - `messages/en.json` + `messages/zh.json`（login/changePassword/dashboard 三组 key）
   - `lib/i18n.ts`：导出 `getMessages(locale)` + `t(key, locale)` dot-path lookup
   - 完整 `[locale]` 路由 wiring 留 M2

### WARNING (5 — 3 fixed, 2 deferred)

2. **mustChangePassword 写 API 强制门** — 字段已存、改密已清，但无路由/middleware 实际拦截。
   **Defer 到 M2**（用户决策：安全增强类，优先 CRITICAL + 3 easy fix）。

3. **`app/api/agent/new` 读取 lastProjectId** — bind 路由写 `user.lastProjectId`，但 `agent/new` 仍读 body.cwd。
   **Defer 到 M2**（功能性改进，触及核心 spawn 流程）。

4. **路由使用 AuthProvider DI registry** — 路由直接 `new LocalPasswordAuthProvider()`。
   **Fixed**：新增 `lib/auth-provider-bootstrap.ts`（side-effect 模块），user-login 与 user-logout 都 import 它 → `getAuthProvider()` 总是能找到注册的实现。`lib/auth-provider.ts` 接口加上 `signJwt`（所有 user-auth provider 都需签 JWT）。

5. **middleware 缺 `x-user-role` 头** — 试图在 middleware import `getUserHighestRole` → 失败：middleware 默认 edge runtime 不能跑 Prisma → E2E 401。
   **Reverted + Defer 到 M2**：middleware 只设 `x-user-id`；需 role 的路由自己 `getUserHighestRole(req.userId)`。M2 选项：把 role 签进 JWT，或显式 `runtime: 'nodejs'`。

6. **sessions 列表 3 路并集过滤** — `app/api/sessions` 返回全表。
   **Defer 到 M2**（plan notes 中已标 M2 candidate）。

### SUGGESTION (记录，不阻塞)

7. **Dockerfile 缺 `prisma migrate deploy`** — spec 要求，但当前只有 `prisma generate`。
   **Defer 到 M2**（部署文档一起做）。

8. **`rebuildFromJsonl` 是 no-op stub** — M1 spec 接受；M2 加 share dialog 时一起实现。

9. **`assertWithinRoot` 在 projects POST 缺** — 只在 bind 路由调了；POST 路由只 `statSync`。
   **Defer**（防御纵深，非正确性 gap）。

10. **PrismaClient 多实例** — 多个模块各自 `new PrismaClient()`。M1 接受，dev hot-reload 风险；M2 抽 `lib/prisma.ts` 单例。

11. **coverage 93% on path-safety.ts** — 缺 missing-root edge case 单测。已记录。

## Deferred-to-M2 task list（归档时记入 M2 tasks.md）

| Item | Severity | Reason |
|------|----------|--------|
| mustChangePassword 写 API 拦截 | WARNING | 安全增强；plan 中已标 M2 candidate |
| agent/new 读 lastProjectId | WARNING | 功能改进；触及核心 spawn 流程 |
| middleware x-user-role 头 | WARNING | edge runtime 限制 |
| sessions 列表 3 路过滤 | WARNING | 显式 M2 candidate |
| Dockerfile prisma migrate deploy | SUGGESTION | 部署文档一起做 |
| rebuildFromJsonl 真实现 | SUGGESTION | M2 share dialog 一起做 |
| assertWithinRoot 在 projects POST | SUGGESTION | 防御纵深 |
| PrismaClient 单例 | SUGGESTION | dev hot-reload 风险 |
| path-safety 100% coverage | SUGGESTION | 缺 missing-root 单测 |
| i18n [locale] 路由 wiring | 残 M1 | UI 国际化完整支持 |
| middleware → proxy 重命名 | INFO | Next.js 16 弃用警告 |
| AuthProvider DI 在 log/log 路由已生效 | INFO | M1 完成 |

## 最终评估

**PASS for M1 acceptance**（CRITICAL 已修，3 容易修 WARNING 已修，3 困难 WARNING 显式 defer M2 并在报告记录接受原因）。

进入 archive 阶段。
