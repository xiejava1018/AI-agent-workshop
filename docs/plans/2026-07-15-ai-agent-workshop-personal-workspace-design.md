# AI-agent-workshop 个人工作台 + 统一 Admin 设计文档

> 版本：v1.0
> 日期：2026-07-15
> 状态：已评审，由 M3 实现
> 目标：把现有"团队共享" pi-web 升级为"每用户独立工作台"，前端迁移到 Vue 3 / Element Plus，后端保留 Node 作为 BFF 与 Agent 引擎宿主。

---

## 0. 背景与动机

当前 AI-agent-workshop（fork 自 pi-web v0.7.11）已实现：

- 多用户登录、JWT 双 Token、强制改密
- 团队（Team）/ 角色（OWNER / ADMIN / MEMBER）
- 会话（session）按团队可见，跨团队隔离
- 项目（Project）绑定团队，工作目录共享
- 基础 admin 创建用户（仅创建，无修改/注销）
- 模型配置按 cwd 本地存储

**痛点：**

1. 会话和工作目录以"团队"为隔离单位，同团队成员互见，无法满足"每人独立工作台"。
2. 用户管理只有"添加"，缺少重置密码、停用、删除。
3. 模型配置是本地文件级，admin 无法统一管理平台级模型与密钥。
4. 前端是 React/Next.js，与 AI-miniSOC 的 Vue 技术栈不一致，重复造轮子。

**目标：**

1. 每个用户登录后只看到自己的个人工作台（独立目录 + 独立会话）。
2. admin 可完成用户全生命周期管理：添加、重置密码、停用/启用、删除。
3. admin 统一管理全局模型配置（可用模型 + provider key）。
4. 前端复用 AI-miniSOC 的 Vue 3 + Element Plus + Pinia 框架。

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────┐
│  Vue 3 + Element Plus + Pinia (新前端)                   │
│  复用 AI-miniSOC 框架：登录 / 布局 / 用户管理 / 请求封装    │
│  - /login          登录页                                │
│  - /workspace      个人工作台（聊天 + 会话 + 文件）        │
│  - /admin/users    用户管理（admin）                     │
│  - /admin/models   全局模型配置（admin）                 │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP / SSE (EventSource)
┌──────────────────────▼──────────────────────────────────┐
│  Node.js BFF（保留现有 Next.js API 层，逐步瘦身）          │
│  - 必须运行 pi SDK，AgentSession 仍在进程内               │
│  - 提供 REST + SSE 接口给 Vue 前端                        │
│  - 鉴权 / 用户管理 / 模型配置 / 会话隔离                  │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  Prisma + SQLite（默认） / Postgres（生产）                │
│  - User / Team / Project / SessionShare / AuditLog      │
│  - RefreshTokenBlacklist / GlobalModelConfig            │
└─────────────────────────────────────────────────────────┘
```

**关键原则：**

- 前端只负责展示与交互，不直接碰 pi SDK。
- BFF 保留 Node，因为 `@earendil-works/pi-coding-agent` 是 TS 库，必须运行在同一个 Node 进程。
- FastAPI 不引入；agent 引擎仍由 Node 托管。

---

## 2. 前端方案：复用 AI-miniSOC 框架

### 2.1 可复用资产清单

| AI-miniSOC 现有资产 | 复用方式 | 备注 |
|---------------------|---------|------|
| `views/login` | 直接复用 | 替换登录接口为 `/api/auth/user-login` |
| `views/system/user` | 扩展改造 | 增加重置密码、停用/启用、删除 |
| `utils/http` | 直接复用 | 封装 axios，支持 SSE 流式 |
| `store/modules/user.ts` | 直接复用 | 保存登录态、用户信息 |
| `store/modules/setting.ts` | 直接复用 | 主题、布局 |
| `components/core/layouts` | 直接复用 | 后台整体布局（侧边栏 + 顶栏 + 多页签） |
| `router/guards` | 直接复用 | 登录守卫、权限守卫 |
| Element Plus 全量组件 | 直接复用 | 表格、表单、弹窗、消息提示 |

### 2.2 需要新增/重写的部分

| 模块 | 说明 | 预估工作量 |
|------|------|-----------|
| **聊天主界面** | 重写 `ChatWindow` / `MessageView` / `ChatInput` | 高（~5000 行 React 需翻译为 Vue） |
| **会话侧边栏** | 重写 `SessionSidebar`，含会话树、运行状态、未读标记 | 中高 |
| **文件浏览器** | 重写 `FileExplorer` / `FileViewer` | 中 |
| **SSE 状态机** | 重写 `useAgentSession.ts` 为 Vue composable | 高（1565 行核心逻辑） |
| **admin 模型配置页** | 新增 `/admin/models` | 中 |
| **admin 用户管理页扩展** | 在 `views/system/user` 基础上加操作列 | 低 |

### 2.3 前端路由设计

```ts
// 静态路由
/login
/forget-password
/exception/403
/exception/404

