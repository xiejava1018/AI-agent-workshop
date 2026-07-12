# M1 通用 web 多用户 AI agent 工作台 - 能跑通

> 产物语言：**zh-CN**
> change 路径：`openspec/changes/pi-web-generalized-m1-runnable/`
> **上游仓库**：[xiejava1018/pi-web](https://github.com/xiejava1018/pi-web)（clean fork of [agegr/pi-web](https://github.com/agegr/pi-web)，v0.7.11），被我们作为基础仓库参考与改造起点。
> 上游设计沉淀（反链，不动）：
> - `pi-web.md` — pi-web 产品 entity 页
> - `pi-web-multi-tenant-ai-minisoc-design.md` — AI-miniSOC 嵌入式集成原始设计
> - `docs/plans/2026-07-12-pi-web-generalized-design.md` — 通用化版本设计（上游主源）
> - `/Users/xiejava/AIproject/pi-web/` — 实际 fork 仓库的本地路径

## Why

把已存在的 `pi-web`（fork of [agegr/pi-web](https://github.com/agegr/pi-web)，v0.7.11）封装为**多人共享、单进程、Team 隔离**的 web 工作台起步版本。pi-web 已经实现了 70% 的基础设施（Next.js 16、React 19、AgentSession 接入、SSE、`allowed-roots` 路径白名单、provider auth），但它是**单用户单进程**前提 —— 没有 user auth、Team 模型、Project 概念。M1 缺口：**user auth 层、Team/Project/ProjectBinding 数据层、会话三路并集可见性、UI cwd 改 Project 选**。

剥离 AI-miniSOC 业务耦合、抽到通用形态，是本里程碑的目标。**不是发布产品**，是验证"现成 fork + 多用户封装 = 起步版本"的可行性。

## What Changes

- **基于 fork 改造**：本 change 不重写 pi-web；所有新逻辑以"新增 / 替换 / 包装"形式落到 fork 上
- **新增** User auth 层：bcryptjs 哈希 + JWT + HttpOnly cookie（**与 pi-web 现有 model provider auth 共存**）
- **新增** Prisma + SQLite 数据层：在 fork 之上引入 ORM；现有 `.jsonl` 会话格式**保留**（不重写）
- **新增** 数据库表：`users` / `teams` / `team_members` / `projects`（其余表 schema 预留，M2 启用）
- **新增** `AuthProvider` 接口与 `LocalPasswordAuthProvider` MVP 实现，**不实现** SAML/OIDC/OAuth，但接口位必须留
- **新增** 首启动自动生成 `root` owner + 随机临时密码到启动日志
- **新增** `Project` + `assertWithinRoot` 在 `allowed-roots.ts` 之上叠加：路径穿越依然拦下（白名单=只允 Project.root_path 内）
- **新增** 全局 `middleware.ts` 拦截除 `/api/auth/user-login`、`/api/bootstrap/status`、`/` 之外的请求，要求带 user session cookie
- **修改** `app/api/agent/[id]/events` SSE 端点的 read-path：先做 user 权限校验（user = session.user_id OR role IN (owner, admin)）
- **修改** cwd 注入：把 UI 的 cwd 自由选择改为 Project 选择，后端沿用现有 `cwd/validate` + `allowFileRoot` 链路
- **新增** Playwright 脚手架 + Dockerfile single-stage + i18n 占位（`next-intl`，M1 仅英文，M3 上双语）
- **保留** pi-web 现有 model provider auth 接口与 `~/.pi/models.json` 兼容
- **保留** 所有内部 ID 为 string/cuid（不自增）
- **不改** `rpc-manager.ts`、`session-reader.ts`、UI 组件结构（任务 5.1-5.3 已经在 fork 内）
- **不做** Model Provider 加密（Key 在 M1 由 pi-web 自己存，M2 接管）；不做 access + refresh 双 token（M2）；不做 Share dialog / 搜索 / Admin UI（M2/M3）；不做 SSE `Last-Event-ID` 重连（M3）；不做 webhook 钩子（M3）；不做 50 session 全局硬上限 / per-user 信号量（M2）

## Capabilities

### New Capabilities

- `multi-tenant-team-model`: Team / TeamMember / User 三表，含 `role` 在 `team_members` 上而非 `users.role`、用户可加入多 Team
- `auth-provider-user`: 与 pi-web 现有 model provider auth 并存的 user auth；`AuthProvider` 接口与 `LocalPasswordAuthProvider` MVP
- `project-binding`: `Project` 表 + `assertWithinRoot` 在 `lib/allowed-roots.ts` 之上的接入层；UI cwd 改为 Project 选择
- `bootstrap-root-owner`: 首启动自动生成 root owner + 随机临时密码写日志
- `session-visibility-three-way`: session 列表查询走"自己创建 OR 被分享 OR owner/admin"三路并集
- `runtnable-harness`: Playwright 脚手架 + Dockerfile single-stage + i18n `next-intl` 占位骨架（M1 中通过"现有项目增量添加"形态）

### Modified Capabilities

（仓库内尚无既存 spec，因此无 modified 项）

## Impact

- **Affected code**：在 fork 之上叠加，不重写 pi-web 现有代码；新增/修改点集中在 `prisma/`、`app/api/auth/user-login/`、新增的 `middleware.ts`、`lib/auth-provider*.ts`、`lib/path-safety.ts`、`lib/session-bus.ts`、UI 的 cwd 选择控件
- **New packages**：Prisma + `@prisma/client`、`bcryptjs`、`jose`、`async-mutex`、`next-intl`、`@playwright/test`、`@axe-core/playwright`
- **Database**：SQLite 在 fork 之上的 dev data 目录（建议 `data/dev.db`），`prisma migrate` 跑出首版 schema；`.jsonl` 会话文件落 `<data_dir>/users/<user_id>/sessions/<sid>.jsonl`（project_id 暂未引入 `agent_sessions.team_id`，M2 再加）
- **DEPLOYMENT**：Dockerfile single-stage，SQLite 数据目录挂载说明；本 M1 不上 docker-compose（等 M3 Postgres）
- **Reuse**：`@earendil-works/pi-coding-agent` SDK（直接复用 fork 的 `lib/rpc-manager.ts` 接法）、`@earendil-works/pi-ai`、`allowed-roots.ts`、`session-reader.ts` 全部不动
- **Tests**：Vitest 单元测试覆盖 `assertWithinRoot`；Playwright smoke test 覆盖 S1.1-S1.6 中的关键 2 个
