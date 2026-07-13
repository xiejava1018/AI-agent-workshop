# M1 Tasks: 在 fork 之上叠加 — 通用 web 多用户 AI agent 工作台

> 产物语言：**zh-CN**
> 基于 fork：`xiejava1018/pi-web` v0.7.11（本地 `/Users/xiejava/AIproject/pi-web/`）。
> 4 大组共 18 个任务，按依赖排序。每个任务规模控制在单一 session 内（≤2 小时）。

## 1. 项目基础叠加（不重写 fork）

- [x] 1.1 在 fork 仓库根创建 `prisma/schema.prisma`；包含 `users` / `teams` / `team_members` / `projects`，全部 ID 用 `String @id @default(cuid())`；`team_members.role` 用 enum `OWNER | ADMIN | MEMBER`
- [x] 1.2 安装依赖：`prisma` + `@prisma/client` + `bcryptjs` + `jose` + `async-mutex` + `next-intl` + `@playwright/test` + `@axe-core/playwright`；在 `package.json` 锁定 `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-ai` 版本（不带 `^`）
- [x] 1.3 配置 `package.json` 脚本：`db:migrate` = `prisma migrate dev`、`db:generate` = `prisma generate`、`start` = 预先 `scripts/bootstrap-root.ts` 后 `next start`
- [x] 1.4 创建 `.env.example`，含 `DATABASE_URL=file:./data/dev.db`、`PI_WEB_DATA_DIR=./data`、`PI_WEB_MASTER_KEY=`
- [x] 1.5 创建 `data/.gitkeep`，README 强调 `-v $(pwd)/data:/app/data` 持久化

## 2. User auth 层（AuthProvider + root bootstrap）

- [x] 2.1 创建 `lib/auth-provider.ts` 接口：`AuthProvider { authenticate, revoke }` 与 DI 工厂
- [x] 2.2 创建 `lib/auth-provider-local.ts`：`LocalPasswordAuthProvider` 使用 bcryptjs（cost=10）+ jose 签 JWT；首次登录强制改密
- [x] 2.3 创建 `scripts/bootstrap-root.ts`：`prisma.user.count() === 0` 时 create root + 随机密码（≥16B URL-safe base64）→ bcrypt 哈希入库 → stdout 写 `[BOOTSTRAP] root username=root password=<secret>` 一行
- [x] 2.4 创建 `app/api/auth/user-login/route.ts`：调 `provider.authenticate`；签 JWT（15min）；写 HttpOnly cookie `pw_at`
- [x] 2.5 创建 `app/api/auth/user-logout/route.ts`：清 cookie、调 `provider.revoke`
- [x] 2.6 创建 `middleware.ts`（根目录）：拦截除 `/`、`/api/auth/user-login`、`/api/auth/user-logout`、model provider auth（`/api/auth/{providers,login,logout,all-providers,api-key}`）、静态资源外的 `/api/*`；解码 JWT 写 `req.user`；root user 加 `must_change_password=true` 标志
- [x] 2.7 创建 `app/api/auth/change-password/route.ts`：root 改密后清 `must_change_password` 标志（acceptance S1.1 smoke）

## 3. Project 绑定 + 路径白名单接入

- [ ] 3.1 创建 `lib/path-safety.ts`：`assertWithinRoot(absolutePath, rootPath): string`，覆盖 `..` 路径 / 符号链接 / 绝对路径绕过；抛 `PathTraversalError`
- [ ] 3.2 写 `lib/path-safety.test.ts` 单测：覆盖 `..`、符号链接指向外、合法路径、URL 编码绕过等 fuzz case（acceptance S1.5）
- [ ] 3.3 创建 `app/api/projects/route.ts`（GET/POST）：GET 列当前 Team 可见 Project；POST 仅 admin/owner；接受 `{ name, root_path }`，调 `prisma.project.create` 与 `fs.statSync` 校验，调 `allowFileRoot(root_path)` 把 root 加入 fork 的白名单 cache
- [ ] 3.4 创建 `app/api/projects/[id]/bind/route.ts`：调 `cwd/validate` + `allowFileRoot`，返回当前 user 的 `last_project_id`
- [ ] 3.5 修改 fork 现有 sidebar 的 cwd 输入控件为 Project 选择 dropdown：选 project 调 `/api/projects/[id]/bind`，再调现有 `startRpcSession` 启动 session（**不引入新 SessionBus**）

## 4. 会话可见性 + 同步 + smoke

- [ ] 4.1 修改 `app/api/agent/[id]/events/route.ts`：read-path 第一行加 `assertCanReadSession(user, id)`：user = session.user_id OR user_role IN (owner, admin) OR user_id IN session_shares（M1 后者为 schema 预留，读空）
- [ ] 4.2 修改 `app/api/agent/[id]/route.ts` 的 POST handler：调 `assertCanReadSession`
- [ ] 4.3 创建 `tests/e2e/login.spec.ts` Playwright smoke：访问 `/` → 跳 `/login` → 输入 root 临时密码 → 跳 `/change-password` → 改密 → 进 dashboard（acceptance S1.1 + S1.2 smoke）

> **Notes**：
> - 任务 5.1-5.3（per-session mutex、SSE、SSE fan-out）**在 fork 已实现**，M1 不需要新建
> - 任务 6.6-6.7（Dockerfile、README 启动说明）**保留在 M3 范畴**——本 M1 仅写一个最小 Dockerfile 验证 build 通过即可，详细 README 部署文档移到 M3
> - 任务 1.5/6.7 中的 `-v data` 持久化说明在 README 里标"TODO M3"
