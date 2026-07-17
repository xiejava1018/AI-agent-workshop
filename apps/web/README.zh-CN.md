# AI-agent-workshop

[English](./README.md)

[pi 编程智能体](https://github.com/badlogic/pi-mono) 之上的**多租户 AI
agent 工作台**(web)。

AI-agent-workshop 起源于 `xiejava1018/pi-web` v0.7.11 的 fork(后者本身继承自
`@agegr/pi-web`),并已演化为同一套 agent runtime 之上的**多用户、团队隔离**
浏览器工作台:

- 浏览器侧的会话管理、实时对话、模型配置、插件/技能管理、项目文件预览;
- 跑在 in-process `AgentSession` 之前的认证、团队、访问控制层(Next.js
  服务端包装,不修改 pi 源码)。

UI 与上游 pi-web 几乎一一对应,熟悉 `@agegr/pi-web` 的用户可以直接上手;
服务端新增了认证、项目、会话可见性、审计日志、管理员控制台。

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

`.env` 至少需要:

```text
DATABASE_URL=file:./data/dev.db        # 或任意 Prisma 支持的 URL
PI_WEB_DATA_DIR=./data                 # 项目元数据 + session 文件根
PI_WEB_JWT_SECRET=<足够长的随机串>      # 必须设置;缺失时服务启动直接抛错
```

`PI_WEB_JWT_SECRET` **必须**配置——`middleware.ts` 在模块加载时检查,缺失
会让进程启动失败,避免"忘记配密钥还跑起来"的安全事故。

### 3. 数据库初始化 + bootstrap root owner

`pnpm dev` / `pnpm start` 脚本已经包含 `prisma generate`(dev)/
`prisma migrate deploy`(start)+ `scripts/bootstrap-root.ts`,直接 `pnpm
dev` 即可起库与 root 账号。第一次启动时:

- 创建 `root` 用户,随机生成 ≥16 字节的 URL-safe 密码;
- 密码仅在 stdout 打印一行 `[BOOTSTRAP] root username=root password=<secret>`;
- `root` 首次登录被强制改密。

数据库已有用户时,脚本只打印一行 `[BOOTSTRAP]` 确认,不会重置密码。

### 4. 启动

```bash
pnpm dev      # 开发服, http://localhost:30141
pnpm build    # 生产构建(开发期禁止运行,会污染 .next/)
pnpm start    # 生产服(先 pnpm build)
```

打开 <http://localhost:30141>。登录页在 `/{locale}/login`(默认 locale
为 `en`,另一门支持 `zh`)。

### 可选:Docker

```text
docker build -t ai-agent-workshop .
docker run --rm -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  -e DATABASE_URL=file:/app/data/dev.db \
  -e PI_WEB_DATA_DIR=/app/data \
  -e PI_WEB_JWT_SECRET=<足够长的随机串> \
  ai-agent-workshop
```

`Dockerfile` 在构建期执行 `prisma migrate deploy`,新容器无需手动迁库。

## 功能

### Agent 工作台(沿用自 pi-web)

- **把历史工作接回来**:打开网页就能按项目找到以前的 pi 对话,不必在终端里翻文件。
- **放心试不同方向**:可以从某条历史消息继续,或 fork 为独立 `.jsonl` 路线。
- **跨分支工作**:侧栏切换 Git worktree,新会话和文件浏览器跟随 checkout。
- **边聊边看项目文件**:左侧文件树,右侧打开源码、文档、图片、音频、PDF。
- **随时掌握会话状态**:顶栏可见上下文用量、成本、压缩结果、系统提示。
- **少离开当前界面**:模型、登录/API key、模型测试、插件/技能开关都在网页里。

### M2 新增的多用户能力

- **用户名 + 密码登录 + 强制改密**:首次登录强制改密由服务端强制;
  `change-password` 之外的写 API 在改密前一律返回 403。
- **双 token**:短访问 `pw_at`(15min)+ 长 refresh `pw_rt`(7d),都存
  HttpOnly cookie;refresh 用 Prisma 持久化 jti 黑名单,轮换时旧 jti
  立刻失效。
- **团队与角色模型**:每个用户属于一个或多个 Team,角色
  `OWNER | ADMIN | MEMBER`。`root` 引导时自动进入一个默认 Team。
- **项目与会话隔离**:`Project` 行把 Team 绑定到文件系统根目录。
  `app/api/agent/new` 的 `cwd` 来自 `user.lastProjectId`,不再吃
  `body.cwd`;所有文件 API 走 `lib/path-safety.ts` 防路径穿越 /
  symlink 跳出。
- **会话可见性并集**:`GET /api/sessions` 返回三类会话的并集——自己
  的、同 Team 管理员可见的、被显式 share 给自己的。
- **per-user session cap**:`lib/session-cap.ts`,每用户 ≤ 5 个并发会话,
  全局兜底 50。超限返 503。
- **管理控制台**:OWNER/ADMIN 可见 dashboard,可调
  `POST /api/admin/users` 创建用户(服务端返回一次性初始密码,被创建
  的用户首次登录被强制改密)。
