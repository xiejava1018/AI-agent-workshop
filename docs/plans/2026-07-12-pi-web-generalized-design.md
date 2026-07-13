---
title: "pi-web 通用 web 多用户 AI agent 工作台设计"
date: 2026-07-12
type: design
tags: [pi-web, agent-harness, multi-tenant, saas, self-hosting, design]
status: validated-by-brainstorming
based_on:
  - "[[pi-web]]"
  - "[[pi-web-multi-tenant-ai-minisoc-design]]"
summary: "把 pi-web 改造成通用 web 多用户 AI agent 工作台（自托管 SaaS 形态）：单进程服务多人，Team 作为顶层隔离单元，会话私有 + 显式分享，host 路径作为项目根目录；保留原文档的硬约束（路径白名单 / .jsonl 会话格式不重写 / 无状态资源），剥离 AI-miniSOC 专属层（无 SSO 入口、无上下文桥接、无 SOC 字段），通过接口抽象留下扩展位（AuthProvider / SessionBus / webhook）；用 M1/M2/M3 三里程碑替代原 4 阶段路径，每里程碑独立可 demo。"
---

# pi-web 通用 web 多用户 AI agent 工作台

## 0. 背景与决策

### 0.1 与原设计文档的关系

来源 [[pi-web-multi-tenant-ai-minisoc-design]] 是为 **AI-miniSOC（垂直 SOC 场景）量身定制**的：身份单点 + 上下文桥接（告警 ID / IOC / 项目 ID 同步）+ 同域子路径嵌入，总工作量 16-22 天。

本文档回答不同的问题：**做一个通用 SaaS / 自托管产品**，让任何小团队（5-30 人）能拉起一个多人共享的 pi coding-agent web 工作台。

### 0.2 范围决策记录（2026-07-12 brainstorming）

| 决策 | 选择 | 理由 / 替代方案 |
|---|---|---|
| 范围 | 通用 SaaS / 自托管 | 替代 AI-miniSOC 嵌入式集成 |
| 租户粒度 | 只面向"团队"单层 | 不引入计费 / 订阅层 |
| 协作模型 | 会话私有 + 显式分享 | 替代 Team 级共享或纯私有 |
| 项目运行环境 | 绑定 host 路径（与 pi-web 现状一致） | 未来可加 Remote / Sandbox 适配器 |
| 添加项目方式 | Admin 手工添加（成员可选） | 不预设 IDE 发现协议 |

---

## 1. 核心架构骨架

### 1.1 部署形态

单一 Next.js 服务端进程，**一次部署、多人共享**——不是"每个用户一个 pi-web 实例"。靠 cookie 会话 + Team 边界做隔离。

适用规模：5-30 人小团队；10 人以下体验最佳，>50 人必须重新评估 in-process 模型。

### 1.2 资源隔离策略

| 隔离维度 | 落点 |
|---|---|
| 会话存储 | `<data_dir>/teams/<team_id>/users/<user_id>/sessions/<sid>.jsonl`（**保留 pi 的 .jsonl 格式，不重写**） |
| 项目根目录 | `projects.root_path`，`AgentSession` 创建时 `cwd` 强制注入，**UI 不允许改 cwd** |
| API Key | Team 共享，DB 中以 AES-256-GCM 加密，密钥来自 `PI_WEB_MASTER_KEY` |
| 文件预览 | 所有 `/api/files/*` 走 `assertWithinRoot(absolutePath, userRoot)`，防 `../`、符号链接、绝对路径 |
| Cookie | HttpOnly + SameSite=Lax；access JWT（短）+ refresh token（长、轮换） |

### 1.3 与原方案的差异点

**剥离**：
- ❌ 无 AI-miniSOC SSO 入口（替换为 AuthProvider 接口，实现只做 Local Password）
- ❌ 无"上下文桥接"层（无告警 ID / IOC / 调查人概念）
- ❌ 无"带 alert_id 的会话"专属字段（改为通用 `metadata: jsonb`）

**保留**（原方案反向约束依然成立）：
- ✅ 用户/项目 ID 用 string/cuid（不用自增）
- ✅ 保留 AuthProvider 抽象 → 未来可接 OIDC / SAML
- ✅ webhook 钩子位（用作通用"会话事件总线"，未来可接 Slack / Teams）
- ✅ 不重写 pi 的 `.jsonl` 会话格式
- ✅ 不动 pi 源码

