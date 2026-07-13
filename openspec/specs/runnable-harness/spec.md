# runnable-harness Specification

## Purpose
TBD - created by archiving change pi-web-generalized-m1-runnable. Update Purpose after archive.
## Requirements
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

### Requirement: i18n 架构占位

仓库 MUST 安装 `next-intl`，app shell 与文案通过 `next-intl` 的 API 调用。所有 key 必须在 `messages/en.json` 中存在对应值。`messages/zh.json` 文件 MUST 创建但内容为占位（不需填值），表示 M3 上中文内容的接入点。M1 阶段 UI MUST 完全可用，使用 `en.json`。

#### Scenario: 切换 en.json 中 key 值，UI 文字随之改变
- **WHEN** 修改 `messages/en.json` 的 `login.title`
- **THEN** 浏览器刷新后登录页标题变更

#### Scenario: zh.json 占位文件存在
- **WHEN** `ls messages/` 被执行
- **THEN** 输出包含 `en.json` 与 `zh.json` 两个文件

### Requirement: mustChangePassword 写 API 门

仓库 MUST 在所有 `/api/*` 写路由（除 `/api/auth/change-password` 自身白名单）实现 `enforceNotMustChange` 拦截，header `x-must-change-password === 'true'` 时返回 403。

参见 `multi-tenant-team-model` spec §"写 API 必须拒绝 mustChangePassword === true 的用户"。

#### Scenario: vitest meta-test 覆盖所有写路由
- **WHEN** `pnpm exec vitest run lib/must-change-password.meta.test.ts`
- **THEN** 测试扫描 `app/api/**/route.ts` 中所有 POST/PUT/DELETE handler
- **AND** 断言每个 handler（非 `/api/auth/change-password`）都包含 `enforceNotMustChange` 调用
- **AND** 任何遗漏导致测试失败

