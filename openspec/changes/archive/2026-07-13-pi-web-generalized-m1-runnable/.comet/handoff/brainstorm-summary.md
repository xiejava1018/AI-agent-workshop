# Brainstorm Summary — pi-web-generalized-m1-runnable (design)

- Change: pi-web-generalized-m1-runnable
- Phase: design (Step 1b 推进中)
- Date: 2026-07-12
- Language: zh-CN
- 上游 OpenSpec 产物: `openspec/changes/<name>/{proposal.md, design.md, tasks.md}` + 6 个 capability spec
- 上游交接包（脚本生成）: `.comet/handoff/design-context.{json,md}` handoff_hash=b6cc83d4...
- 调研产物: `/Users/xiejava/AIproject/pi-web/` (fork of agegr/pi-web v0.7.11)

---

## Step 1b 澄清会话汇总 (4/4 已确认)

### Q1 ✅ Session 元数据存储

**已确认 = 方案 A: 内存 Map + server 启动重建**

- `lib/session-meta.ts` 导出 `Map<realSessionId, {userId, projectId, createdAt}>`
- server 启动扫 `~/.pi/agent/sessions/**/*.jsonl`，无法反推 user_id 的 session 标 `userId=null`（**仅 admin 可见**）
- 路由 read-path 命中时调 `recordSessionMeta(id, user, projectId)` 写入
- 验证基础: fork 现有 `SessionManager.listAll()` 已列举 sessions + cwd + created

### Q2 ✅ Project 切换是否踢旧 session

**已确认 = 方案 c: 不踢, session 锁死创建时 project**

- session 元数据锁住首次创建时的 cwd + projectId, 永不修改
- 切换 Project 仅影响 `users.last_project_id`; 下一次新建 session 才用新 project
- 优点: 贴合 fork RpcSessionManager 自然语义

### Q3 ✅ Middleware 例外清单精细度