---

## 2. 数据模型与权限

### 2.1 核心实体

```
Team (1) ─────┬──── (N) TeamMember ───── (1) User
              │            │
              │            └─ role: 'owner' | 'admin' | 'member'
              │
              ├──── (N) Project (host 路径，所有权 = Team)
              │       └─ root_path (string, assertWithinRoot)
              │
              ├──── (N) ModelProvider (归属 Team)
              │       ├─ base_url, api_key_encrypted
              │       └─ is_active: bool
              │
              └──── (N) AgentSession
                      ├─ user_id (创建者)
                      ├─ project_id (cwd 来源)
                      ├─ visibility: 'private' | 'shared'
                      ├─ metadata: jsonb (扩展位，不预设字段)
                      └─ jsonl_path

SessionShare (N:M Session ↔ TeamMember)
  ├─ session_id, shared_with_user_id
  └─ level: 'read' | 'continue'
```

### 2.2 权限矩阵

| 操作 | owner | admin | member |
|---|---|---|---|
| 删除 Team | ✓ | ✗ | ✗ |
| 邀请/移除成员 | ✓ | ✓ | ✗ |
| 添加/删除 Project | ✓ | ✓ | ✗ |
| 添加/删除 ModelProvider | ✓ | ✓ | ✗ |
| 查看全部 session | ✓ | ✓ | 仅自己 + 被分享的 |
| 创建 session | ✓ | ✓ | ✓ |
| 分享 session | ✓ | ✓ | ✓（仅自己创建的） |

### 2.3 关键工程含义

- **Session 列表查询**永远三路并集：`user_id = :me OR :me IN (sharing) OR :me_role IN (owner,admin)`；必须走索引，否则 N+1。
- **`users` 表是全局的**（用户可加入多 Team）；`role` 在 `team_members` 上，**不放 `users.role`**——这是与原方案的根本差别。
- **Team 是隔离边界**：所有 `session` / `project` / `model_provider` 都带 `team_id`，跨 Team 数据完全不可见。
- 所有内部 ID（user/team/project/session/provider）**全部 string/cuid**，不用自增整数——为未来接外部账号系统预留位。

---

## 3. AgentSession 调度 + SSE fan-out

### 3.1 性能悬崖的真相

`AgentSession` 是常驻对象，in-process 模型下，10 人并发时第 11 个用户的请求必须排队。**原方案的 `Map<userId, AgentSession>` 只识别了"按用户隔离"，但没处理"同用户多个 session 互不阻塞"**——必须在这里钉死。

### 3.2 双层锁（推荐方案）

| 维度 | 锁 | 理由 |
|---|---|---|
| **per-session** mutex | 同一 session 不能并发 `prompt()`（AgentSession 不可重入） |
| **per-user** 信号量 | 同时活跃的 session 数 ≤ N（默认 **3**），防止单用户开 100 session 吃光进程 |

**修正原方案的"用户串行锁"**：用户串行 = 同一用户跨 session 互相阻塞 = **bug**。正确做法是 per-session mutex + per-user 信号量（节流而非串行）。

### 3.3 SessionBus 骨架

```ts
class SessionBus {
  private agents = new Map<sessionId, AgentSession>()
  private subs   = new Map<sessionId, Set<{ userId; tabId; controller }>>()
  private sessionLocks = new Map<sessionId, Promise<void>>()
  private userQuota    = new Map<userId, Semaphore>(3)

  async send(sessionId, message) {           // per-session mutex
    await this.sessionLocks.get(sessionId) ?? Promise.resolve()
    try {
      const session = this.agents.get(sessionId) ?? await this.resume(sessionId)
      for await (const evt of session.prompt(message)) this.fanOut(sessionId, evt)
    } finally { /* release */ }
  }

  subscribe(sessionId, userId, tabId, controller) {
    // 第一步：权限校验
    if (!canAccess(sessionId, userId)) throw 403
    (this.subs.get(sessionId) ?? new Set()).add({ userId, tabId, controller })
  }
}
```

### 3.4 SSE fan-out 必做项