// 动态路由（登录后）
/workspace           // 个人工作台（默认首页）
  /workspace/chat    // 当前会话
  /workspace/files   // 文件浏览
/admin               // admin 专属
  /admin/users       // 用户管理
  /admin/models      // 全局模型配置
  /admin/audit       // 审计日志（可选，v1.1）
```

**权限控制：**

- 登录守卫：未登录跳 `/login`。
- 角色守卫：`/admin/*` 需要 `OWNER` 或 `ADMIN`。
- 首次登录强制改密：检测 `mustChangePassword`，跳转独立改密页。

---

## 3. 后端方案：Node.js BFF

### 3.1 为什么保留 Node.js

pi SDK（`@earendil-works/pi-coding-agent`）是 TypeScript 库，`AgentSession` 必须运行在 Node 进程内。FastAPI 无法 import 该库。

**结论：后端仍用 Node.js，但逐步从"Next.js 全栈"瘦身为"纯 API BFF"。**

### 3.2 过渡策略

**阶段 1（推荐先落地）：** 保留现有 Next.js API，仅做以下改造：

- 新增/修改接口支持"每用户独立"与 admin 管理。
- 删除或隐藏仅服务于 React 前端的页面路由（`app/[locale]/*`）。
- 把 API 路由作为 Vue 前端的 BFF。

**阶段 2（可选，后续演进）：** 把 API 迁移到 Express/Fastify：

- 当 Vue 前端稳定后，如果希望彻底去掉 Next.js，可将 36 个路由平移到 Express。
- pi SDK 调用代码（`lib/rpc-manager.ts`、`lib/team-auth.ts`、`lib/server-user.ts`）可几乎原样复用。

### 3.3 API 变更清单

#### 3.3.1 用户管理（新增/扩展）

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/admin/users` | 创建用户 | OWNER/ADMIN |
| GET | `/api/admin/users` | 用户列表（分页/搜索） | OWNER/ADMIN |
| GET | `/api/admin/users/[id]` | 用户详情 | OWNER/ADMIN |
| PATCH | `/api/admin/users/[id]/password` | 重置密码 | OWNER/ADMIN |
| PATCH | `/api/admin/users/[id]/status` | 停用/启用 | OWNER/ADMIN |
| DELETE | `/api/admin/users/[id]` | 删除用户 | OWNER/ADMIN |

**删除用户语义：**

- 软删除：标记 `deletedAt`，禁止登录，数据保留（可恢复）。
- 硬删除：删除用户记录，并清理其个人工作目录与会话文件。

#### 3.3.2 模型配置（新增）

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/admin/models` | 获取全局模型配置 | OWNER/ADMIN |
| PUT | `/api/admin/models` | 更新全局模型配置 | OWNER/ADMIN |
| POST | `/api/admin/models/test` | 测试 provider 连通性 | OWNER/ADMIN |

**配置内容：**

- 可用模型白名单（`provider/modelId`）。
- 各 provider 的 API Key（加密存储）。
- 默认模型。
- 是否允许用户覆盖（v1 先关闭，统一由 admin 控制）。

#### 3.3.3 会话与项目（改造）

| 方法 | 路径 | 说明 | 变更 |
|------|------|------|------|
| GET | `/api/sessions` | 会话列表 | 从"团队并集"改为"当前用户个人会话" |
| POST | `/api/agent/new` | 新建会话 | cwd 从用户 `lastProjectId` 推导，项目必须是个人项目 |
| GET | `/api/projects` | 项目列表 | 只返回当前用户的个人项目 |
| POST | `/api/projects/[id]/bind` | 绑定当前项目 | 只能绑定自己的项目 |

---

## 4. 数据模型设计

### 4.1 核心变更：一人一团

为每个用户创建一个**仅含自己的个人团队** + **个人项目**，实现"独立工作台"。

**为什么沿用 Team 模型？**

- 现有 `team-auth.ts`、`session-meta`、审计日志都按 teamId 隔离。
- "个人团队" = 只有 1 个成员的 Team，天然私有。
- 避免大规模重写隔离逻辑。

### 4.2 Schema 变更

```prisma
model User {
  id                 String   @id @default(cuid())
  username           String   @unique
  passwordHash       String
  mustChangePassword Boolean  @default(false)
  status             String   @default("active") // active | disabled | deleted
  lastProjectId      String?
  createdBy          String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  deletedAt          DateTime?
  teams              TeamMember[]
}

model Team {
  id          String   @id @default(cuid())
  name        String
  ownerUserId String
  type        String   @default("shared") // personal | shared
  createdAt   DateTime @default(now())
  members     TeamMember[]
  projects    Project[]
}

model Project {
  id        String   @id @default(cuid())
  teamId    String
  name      String
  rootPath  String
  type      String   @default("shared") // personal | shared
  createdBy String
  createdAt DateTime @default(now())
  team      Team     @relation(fields: [teamId], references: [id])
  @@unique([teamId, rootPath])
}

// 新增：全局模型配置（单行表）
model GlobalModelConfig {
  id            String   @id @default("global")
  enabledModels String   // JSON array: ["openai/gpt-4o", "anthropic/claude-sonnet-4"]
  defaultModel  String?
  providerKeys  String?  // JSON object, encrypted: { "openai": "sk-...", "anthropic": "sk-..." }
  updatedAt     DateTime @updatedAt
  updatedBy     String?
}
```

### 4.3 迁移策略

**现有用户处理（方案 A）：**

1. 保留 `root` 用户，将其个人团队设为 "root's workspace"。
2. 对每个现有用户：
   - 创建个人团队（`type=personal`）。
   - 创建个人项目（`type=personal`，rootPath 指向 `data/projects/user-<username>`）。
   - 把用户从 "Default Team" 移除，加入个人团队。
   - 把用户原有会话的 `teamId` 改为个人团队 ID（数据迁移脚本）。
3. "Default Team" 保留为 shared 类型，作为可选的共享空间（但默认不展示）。

**新用户注册：**

- admin 创建用户时，自动创建个人团队 + 个人项目。
- 用户名即团队名/项目名，确保唯一。

---

## 5. 核心流程

### 5.1 用户登录流程

```
1. 用户访问 /login
2. 提交 username + password → POST /api/auth/user-login
3. BFF 校验：
   - 用户不存在 → 401
   - 密码错误 → 401
   - status != active → 403 "account disabled"
   - mustChangePassword → 返回 pw_at + pw_rt，前端强制跳改密页
4. 登录成功：
   - 返回 pw_at (15min) + pw_rt (7d) HttpOnly Cookie
   - 前端 Pinia 保存 user info + role
5. 路由守卫根据 role 决定是否显示 /admin
```

### 5.2 个人工作台流程

```
1. 用户进入 /workspace
2. 前端调用 GET /api/projects → 返回个人项目列表
3. 前端调用 GET /api/sessions → 返回当前用户个人会话
4. 用户点击"新建会话"：
   - 前端生成临时 sessionId
   - 发送第一条消息时，POST /api/agent/new
   - BFF 从 user.lastProjectId 找到个人项目 rootPath
   - 在该目录下创建 AgentSession，绑定个人 teamId
5. SSE 推送 /api/agent/[id]/events → 前端实时渲染
```

### 5.3 Admin 用户管理流程

```
1. admin 进入 /admin/users
2. 用户列表：GET /api/admin/users（含分页/搜索/状态过滤）
3. 创建用户：POST /api/admin/users → 返回一次性初始密码
4. 重置密码：PATCH /api/admin/users/[id]/password → 返回新一次性密码
5. 停用/启用：PATCH /api/admin/users/[id]/status
   - 停用：删除该用户所有 refresh token，踢出登录
   - 启用：恢复正常登录
6. 删除：DELETE /api/admin/users/[id]?hard=true|false
   - 软删除：标记 deletedAt，禁止登录
   - 硬删除：删除用户记录 + 清理 data/projects/user-<name> + 删除会话文件
```

### 5.4 Admin 模型配置流程

```
1. admin 进入 /admin/models
2. GET /api/admin/models → 返回当前全局配置
3. 修改可用模型列表 / 默认模型 / provider key
4. PUT /api/admin/models → 保存到 GlobalModelConfig
5. POST /api/admin/models/test → 用提供的 key 调用 provider API 测试连通性
6. 所有用户的新会话都使用这份全局配置
```

---

## 6. 安全与权限

### 6.1 认证

- 沿用现有 JWT 双 Token（`pw_at` + `pw_rt`）。
- Refresh token 黑名单（`RefreshTokenBlacklist`）继续有效。
- 停用用户时，主动吊销其所有 refresh token。

### 6.2 授权

- 中间件仍注入 `x-user-id`、`x-user-role`、`x-must-change-password`。
- `assertIsAdmin` 从数据库读取角色，不信任请求头。
- 个人数据访问：所有会话/项目/文件接口校验 `teamId` 属于当前用户的个人团队。

### 6.3 模型密钥安全

- `GlobalModelConfig.providerKeys` 加密存储（预留 `PI_WEB_MASTER_KEY`）。
- 前端永远不返回明文 key，只返回掩码（如 `sk-****1234`）。
- 测试连通性接口在服务端调用，不暴露 key。

### 6.4 审计日志

继续记录：

- `user.create` / `user.delete` / `user.disable` / `user.enable` / `user.reset_password`
- `session.create` / `session.access_denied`
- `admin.models.update`

---

## 7. 实施分期

### Phase 1：后端个人化 + admin 管理（1-2 周）

**目标：不动前端，先让后端支持"每人独立"和完整用户管理。**

- [ ] Prisma schema 变更：User.status、Team.type、Project.type、GlobalModelConfig
- [ ] 数据迁移脚本：现有用户拆分为个人团队
- [ ] 用户管理 API：列表、详情、重置密码、停用/启用、删除
- [ ] 模型配置 API：GET/PUT/POST test
- [ ] 会话/项目接口改为只返回个人数据
- [ ] 单元测试 + E2E 测试

**验收：** 现有 React 前端仍可使用，但每个用户只能看到自己的会话和项目。

### Phase 2：Vue 前端骨架 + admin 页面（1-2 周）

**目标：复用 AI-miniSOC 框架，先完成登录和 admin 管理。**

- [ ] 初始化 Vue 项目（基于 AI-miniSOC 模板裁剪）
- [ ] 登录/改密/忘记密码页面
- [ ] admin 用户管理页面（列表 + 创建 + 重置密码 + 停用/启用 + 删除）
- [ ] admin 模型配置页面
- [ ] 路由守卫 + 权限控制

**验收：** admin 可以用 Vue 界面完成用户和模型管理。

### Phase 3：Vue 个人工作台（2-3 周）

**目标：重写聊天核心组件。**

- [ ] 个人工作台布局（复用 AI-miniSOC 布局）
- [ ] 会话侧边栏（会话树、新建、删除、运行状态）
- [ ] 聊天窗口（消息列表、markdown 渲染、工具调用展示）
- [ ] 聊天输入框（@ 文件引用、模型切换、发送/停止）
- [ ] SSE 状态机 composable
- [ ] 文件浏览器

**验收：** 普通用户可以在 Vue 界面完成完整聊天工作流。

### Phase 4：收尾与优化（1 周）

- [ ] 删除旧 React 前端代码
- [ ] API 瘦身（去掉只服务于 React 的页面路由）
- [ ] 性能优化（SSE 重连、列表分页）
- [ ] 文档更新

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Vue 重写聊天组件工作量大 | 延期 | 分 Phase 交付，Phase 1 不动前端 |
| pi SDK 与 Next.js 耦合深 | 迁移困难 | 阶段 1 保留 Next.js API，阶段 2 可选迁移 Express |
| 现有用户数据迁移出错 | 数据丢失 | 迁移前备份 SQLite，提供回滚脚本 |
| 模型密钥泄露 | 安全事件 | 加密存储 + 掩码返回 + 审计日志 |
| 一人一团语义与现有团队混淆 | 逻辑混乱 | 明确 `type=personal/shared`，查询时过滤 |

---

## 9. 与 AI-miniSOC 的关系

**复用点：**

- 前端框架（Vue 3 + Element Plus + Pinia + 布局组件）
- 登录/用户管理页面基础
- HTTP 请求封装、SSE 工具
- 权限路由模式

**差异点：**

- AI-miniSOC 后端是 Python/FastAPI，AI-agent-workshop 后端是 Node.js。
- AI-miniSOC 是安全运营中心，AI-agent-workshop 是 AI 编程工作台。
- 聊天/会话/文件浏览是 AI-agent-workshop 独有，需要全新实现。

**结论：** 复用 AI-miniSOC 的"壳"和"管理后台"，重写其"业务核心"。

---

## 10. 待决策事项

1. **是否保留"共享团队"作为可选功能？** 当前设计保留 `type=shared`，但默认隐藏。如果确定不要，可以进一步简化。
2. **模型配置是否允许用户级覆盖？** v1 设计为 admin 统一控制，v1.1 可考虑开放。
3. **删除用户时是否保留其会话文件？** 当前设计硬删除会清理，可根据合规要求调整。
4. **Vue 前端仓库位置：** 是放在 AI-agent-workshop 内（如 `web/` 目录），还是独立仓库？

---

## 11. 附录

### 11.1 当前 React 组件 → Vue 组件映射

| React 组件 | Vue 组件 | 复杂度 |
|-----------|---------|--------|
| `AppShell.tsx` | `views/workspace/index.vue` | 高 |
| `SessionSidebar.tsx` | `views/workspace/components/SessionSidebar.vue` | 高 |
| `ChatWindow.tsx` | `views/workspace/components/ChatWindow.vue` | 高 |
| `ChatInput.tsx` | `views/workspace/components/ChatInput.vue` | 高 |
| `MessageView.tsx` | `views/workspace/components/MessageView.vue` | 高 |
| `FileExplorer.tsx` | `views/workspace/components/FileExplorer.vue` | 中 |
| `FileViewer.tsx` | `views/workspace/components/FileViewer.vue` | 中 |
| `ModelsConfig.tsx` | `views/admin/ModelsConfig.vue` | 中 |
| `PluginsConfig.tsx` | `views/admin/PluginsConfig.vue` | 中 |
| `useAgentSession.ts` | `composables/useAgentSession.ts` | 高 |

### 11.2 参考文件

- 现有后端：`app/api/admin/users/route.ts`
- 现有隔离逻辑：`lib/team-auth.ts`
- 现有会话管理：`lib/rpc-manager.ts`
- AI-miniSOC 前端：`/Users/xiejava/AIproject/AI-miniSOC/src/frontend`

---

**评审通过后，建议先进入 Phase 1 的详细实施计划。**
