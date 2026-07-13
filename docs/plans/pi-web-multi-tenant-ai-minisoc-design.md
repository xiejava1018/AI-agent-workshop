---
title: "pi-web 多租户改造 + 嵌入 AI-miniSOC 设计"
date: 2026-07-06
type: synthesis
tags: [pi-web, agent-harness, multi-tenant, sso, ai-minisoc, soc, design]
summary: "把 [[pi-web]] 改造成多租户（4 阶段 14-20 天）并通过'身份单点 + 上下文桥接 + 同域子路径'三层嵌入到 AI-miniSOC（额外 4-5 天嵌入层），让 SOC 分析师在 AI-miniSOC 告警详情页一键进入带告警上下文的 agent 会话工作台；总工作量 16-22 天，分 M1/M2/M3 三个里程碑上线"
lastReviewed: 2026-07-06
---

# pi-web 多租户改造 + 嵌入 AI-miniSOC 设计

## 背景与定位

[[pi-web]] 是 [[pi]] 的本地 Web UI（1k star，Next.js 16 + React 19），当前是单用户 localhost 工作台。AI-miniSOC 是 SOC 平台，已有主 Web UI + 自己的 RBAC。本设计回答两个问题：
1. **可行性**：pi-web 能否改造成多租户？
2. **嵌入形态**：改造完后如何接入 AI-miniSOC？

**核心结论**：可行，但**不是"单点"（SSO）——是"半集成"：共享身份 + 共享上下文 + 独立部署形态**。

> 与 [[oh-my-pi]] 的"fork 改内核"路线不同，pi-web 改造**不动 pi 源码**，只在 Next.js 服务端包装多租户层 + 嵌入层。

---

## 一、可行性边界

### ✅ 可以做到

| 维度 | 现状 | 改造后 |
|---|---|---|
| 部署 | `npx @agegr/pi-web` 起一个 Next.js | 同上，**单进程服务多人** |
| 账号 | 无 | 用户名+密码+HttpOnly Cookie（嵌入场景改 JWT） |
| 工作目录 | `cwd` 来自 host | 每用户绑一个项目根目录 |
| 会话存储 | `~/.pi/agent/sessions/*.jsonl` | 按 `user_id` 隔离的存储层 |
| 模型配置 | `~/.pi/models.json` | Admin 后台统一管理（嵌入场景由 AI-miniSOC 同步） |
| AgentSession | `createAgentSession()` in-process | 同上，但 `cwd` 强制传入用户根目录 |

### ⚠️ 必须面对的硬约束

1. **in-process AgentSession 不变** — 单 Node 进程跑 agent，卡住的会话可能拖慢他人；不适合高并发（10 人以下小团队 OK，100 人不行）
2. **模型配置从"用户私有"变"平台私有"** — 体验折衷，换来团队统一计费与防 Key 泄漏
3. **必须重写文件预览 API** — 路径穿越防护（用户传 `../../../etc/passwd` 必须拦掉）+ 白名单根目录
4. **pi 的 `.jsonl` 会话格式要解析** — 仍写 `.jsonl` 到 `users/<user_id>/sessions/` 下，但通过 DB 索引查询，不再直接扫目录

---

## 二、多租户改造 4 阶段路径

> 总原则：**不动 pi 源码，只在 Next.js 服务端包装多租户层**。每阶段独立可上线。

### 阶段 1：存储 + 认证层（地基，3-7 天）

| 工作项 | 改造点 |
|---|---|
| 选型 | Next.js + Prisma + SQLite（起步）/ Postgres（生产） |
| 新增表 | `users(id, username, password_hash, role, created_at)`、`sessions(id, user_id, project_id, title, jsonl_path, ...)`、`projects(id, owner_id, name, root_path, ...)`、`model_providers(id, name, base_url, api_key_encrypted, model_list, is_active)` |
| 认证 | `bcryptjs` 哈希 + `jose` 签 JWT + HttpOnly Cookie |
| 中间件 | Next.js middleware 做 session 校验，写入 `req.user` |
| API 改造 | 所有 `/api/agent/...`、`/api/sessions/...` 前面加 `withAuth(user => ...)` 包裹 |
| 路径白名单 | 新增 `lib/path-safety.ts`：`assertWithinRoot(absolutePath, userRoot)`，所有文件预览 API 强制调用 |

### 阶段 2：会话读写层重写（3-5 天）