1. **`Last-Event-ID` 重连回放**：服务端把每个事件 offset 写在 .jsonl；客户端重连时带 `Last-Event-ID` 切片回放未送达事件。**这是 SSE 的标准用法，pi-web 现状没做，通用版必须做。**
2. **权限校验放在订阅时，不放在事件生成时**——事件已落地，性能优化前先堵权限漏洞。
3. **单 process 上限**：活跃 session ≤ **50**，超出排队 / 503。这是硬限额，不是优化点。

### 3.5 MVP 不做（避免 YAGNI）

- ❌ 多进程 + sticky session 负载均衡
- ❌ 优先级队列 / 付费分层
- ❌ 断点续传 agent state（崩溃后只能新开 session）

---

## 4. 认证 / API Key / Self-hosting

### 4.1 AuthProvider 接口（关键抽象）

```ts
interface AuthProvider {
  authenticate(credential: unknown)
    : Promise<{ userId: string; displayName: string }>
  revoke(userId: string): Promise<void>
}

class LocalPasswordAuthProvider implements AuthProvider { /* MVP */ }
// 未来：OIDC / SAML / GitHub OAuth —— 都实现同一个接口
```

**MVP 实现要点**：
- `bcryptjs` 哈希 + 用户名密码
- Admin 邀请用户时填临时密码 + **首次登录强制改**
- 接口成形后，接 SAML / GitHub OAuth 不动业务代码

### 4.2 双重 Token

| Token | 有效期 | 存储 | 用途 |
|---|---|---|---|
| `pw_at` (access JWT) | 15min | HttpOnly cookie | 请求鉴权 |
| `pw_rt` (refresh token) | 30day | HttpOnly cookie + DB hash | 刷新 access + **每次刷新旋转** |

请求 middleware 流程：access 有效 → 放行；access 过期但 refresh 有效 → 签新 access + 旋转 refresh；都过期 → 清 cookie 跳 `/login`。

**比原方案改进**：原方案单 JWT 单 token 不可回收 / 不可黑名单；**双重 token + refresh 旋转是行业最低标准**。

### 4.3 API Key 存储

| 数据 | 存储方式 | UI 可见性 |
|---|---|---|
| `Provider.api_key` | DB 中 AES-256-GCM 加密 | **永远不明文进 UI / 日志**，settings 只显示 "已配置 Anthropic" 状态 + 重置按钮 |
| `PI_WEB_MASTER_KEY` | 环境变量（≥ 32B 随机） | 不进 DB / 不进 git |
| 测试调用 | Server 内存中用一次即丢 | 不缓存 |

### 4.4 Self-hosting 底线

1. **首启动自动生成 root owner + 随机密码**写日志，提示立即登录改密码。
2. **`PI_WEB_MASTER_KEY` 缺失 → 启动失败**（不静默 default）。
3. **数据目录默认 `./data`**（非 `~/.pi`），通过 `PI_WEB_DATA_DIR` 覆盖。
4. **DB 选型**：SQLite 开发 + Postgres 生产，**只支持两个引擎**。
5. **Prisma / Drizzle migration** 跑通，schema 版本可见。

### 4.5 MVP 不做（YAGNI）

- ❌ SAML / OIDC / OAuth provider（接口预留）
- ❌ Helm chart / k8s operator（提供 Dockerfile，用户自包）
- ❌ 备份/恢复工具（文件系统快照 / RDS 备份替代）
- ❌ 多 DB 支持（SQLite + Postgres 两个足够）

---

## 5. 里程碑（M1 / M2 / M3）

> 重排原文档的 4 阶段 14-22 天：剥离 AI-miniSOC 节省的工作 ≈ 我们加上的双重 token + API Key 加密 + SSE 回放 + 接口抽象的工作，所以总工作**量级相近**，但路径**每步可独立 demo**。

### 5.1 M1 — "能跑通"（自己能用）

**包含**：默认 Local Password + Team/Member 表 + Project CRUD（host 路径列表）+ 个人 session 跑通 + per-session mutex

**Demo**：拉一个 Git repo 当项目，开 2 个 tab 发消息，效果与原 pi-web 一致，**多了一层登录**

**用户感知**：能用、但用不爽

### 5.2 M2 — "能用"（自托管小团队可用）