- **审计日志**:`lib/audit-log.ts` 记录 session 创建、跨 team 访问拒绝、
  share/unshare、角色变更等事件到 `AuditLog` 表,带稳定的 `action`
  token 与 JSON `metadata`。
- **i18n 路由**:`/{locale}/login`、`/{locale}/change-password`、
  `/{locale}/dashboard`、`/{locale}/`(chat)。当前支持 `en`、`zh`;文案
  在 `messages/{en,zh}.json`。

## 架构概览

```
Browser
  │
  ▼
Next.js App Router (Node.js runtime)
  │
  ├── middleware.ts ── JWT 校验 + must-change-password 标志 + x-user-id header
  │
  ├── app/[locale]/{login,change-password,dashboard}  (RSC + client 表单)
  ├── app/[locale]/page.tsx     ── AppShell (chat UI, Edit from here, fork)
  │
  ├── app/api/auth/*            ── user-login, user-logout, refresh, change-password
  ├── app/api/admin/users       ── 创建用户(OWNER/ADMIN)
  ├── app/api/projects[/...]    ── 列 / 绑定 last project
  ├── app/api/agent/[id]/*      ── run / post / events;agent session in-process
  ├── app/api/agent/new         ── cwd 取自 user.lastProjectId,per-user cap
  ├── app/api/sessions          ── 三路并集(self / team-admin / shared)
  ├── app/api/files             ── 文件列表、读、预览、watch(全过 path-safety)
  ├── app/api/models, models-config, skills, plugins, worktrees, ...
  │
  ├── Prisma(SQLite 默认)── User, Team, TeamMember, Project,
  │                          RefreshTokenBlacklist, SessionShare, AuditLog
  │
  └── @earendil-works/{pi-ai, pi-coding-agent}  ── AgentSession、models.json、skills
                                                  .jsonl session 落在 PI_WEB_DATA_DIR
```

几个**硬约束**值得事先知道:

- Agent session **仍是 in-process**(同一个 Node 进程跑)。适合小团队
  (≈10 并发用户)而不是高并发场景。
- pi SDK 版本在 `package.json` 里**锁死**(无 `^`),避免
  `@earendil-works/pi-coding-agent` 升级偷偷改 `.jsonl` 格式。

## 项目结构