| 工作项 | 改造点 |
|---|---|
| 会话存储 | 仍保留 `.jsonl` 格式（pi SDK 内部读写这个格式，自己写等价格式工作量大且脱节），路径改为 `<data_dir>/users/<user_id>/sessions/<session_id>.jsonl` |
| 会话浏览 | `/api/sessions` 查 DB 按 `user_id` 过滤 |
| 会话续接 | 读 `sessions.jsonl_path` → 用 pi SDK 的 session loader |
| Fork | 复制 jsonl 到新 session row，关联同一 `parent_id` |
| AgentSession 创建 | `cwd` 强制 = `user.project.root_path`，**不允许用户在 UI 改 cwd** |

### 阶段 3：AgentSession 调度层（3-5 天）

| 工作项 | 改造点 |
|---|---|
| SessionManager | 单例 → `Map<userId, AgentSession>` |
| 串行锁 | 每用户一个 mutex（`async-mutex`），避免同用户多 tab 操作导致事件交叉 |
| SSE 多路 | `app/api/agent/[id]/events` 改成 fan-out：同一 AgentSession 事件可推到该用户多个 tab |
| 配额 | （可选）每用户最大并发会话数限制 |
| 监控 | `/api/admin/stats`：在线用户、活跃会话、token 用量 |

**隐藏坑**：pi 的 `AgentSession` 是"一个用户一个"还是"一个会话一个"？需看 SDK 源码确认。如果一个 tab 一个 session，串行锁就按 session id 锁。

### 阶段 4：Admin 后台 + 模型管理（2-4 天）

| 工作项 | 改造点 |
|---|---|
| 新增角色 | `role: 'admin' \| 'user'` |
| Admin UI | `/admin` 路由：用户管理、项目管理、模型 Provider 管理 |
| 模型选择器 | 前端拿模型列表改为拉 `/api/admin/model-providers?is_active=true` |
| API Key 存储 | DB 里用 AES-256-GCM 加密（密钥来自 `PI_WEB_MASTER_KEY` 环境变量） |
| 用户体验 | 用户 settings 页看不到 Key 明文，只看到"已配置 Anthropic / OpenAI"状态 |

### YAGNI 清单

| 不做 | 原因 |
|---|---|
| ❌ 改 pi 源码支持多租户 | 失去跟随上游的能力，维护成本飙升 |
| ❌ 多实例 + 负载均衡 | in-process AgentSession 模式下 sticky session 难做 |
| ❌ Docker 沙箱 | 与"单机部署、in-process"决策冲突 |
| ❌ 个人 Key + 平台 Key 双轨 | 起步阶段会让模型选择逻辑复杂 |
| ❌ OAuth / SSO | 起步不需要，admin 账号 + 用户自助注册足够 |
| ❌ 多人围观 / 协作 | 用户已选"多租户独立"，不做共享 |

### 风险清单

| 风险 | 缓解 |
|---|---|
| 上游 pi 升级改 `.jsonl` 格式 | 锁定 `pi-coding-agent` 版本，CI 跑格式解析测试 |
| 单进程 OOM | `projects.root_path` 大小限制 + agent 输出 token 限额 |
| 路径穿越 | 所有文件 API 走 `assertWithinRoot`，加单测覆盖 `..`/符号链接/绝对路径 |
| Cookie 被 CSRF | `SameSite=Lax` + 简单 CSRF token（form 提交校验） |
| Admin 密码泄露 | bcrypt + 强制首次登录改密 + 失败次数限流 |

---

## 三、嵌入 AI-miniSOC：三层架构

> AI-miniSOC 现状是 SOC 平台 + 已有主 UI + 已有 RBAC + 告警/IOC/调查体系。pi-web 作为**「高级独占入口」**接入。

### 整体形态图

```
AI-miniSOC 主 UI                          pi-web（多租户改造后）
┌──────────────────────────┐         ┌──────────────────────────────┐
│  账号体系 / RBAC             │         │  /sso/callback               │
│  告警 / IOC / 调查          │ ──────► │  (验证 JWT, 建 session)        │
│  审计日志                  │ SSO 跳转 │                              │
│                          │         │  /api/sessions/from-context  │
│  告警详情页                │ ──────► │  (创建带告警上下文的会话)         │
│  「交给 Agent」按钮         │  POST    │                              │
│                          │         │  AgentSession (in-process)   │
│                          │ ◄────── │  ──── ③ webhook: session.completed │
│  告警详情页                │ 回调     │                              │
│  「历史调查」列表            │ ◄────── │  ──── ④ 拉取: /api/sessions?alert_id │
└──────────────────────────┘         └──────────────────────────────┘

身份:  AI-miniSOC 是唯一账号源, pi-web 只接受 JWT
会话:  用户私有, 但带 alert_id 关联键
部署:  同域子路径 /agent/* (Next.js basePath)
模型:  AI-miniSOC 统一管理, 同步到 pi-web
```