**包含**：session 列表 + 搜索 + share dialog + Admin UI（邀请 / 角色 / Provider）+ API Key 加密 + access/refresh 双 token + per-user 信号量（限 3）+ SSE 重连补事件 + Postgres 支持 + 50 session 全局限额 + 首启动 root owner 流程

**Demo**：邀请 5 个同事，每人跑自己的 session；owner 配一次 Anthropic Key 全 Team 复用；有人误用 `../etc/passwd` 被路径白名单拦下

**用户感知**：**自托管小团队能用**

### 5.3 M3 — "可发布"（对外可推荐）

**包含**：migration 跑通 + Dockerfile + 数据目录挂载说明 + `/api/admin/stats`（活跃 session / token 用量）+ 通用 webhook 钩子位（`session.created/completed/aborted`）+ Model Provider 测试调用按钮 + 备份恢复 README

**Demo**：部署到一台 8GB VPS，10 人小团队实跑一周；admin 看到用量统计；接 Slack webhook 通知会话结束

**用户感知**：**对外可推荐**

### 5.4 路线图之外（M3 后 / 不做）

- SAML / OIDC 实现（接口已就位）
- Sandbox 沙箱执行
- Docker 官方镜像 / 自动发布
- 计费 / 订阅
- 多实例 + sticky session 负载均衡

### 5.5 验证级别（按 scale 规则）

| 里程碑 | level | 验证内容 |
|---|---|---|
| M1 | light | 自测 + e2e 跑通 |
| M2 | medium | 多浏览器测试 + 路径白名单 fuzz + 安全 review |
| M3 | heavy | 5+ 用户实跑一周 + 崩溃恢复 + DB 升级路径演练 |

---

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 上游 pi 升级改 `.jsonl` 格式 | 锁定 `pi-coding-agent` 版本 + CI 跑解析回归 |
| 单进程 OOM | `projects.root_path` 大小限制 + agent 输出 token 限额 + 50 session 全局上限 |
| 路径穿越 | 所有文件 API 走 `assertWithinRoot`，加单测覆盖 `..` / 符号链接 / 绝对路径 |
| Cookie CSRF | SameSite=Lax + 双 token（access + 旋转 refresh）|
| Admin 密码泄露 | bcrypt + 强制首次登录改密 + 失败次数限流 |
| API Key 泄漏 | UI 不显示明文 + 日志不打印 + 环境变量管 master key |
| Refresh token 泄漏 | 每次刷新旋转 + DB hash 校验 + 检测到复用全 family 失效 |
| In-process 模型扩展瓶颈 | 单 process 50 session 硬上限 + M3 后重新评估多进程方案 |

---

## 7. 后续动作

- [ ] **进 build 阶段前**，必须有：(a) 工作区隔离确认（branch / worktree）(b) 执行方式 / TDD 模式 / 代码审查模式确认
- [ ] M1 完成后做一次 design 复查：核对外部接口是否与本设计一致
- [ ] M2 完成后做一次 performance 复查：50 session 上限是否需要调整
- [ ] M3 完成后才能开始路线图之外的功能

---

## 8. 决策可逆性

| 决策 | 可逆成本 | 不可逆后果 |
|---|---|---|
| Team 单层（不留 Workspace 嵌套） | 中：迁移数据要改所有表的 team_id 关联 | 无 |
| 会话默认私有 | 低：加 visibility=team 是 schema 级 ALTER | 无 |
| 绑 host 路径（无 Sandbox） | 高：要建 sandbox runtime + 资源调度 | 无（MVP 阶段都可回退） |
| AuthProvider 接口 | 低：换实现不换接口 | 无 |
| API Key 永不显示明文 | 不可逆（用户已看不见了） | 用户失去"复制再用"的能力（接受） |
| SQLite + Postgres 双支持 | 中：换 ORM 也行，但要重写 migration | 无 |
| String ID + cuid | 高（迁移成本） | 数字 ID 自增的相关假设一旦做了就回不去 |

---

## 9. 与原文档的关系（一句话总结）

> 原文档是 "pi-web → 多租户 → 嵌入 AI-miniSOC"；本设计是 "pi-web → 多租户 → 通用 SaaS / 自托管"，**砍 SOC 上下文**，**加通用基础设施**（双重 token / 接口抽象 / webhook 钩子位），**保留所有硬约束**（路径白名单 / .jsonl 格式不变 / 不动 pi 源码）。
