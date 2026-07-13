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

## RENAMED Requirements

### Requirement: i18n 完整 wiring
**FROM**: i18n 架构占位
**TO**: i18n 完整 wiring

仓库 MUST 安装 `next-intl` 且 MUST 通过 `[locale]` 路由段 (`app/[locale]/...`) 暴露所有 UI 页面。所有 key 必须在 `messages/en.json` 与 `messages/zh.json` 中存在对应值（中英文内容均填全，不留占位）。`lib/i18n.ts` MUST 暴露 `t(key, locale)` 与 `getMessages(locale)`。

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
