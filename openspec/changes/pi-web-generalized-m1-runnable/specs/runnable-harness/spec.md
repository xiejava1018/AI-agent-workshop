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