### 层 1：身份单点（SSO）

- AI-miniSOC 主 UI 点击按钮 → 跳到 `pi-web/sso/callback?token=<短期 JWT>`
- JWT payload: `{ user_id, username, role, exp: 5min }`
- pi-web 验证签名（共享 secret 或 RS256 公钥）→ 本地建 session cookie → 重定向到 pi-web 工作台
- pi-web **不再有自己的登录页**——AI-miniSOC 是唯一账号源

### 层 2：上下文桥接（半集成的关键）

| 上下文项 | 从 AI-miniSOC 带过来 | 在 pi-web 落地 |
|---|---|---|
| **告警 ID** | `alert_id=AL-2026-0731-001` | 会话 metadata 存 `alert_id`，UI 显示 |
| **IOC 列表** | `iocs=["ip:1.2.3.4", "hash:abc..."]` | 自动塞进首次 system prompt 或第一条 user message |
| **工作目录** | `project_id=P-1234` | 自动绑定 `projects.root_path`（不再让用户选） |
| **时间窗** | `time_range=[...]` | 写入会话 metadata |
| **调查人** | AI-miniSOC 用户 ID | 写到会话的 `investigator_id` |

**关键 API**（新增）：
- `POST /api/sessions/from-context` — AI-miniSOC 后端调用，创建带上下文的会话，返回 URL
- `GET /api/sessions?alert_id=AL-xxx` — AI-miniSOC 上"查看此告警的所有调查会话"

### 层 3：部署形态

| 方案 | 推荐场景 | 与多租户改造的关系 |
|---|---|---|
| **同域子路径**（`ai-minisoc.local/agent/*`） | 内部小团队，运维简单 | pi-web 改成"可挂载在 basePath 下"，需处理 Next.js basePath |
| **同域不同子域**（`agent.ai-minisoc.local`） | 中型团队，反向代理统一管 TLS/鉴权 | pi-web 部署不变，反代加 OIDC/SAML |
| **独立子域**（`agent.internal`） | 大团队/多业务线 | pi-web 完全独立部署，仅靠 JWT 信任 |

**推荐起步**：**同域子路径**，Next.js 16 原生支持 `basePath`，几乎零额外工作。

---

## 四、关键反向约束（多租户改造时就应留接口）

> 这条最重要。**不预先留接口，改造完还是要返工**。

| 改造点 | 反向约束 |
|---|---|
| **阶段 1 认证** | ❌ 不做密码登录；✅ 直接做 JWT 验证中间件，留 `authProvider` 抽象 |
| **阶段 1 用户表** | `users.id` = AI-miniSOC user_id（直接用 string，不自增）；`users.username` / `role` 从 JWT 同步 |
| **阶段 2 项目表** | `projects.id` = AI-miniSOC project_id；root_path 由 AI-miniSOC 同步过来，pi-web 不让用户在 UI 上传/选 |
| **阶段 3 SSE/调度** | 预留 webhook 钩子：`session.created` / `session.completed` → 回调 AI-miniSOC（用于在告警页显示"调查中"状态） |
| **阶段 4 Admin** | **Admin 路由弱化**——大部分配置由 AI-miniSOC 同步过来；pi-web 只保留"模型 Provider"管理（API Key 也由 AI-miniSOC 推） |

---

## 五、工作量估算与里程碑

### 改造工作量（含嵌入）

| 阶段 | 独立改造 | 嵌入 AI-miniSOC | 差额 |
|---|---|---|---|
| 阶段 1 认证 | 5-7 天 | **3-4 天**（不做密码，改 JWT） | **-2 ~ -3 天** ✅ |
| 阶段 2 会话层 | 3-5 天 | 3-5 天（不变） | 0 |
| 阶段 3 调度层 | 3-4 天 | **4-5 天**（加 webhook 回调） | +1 |
| 阶段 4 模型管理 | 3-4 天 | **2-3 天**（弱化为接收同步） | -1 |
| **新增：嵌入层** | — | **4-5 天**（SSO + 上下文 API + 回调） | +4-5 |
| **合计** | **14-20 天** | **16-22 天** | +2 |