**已确认 = 方案 a: 默认拦截 /api/*, 仅 user auth 路由例外**

- `middleware.ts` 的 `config.matcher = '/api/((?!auth/|bootstrap/).*)'`
- 例外清单: `/api/auth/*` (fork 已有 5 个 + 我们新加 3 个) + `/api/bootstrap/status`
- 不在范围内: `/`, `/_next/*`, `/favicon.ico` (Next.js 默认排除)
- 解码 JWT, 写 `x-user-id` + `x-user-teams` (JSON 数组) headers; 路由层用 `requireUser(req)` helper 读

### Q4 ✅ E2E smoke 覆盖范围

**已确认 = 方案 a: 仅 UI smoke**

- `tests/e2e/login.spec.ts` 跑 login → change-password → dashboard
- Session E2E (mocked) 推到 M2; M1 CI 零 external dep

---

## 已确认的技术方案 (Step 1c 待用户最终确认)

### 架构

在 fork ([xiejava1018/pi-web](https://github.com/xiejava1018/pi-web)) 之上叠加多用户封装层。不重写 fork, 不引入 sandbox runtime, 不引入新 SessionBus。

### 数据层 (Prisma + SQLite)

```
users     (id cuid, username, password_hash, must_change_password, created_at, ...)
teams     (id cuid, name, owner_user_id, created_at, ...)
team_members (team_id, user_id, role: 'OWNER' | 'ADMIN' | 'MEMBER', joined_at, ...)
projects  (id cuid, team_id, name, root_path, created_by, created_at, ...)
```

未来表 schema 预留 (M2/M3 启用):
- `model_providers` (M2: Team-shared API Keys)
- `agent_sessions` (M2: server-rebuild 升级到 Prisma row)
- `session_shares` (M2: SessionShare N:M)

### 认证层

- `lib/auth-provider.ts` interface `{ authenticate, revoke }`
- `LocalPasswordAuthProvider`: bcryptjs (cost 10) + jose JWT + HttpOnly cookie `pw_at` (15 min)
- `lib/bootstrap.ts` + `scripts/bootstrap-root.ts` (dev/prod 起跑前): root owner + 随机密码写入 stdout `[BOOTSTRAP]` 一行
- `middleware.ts` 拦截 `/api/((?!auth/|bootstrap/).*)`, 解 JWT 注入 `x-user-id` + `x-user-teams` headers
- 路由层 `assertUser(req)` + `assertRole(req, teamId, 'ADMIN'|'OWNER')` helper

### 路径安全 (Project binding)

- `lib/path-safety.ts::assertWithinRoot(absolutePath, rootPath)` —— 主动校验语义
- 沿用 fork 的 `lib/file-access.ts::allowFileRoot(path)` —— "允许" 语义, 把 Project.root_path 加进 globalThis cache
- POST /api/projects 同步两步: assertWithinRoot (校验) + allowFileRoot (写入 cache)

### Session 元数据

- `lib/session-meta.ts` 内存 `Map<realSessionId, {userId, projectId, createdAt}>`
- server 启动时 `SessionManager.listAll()` → 每条建 meta row, userId 标 null
- 三路并集可见性: `user_id = me OR role IN (admin, owner) [WHERE team match] OR me IN session_shares`
- 匿名 (userId=null) session: 仅 admin 可见
- Project 切换不踢旧 session

### UI 改造

- sidebar 的 cwd 输入框改 Project dropdown
- admin 添加 Project 路由 (POST /api/projects)
- "last_project_id" 写 user 维度, 用于下次 new session

### 测试策略

- Vitest: 路径白名单 fuzz (必需)
- Playwright: `tests/e2e/login.spec.ts` smoke (login → change-password → dashboard)

### 脚手架

- Playwright config + 1 个 smoke spec
- Dockerfile single-stage (仅 build 验证, 详细部署文档推 M3)
- next-intl 安装, en.json 内容齐, zh.json 占位

---

## 关键取舍与风险

### 取舍

- **放弃 "agent_sessions 表同步持久化"** 以避免大改 fork; server 重启后仅 admin 可见匿名 session 至 first-touch
- **放弃 M1 多策略 i18n 实现** (next-intl key 占位 + en 内容); 中英文本完整切到 M3
- **放弃 M1 docker-compose/卷挂载 README**; M1 最小 Dockerfile, 详细部署策略推 M3

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| Server 重启后匿名 (userId=null) session 可视性困惑 | 文档说清楚; UI 提供 "show all team sessions" 视图区分自己创建的与匿名 |
| Fork upstream 升级改 `.jsonl` 格式 | package.json 不带 `^`; CI 跑解析回归 |
| Middleware matcher 不命中新加路径 | 文档警示; CI 跑一次 401 失败 test 阻止漏配 |
| Project 切换不踢 session 之后用户困惑 "为什么 session 还在旧 project" | UI 在 session 卡片显示 project 名; 切换 Project 时显示 "Your open sessions will continue in their original projects" |
| 上游 `SessionManager.listAll()` 性能 | fork 已有 `globalThis.__piSessionListPromise` 单例保护; M1 不引入新瓶颈 |

---

## Spec Patch (回写到 OpenSpec delta spec)

### Patch 1: `multi-tenant-team-model/spec.md`

**新增 requirement**: 三路并集可见性 + 匿名 session 兜底

> The system MUST treat sessions whose userId was never assigned (server-restart residue) as anonymous. Anonymous sessions SHALL appear in the lists of team admins and owners; members SHALL NOT see anonymous sessions even if their shared_with predicate otherwise matches.

### Patch 2: `agent-session-in-process/spec.md`

**Scenario 增补**: server 启动扫描 .jsonl 时如何标 userId=null

> **WHEN** server starts and `SessionManager.listAll()` returns sessions previously bound to userIds that no longer exist in the database
> **THEN** `recordSessionMeta(id, null, projectId)` is called for each such session; the read-path returns 403 to non-admin members asking for those sessions

---

## 上下文压缩恢复

如果上下文被压缩, 重新加载这些文件继续:
- `openspec/changes/pi-web-generalized-m1-runnable/.comet/handoff/brainstorm-summary.md`
- `openspec/changes/pi-web-generalized-m1-runnable/.comet/handoff/design-context.md`
- `openspec/changes/pi-web-generalized-m1-runnable/.comet/handoff/design-context.json`