```text
app/
  [locale]/                      # i18n(en/zh),这三个路由免 middleware JWT 拦截
    login/page.tsx               # 用户名 + 密码登录
    change-password/page.tsx     # 强制改密
    dashboard/page.tsx           # 团队 / 项目 / 创建用户表单(管理员)
    page.tsx                     # 挂载 AppShell(locale 下的 chat UI)
    layout.tsx, intl-provider.tsx
  api/
    agent/[id]/                  # POST /events /share(in-process AgentSession)
    agent/new                    # cwd 来自 user.lastProjectId + per-user cap
    agent/running/events
    admin/users                  # OWNER/ADMIN:列出/创建用户
    auth/{user-login,user-logout,refresh,change-password,...}
    projects/, projects/[id]     # 列 / 绑定 last project
    sessions/, files/, file-index/, models/, models-config/
    skills/, plugins/, worktrees/, cwd/, default-cwd/, home/
  layout.tsx, page.tsx, globals.css, theme-init.tsx
components/
  AppShell.tsx, SessionSidebar.tsx, ChatWindow.tsx, ChatInput.tsx,
  MessageView.tsx, BranchNavigator.tsx, ChatMinimap.tsx, TabBar.tsx,
  MarkdownBody.tsx, FileExplorer.tsx, FileViewer.tsx, FileIcons.tsx,
  ModelsConfig.tsx, PluginsConfig.tsx, SkillsConfig.tsx,
  sidebar/SidebarProjectPicker.tsx
hooks/
  useAgentSession.ts  # session 加载、发指令、SSE 状态机
  useAudio.ts, useDragDrop.ts, useIsMobile.ts, useTheme.ts
lib/
  prisma.ts                              # Prisma 单例
  auth-provider.ts / -local.ts / -bootstrap.ts
  server-user.ts                         # getCurrentUserContext
  path-safety.ts                         # assertWithinRoot(防穿越 / symlink 跳出)
  team-auth.ts, audit-log.ts             # 角色校验;审计事件写入
  token-blacklist.ts                     # refresh token 撤销(Prisma 持久化)
  session-cap.ts                         # 每用户 5 / 全局 50
  session-reader.ts / session-meta.ts / session-file-references.ts
  rpc-manager.ts                         # AgentSessionWrapper 生命周期 + 注册表
  markdown.ts, pi-types.ts, normalize.ts
  must-change-password.ts                # 写 API 门 helper
  user-role.ts, client-fetch.ts, worktree.ts, file-access.ts,
  file-paths.ts, file-links.ts, file-types.ts, file-fuzzy.ts,
  message-display.ts, markdown-config.ts, compaction-summary.ts,
  draft-store.ts, tool-presets.ts, patch.ts, ansi.ts, npx.ts, i18n.ts, types.ts
messages/
  en.json, zh.json                       # i18n 文案(next-intl via lib/i18n.ts)
prisma/
  schema.prisma                          # User, Team, TeamMember, Project,
                                         # SessionShare, RefreshTokenBlacklist, AuditLog
  migrations/                            # 含 M2 audit-log 迁移
scripts/
  bootstrap-root.ts                      # 建 root owner + 默认 team + 默认项目
tests/
  e2e/                                   # Playwright(login / mustChange / cap 等)
  unit/                                  # vitest 单测
openspec/
  specs/                                 # 各能力点 normative spec
  changes/archive/                       # 已归档 M1 / M2.2 / M2.3 实现
docs/
  plans/                                 # 设计笔记(多租户、mini chat UI 等)
  worktrees.md, worktrees.zh-CN.md
  release.md
bin/                                     # 上游 pi-web CLI 入口(继承依赖)
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | Prisma URL。默认 SQLite:`file:./data/dev.db`;生产换 Postgres。 |
| `PI_WEB_DATA_DIR` | 是 | 项目元数据 + `.jsonl` session 根目录。Docker mount `./data` 到这里。 |
| `PI_WEB_JWT_SECRET` | 是 | HS256 密钥,签 `pw_at` / `pw_rt`。缺失时服务启动失败。 |
| `PI_WEB_MASTER_KEY` | 否 | 预留给 provider API key 的静态加密(将来用)。 |
| `PI_CODING_AGENT_DIR` | 否 | 覆写 pi agent 数据目录(只在直接连 pi 时有意义)。 |

## NPM 脚本

```bash
pnpm dev            # prisma generate + bootstrap-root + next dev
pnpm build          # prisma generate + next build(开发期禁止)
pnpm start          # bootstrap-root + next start
pnpm lint           # eslint .
pnpm test           # vitest run(单测 + meta test)
pnpm test:watch     # vitest --watch
pnpm test:e2e       # playwright test
pnpm db:migrate     # prisma migrate dev
pnpm db:generate    # prisma generate
pnpm db:reset       # prisma migrate reset --force
pnpm release        # npm version patch + pnpm build + npm publish
```

## 数据持久化

`./data` 是运行期数据根。Dockerfile bind mount `-v $(pwd)/data:/app/data`。
其下:

- `data/dev.db` Prisma 数据库(SQLite 默认)。
- `data/projects/<项目名>/` 绑定到 `Project.rootPath` 的项目目录。
- `.jsonl` session 文件落在该树下(路径布局同 pi agent,由
  `@earendil-works/pi-coding-agent` 自行管理)。

## 开发提示

- 开发期不要跑 `pnpm build` / `next build`——它会写入 `.next/`,
  影响正在跑的 dev server。
- pi SDK(`@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`)
  在 `package.json` 里**锁死**到具体版本。升级前先确认 `.jsonl` 兼容。
- middleware 用 `runtime: "nodejs"`,这样能读 `prisma.user`,把
  `x-must-change-password` 转发给写 handler。

## 测试

- **单测(vitest)**:覆盖 path-safety、auth-provider、session-cap、
  session-meta、audit-log、team-auth、token-blacklist、rpc-manager、
  compaction-summary、message-display、file-links/types、prisma、i18n、
  must-change-password、server-user。另外有 meta test,断言所有写
  handler 都引用 `enforceNotMustChange`,防止后续遗漏。
- **E2E(Playwright)**:`tests/e2e/login.spec.ts` 覆盖登录 UI → 改密
  → dashboard、mustChangePassword 403、session 三路并集、session
  cap 边界(全局 50、per-user 5)。

跑 `pnpm test` 与 `pnpm test:e2e`。

## 路线图

项目正在迭代式构建。已归档里程碑在
`openspec/changes/archive/`:

- `2026-07-13-pi-web-generalized-m1-runnable` —— bootstrap、JWT、项目、
  path-safety、会话可见性、基础 Docker。
- `2026-07-13-pi-web-m2-2-ui-and-hardening` —— `[locale]` 路由、登录
  UI、改密 UI、dashboard、must-change-password 强制、50 session 上限、
  Dockerfile `migrate deploy`。
- `2026-07-14-pi-web-m2-3-admin-user-management` —— refresh token + 黑名单、
  admin 创建用户、per-user session cap(5)。

后续设计稿在 `docs/plans/`:

- `2026-07-14-pi-web-min-chat-ui-design.md` —— 最小化 chat UI 调整。
- `pi-web-multi-tenant-ai-minisoc-design.md` —— 多租户 + 嵌入 AI-miniSOC
  长期设计稿。
- `2026-07-12-pi-web-generalized-design.md` —— 早期 generalized 草稿。

规范性 capability spec 在 `openspec/specs/`
(例如 `multi-tenant-team-model`、`agent-session-in-process`、
`session-cap`、`audit-log`)。

## 协议

MIT(见 `LICENSE`)。上游组件保留各自协议;注意
`xiejava1018/pi-web` 与 [pi coding agent](https://github.com/badlogic/pi-mono)
的归属。