> 总工作量增加不大，因为"不做密码"省下来的刚好覆盖"做 SSO + 上下文桥"。

### 三个里程碑

| Milestone | 内容 | 可演示场景 | 工作量 |
|---|---|---|---|
| **M1**（~6 天） | 阶段 1（JWT 认证）+ 嵌入层（SSO 跳转 + 上下文 API） | AI-miniSOC 上点告警 → 跳到 pi-web → 自动创建带告警上下文的会话 | 6 |
| **M2**（+5 天） | 阶段 2 + 阶段 3（会话层 + 调度层） | 多用户并发用，路径白名单生效 | 5 |
| **M3**（+5 天） | 阶段 4（弱化版）+ 回调 webhook | 告警详情页能看到会话状态变化 | 5 |

---

## 六、为什么不是"单点（SSO）"

用户原问"是做单点吗"，答案是否。单点（SSO）只是嵌入的一层。完整嵌入要做三件事：

| 层 | 任务 | 工作量 |
|---|---|---|
| 身份单点 | SSO 跳转 + JWT 验证 | 2 天 |
| **上下文桥接** | 告警/IOC/项目 ID 带入 | 2-3 天 |
| **回调通知** | session.completed → AI-miniSOC 更新告警状态 | 1 天 |

**少了上下文桥接和回调通知，pi-web 就只是"AI-miniSOC 里的另一个 web 应用"，不是"AI-miniSOC 的高级独占入口"**。

---

## 七、与既有知识库的关联

### 反链补全（占位 + 后续 lint 处理）

下面这些关系作为本综合页的"双向链接契约"，等本次新页入索引后再统一回链：

- 本页 → [[pi-web]]（多租户改造的对象）
- 本页 → [[pi-web-ui-comparison]]（嵌入式集成是 [[pi-web]] 相对其他方案的差异化推荐点）
- 本页 → [[pi]]（上游基座）
- 本页 → [[harness-and-loop-engineering]]（多租户属 Harness 的"传输/UI 抽象"层扩展）
- 本页 → [[ai-minisoc-codebase-survey]]（AI-miniSOC 已有 Pi Agent JSON-RPC 集成，pi-web 可视为其 Web 端扩展）
- 本页 → [[ai-minisoc-agent-integration-strategy]]（与"中间路线"推荐一致：保留自研可控 + MCP 扩展）
- 本页 → [[agentic-soc]]（这是 Agentic SOC 在"分析师工作台"维度的具体落地）

### 后续动作

- [ ] 给 [[pi-web]] 实体页"对 AI-miniSOC 的启示"段加一行：本设计是把"启示"落地的具体路径
- [ ] 给 [[pi-web-ui-comparison]] 对比页"对 AI-miniSOC 的选型启示"表新增一行：**嵌入式集成** → pi-web + 多租户 + SSO/上下文桥
- [ ] 月度造钟纪律[[career-moat]]复盘时检查本设计是否启动

---

## 八、可信度声明

- **可行性判断**：高（基于 pi-web 的源码结构和 Next.js 中间件能力评估）
- **工作量估算**：中（4 阶段拆解基于经验，具体实施可能 ±20% 浮动）
- **嵌入 API 设计**：中（JWT payload 字段、上线 URL 结构需与 AI-miniSOC 现有路由约定对齐）
- **反向约束的优先级**：高（不预先留接口必然返工）
- **风险清单**：中（上游 pi 版本变化是最大不可控因素）

---

## 来源

- [[pi-web]] — 改造对象（Next.js 16 + React 19 本地 Web UI）
- [[pi-web-ui-comparison]] — Pi Web UI/前端生态对比
- [[pi]] — 上游基座
- [[oh-my-pi]] — 对照路线（fork 改内核 vs 不碰内核）
- [[harness-and-loop-engineering]] — 多租户属 Harness 的"传输/UI 抽象"层扩展
- [[ai-minisoc-codebase-survey]] — AI-miniSOC 现有 Pi Agent 集成（Node 子进程 JSON-RPC）
- [[ai-minisoc-agent-integration-strategy]] — "中间路线"推荐的扩展方向
- [[agentic-soc]] — Agentic SOC 框架
- 来源总结：`sources/2026-07-06-pi-web-multi-tenant-ai-minisoc-design`（指向 `notes/work/2026-07-06-pi-web-multi-tenant-ai-minisoc-design.md`）