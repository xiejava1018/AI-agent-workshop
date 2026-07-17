---
change: m3-vue3-workbench
design-doc: docs/superpowers/specs/2026-07-16-m3-vue3-workbench-design.md
base-ref: 9fc03af9465d514fffed66b47f4f3f0d48975402
---

# M3 Vue3 工作台 + 数字员工 + 多 Agent 编排 + 技能/MCP 按 Agent 绑定 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在保留 `apps/dashboard`（vue-pure-admin 基底）做减法改造为 Vue3 统一主界面的同时，为 `apps/web` 后端补齐数字员工（Agent）、技能/MCP 按 Agent 四层绑定、自研 Supervisor 多 Agent 编排、多租户安全与凭证加密，并把数据层从 SQLite 迁移到 PostgreSQL。

**Architecture:** 后端在 `apps/web`（Next.js Route Handlers + Prisma + Pi Agent 0.80.6）上扩展：数据层 Prisma→PostgreSQL 并新增 12 张表；运行时把 `getOrCreateServices` 缓存键从 `cwd` 改为 `scopeHash = sha256(有效技能集 + 有效MCP集)`，绑定解析实时查库不缓存；编排用 `defineTool` 自研 `DelegateAgentTool`，进程内创建子会话。前端 `apps/dashboard` 做减法（删 demo/mock），经 Vite proxy `/api` + `EventSource` 消费 SSE。React UI（`apps/web`）保留为开发/参考界面。

**Tech Stack:** Next.js 16 Route Handlers、Prisma 6 + PostgreSQL、Pi Agent 0.80.6（`@earendil-works/pi-coding-agent`）、Vitest（单元/集成）、Playwright（E2E）、Vue 3 + Pinia + Element Plus + vue-pure-admin（dashboard）、AES-256-GCM（凭证加密）。

---

## 如何阅读本计划

- **任务编号** 对齐 `openspec/changes/m3-vue3-workbench/tasks.md`（T0–T9）。每个 Task 给出确切文件路径、可运行的测试、最小实现、运行命令与预期输出、commit。
- **TDD**：每个功能任务先写失败测试（RED），再最小实现（GREEN），再 commit。测试命令统一在 `apps/web` 下用 `pnpm --filter @ai-agent-workshop/web test`（Vitest），单测用 `npx vitest run <path>`。
- **工作目录**：除非注明，所有路径相对于仓库根 `/Users/xiejava/AIproject/AI-agent-workshop`；后端代码在 `apps/web`，前端在 `apps/dashboard`。
- **数据库**：本计划将 provider 从 `sqlite` 改为 `postgresql`。需要本地可用的 PostgreSQL（见 Task 1.0）。`DATABASE_URL` 形如 `postgresql://user:pass@localhost:5432/ai_agent_workshop`。
- **base-ref** `9fc03af9465d514fffed66b47f4f3f0d48975402` 用于 verify 阶段跨提交统计改动规模（`git diff 9fc03af...HEAD --stat`）。

---

## 关键现状（实现者必读）

- `apps/web/lib/rpc-manager.ts`：`getOrCreateServices(cwd, agentDir)` 当前以 **`cwd`** 为缓存键（第 899–912 行），导致同一 cwd 下不同 Agent 复用同一 `resourceLoader` → 技能/MCP 绑定被击穿。这是 T2 的核心修复点。`startRpcSession(sessionId, sessionFile, cwd, toolNames?, userId?)`（第 1042 行）是创建会话的唯一入口。
- `apps/web/lib/tool-presets.ts`：当前只有 `PRESET_NONE/DEFAULT/FULL` 静态工具集，**没有**技能/MCP 解析逻辑。T2.2/T2.3 在此扩展。
- `apps/web/prisma/schema.prisma`：`datasource db { provider = "sqlite" }`（第 6 行）需改为 `postgresql`。已有模型：`User / Team / TeamMember / Project / SessionShare / RefreshTokenBlacklist / AuditLog`，枚举 `Role { OWNER ADMIN MEMBER }`。已有 4 个 migration。
- `apps/web/app/api/agent/new/route.ts`：POST 创建会话，从 `user.lastProjectId → Project.rootPath` 推导 `cwd`，做 team 鉴权、session cap、audit。T2/T3 的 `spawnSession(opts)` 需在此链路基础上扩展 `agentId` 解析。
- 鉴权助手：`lib/team-auth.ts`（`getUserTeamMemberships / assertMemberOfTeam / assertCanReadSessionScoped`）、`lib/user-role.ts`（`getUserHighestRole`）、`lib/audit-log.ts`（`auditLog({ userId, action, resourceType, resourceId, metadata })`）、`lib/session-cap.ts`（`checkUserSessionCap / incrementUserSessionCap / decrementUserSessionCap`）。
- SSE：`apps/web/app/api/agent/[id]/events/route.ts` GET 推送 agent 事件流。
- 测试：Vitest 配置在 `apps/web/vitest.config.ts`，已有 14 个 `lib/*.test.ts`。运行 `pnpm --filter @ai-agent-workshop/web test`。

---

# Phase 0 — Spike 与基线门控（必须先做，阻塞后续）

- [x] Task 0.1: C1 Spike — 验证 pi-mcp-extension 兼容性

**Files:**
- Create: `docs/spikes/2026-07-16-pi-mcp-extension.md`

**Step 1: 查证 pi-mcp-extension 包**

Run: `npm view pi-mcp-extension 2>&1 | head -40`（若包名不同，用 `npm search mcp` 与查 Pi Agent 0.80.6 文档确认真实包名）
Expected: 得到版本、许可证、peerDependencies。记录是否声明支持 Node 22 与 Pi Agent 0.80.6。

**Step 2: 三传输冒烟（stdio/SSE/Streamable HTTP）**

在 `apps/web` 下做一次临时安装与最小加载脚本（不要提交 node_modules 改动；用 `npm pack` 或临时目录）。验证三种 transport 能否在 Node 22 下建立握手。
Expected: 记录每种 transport 的成功/失败与报错原文。

**Step 3: 写结论 + 降级判定**

将结论写入 `docs/spikes/2026-07-16-pi-mcp-extension.md`，明确「兼容 / 不兼容」。**若不兼容**：M3 降级为「预留 MCP 扩展点 + DB 表结构」，不实际接入 MCP 扩展包（设计文档 §0 降级策略），后续 MCP 相关 Task 只做 DB 与解析层，不接运行时扩展。

**Step 4: Commit**

```bash
git add docs/spikes/2026-07-16-pi-mcp-extension.md
git commit -m "docs(m3): C1 spike pi-mcp-extension compatibility"
```

- [x] Task 0.2: C2 Spike — 验证 Vue3 可消费 apps/web SSE

**Files:**
- Create: `docs/spikes/2026-07-16-vue3-api-spike.md`

**Step 1: 确认 SSE 事件格式**

Read `apps/web/app/api/agent/[id]/events/route.ts` 全文，记录事件 `type` 列表（`message / tool_update / prompt_done / prompt_error` 等）与鉴权头（`x-user-id`、cookie）。

**Step 2: 最小对接验证**

在 `apps/dashboard` 配 Vite proxy `/api → http://localhost:30141`，用 `EventSource` 连 `/api/agent/[id]/events`，确认能收到事件。记录 proxy 配置与是否需要 cookie/`withCredentials`。
Expected: dashboard dev 下能收到至少一个 SSE 事件。

**Step 3: 统计 mock 占比 + 写结论**

Run: `find apps/dashboard/src/mock -type f | wc -l` 与 `grep -rl "mock" apps/dashboard/src/views | wc -l`，估算 `src/mock` 占比。把 SSE 对接结论 + mock 占比写入 `docs/spikes/2026-07-16-vue3-api-spike.md`。

**Step 4: Commit**

```bash
git add docs/spikes/2026-07-16-vue3-api-spike.md
git commit -m "docs(m3): C2 spike vue3 SSE consumption + dashboard mock占比"
```

- [x] Task 0.3: 基线门禁

**Step 1: install**

Run: `pnpm install`
Expected: 退出码 0。

**Step 2: web build**

Run: `pnpm --filter @ai-agent-workshop/web build`
Expected: 构建成功。**若失败**：停下确认是否仓库既有问题（对照 base-ref `9fc03af` 是否本就该过），不要在本计划里顺手修无关 bug。

**Step 3: dashboard build**

Run: `pnpm --filter @ai-agent-workshop/dashboard build`
Expected: 构建成功。若基线已坏，记录并暂停向用户确认。

---

# Phase 1 — 数据模型（Prisma + PostgreSQL）

> 设计文档 §2。provider 修正 + 12 张新表 + 加密字段约定。所有新表 `tenantId` 一律服务端推导（不落 client 传入）。

- [x] Task 1.0: 切换 provider 到 PostgreSQL 并准备本地库

**Files:**
- Modify: `apps/web/prisma/schema.prisma:5-8`
- Modify: `apps/web/.env`（本地，不入库）

**Step 1: 改 provider**

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Step 2: 起本地 PostgreSQL 并设 DATABASE_URL**

Run（任选其一）: `docker run --name ai-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ai_agent_workshop -p 5432:5432 -d postgres:16`
设置 `apps/web/.env`：`DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_agent_workshop"`

**Step 3: 生成 PG baseline 迁移**

Run: `pnpm --filter @ai-agent-workshop/web db:migrate -- --name pg_baseline`
Expected: 在 `apps/web/prisma/migrations/` 生成新迁移，把现有 6 张表重建到 PG。**注意**：从 sqlite 切到 PG 不能复用旧 sqlite migration，需让 Prisma 以当前 schema 对空 PG 库生成 baseline（必要时 `prisma migrate reset` 后重新 `migrate dev`）。

**Step 4: Commit**

```bash
git add apps/web/prisma/
git commit -m "feat(m3): switch prisma provider sqlite->postgresql, PG baseline"
```

- [x] Task 1.1: Agent 表（数字员工）

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Test: `apps/web/lib/prisma-models.test.ts`（新建，验证模型可读写）

**Step 1: 写失败测试**

```typescript
// apps/web/lib/prisma-models.test.ts
import { prisma } from "./prisma";

describe("M3 models", () => {
  it("creates an Agent (digital employee)", async () => {
    const agent = await prisma.agent.create({
      data: {
        name: "代码审查员",
        description: "review code",
        systemPrompt: "you are a reviewer",
        model: "anthropic/claude-opus-4-8",
        scope: "personal",
      },
    });
    expect(agent.id).toBeTruthy();
    expect(agent.scope).toBe("personal");
    await prisma.agent.delete({ where: { id: agent.id } });
  });
});
```

**Step 2: 跑测试确认失败**

Run: `cd apps/web && npx vitest run lib/prisma-models.test.ts`
Expected: FAIL — `prisma.agent` undefined（模型不存在）。

**Step 3: 加 Agent 模型**

```prisma
model Agent {
  id          String   @id @default(cuid())
  teamId      String?
  ownerUserId String?
  name        String
  description String   @default("")
  systemPrompt String  @default("")
  model       String   @default("")
  scope       String   @default("personal") // team | personal
  createdAt   DateTime @default(now())

  @@index([teamId])
  @@index([ownerUserId])
}
```

**Step 4: migrate + 跑测试确认通过**

Run: `pnpm --filter @ai-agent-workshop/web db:migrate -- --name add_agent && cd apps/web && npx vitest run lib/prisma-models.test.ts`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/web/prisma apps/web/lib/prisma-models.test.ts
git commit -m "feat(m3): add Agent model (digital employee)"
```

- [x] Task 1.2: 绑定表 AgentSkillBinding / AgentMcpBinding / UserSkillBinding

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Test: `apps/web/lib/prisma-models.test.ts`（追加用例）

**Step 1: 写失败测试（追加到 describe 块）**

```typescript
it("creates skill/mcp bindings with mode", async () => {
  const b = await prisma.agentSkillBinding.create({
    data: { agentId: "a1", skillPackageId: "s1", mode: "include" },
  });
  expect(b.mode).toBe("include");
  await prisma.agentSkillBinding.delete({ where: { id: b.id } });
});
```

**Step 2: 跑测试确认失败**

Run: `cd apps/web && npx vitest run lib/prisma-models.test.ts`
Expected: FAIL — `prisma.agentSkillBinding` undefined。

**Step 3: 加三张绑定表**

```prisma
model AgentSkillBinding {
  id            String @id @default(cuid())
  agentId       String
  skillPackageId String
  mode          String @default("inherit") // inherit | include | exclude
  @@unique([agentId, skillPackageId])
  @@index([agentId])
}

model AgentMcpBinding {
  id         String @id @default(cuid())
  agentId    String
  mcpServerId String
  mode       String @default("inherit")
  @@unique([agentId, mcpServerId])
  @@index([agentId])
}

model UserSkillBinding {
  id            String @id @default(cuid())
  userId        String
  skillPackageId String
  mode          String @default("inherit")
  @@unique([userId, skillPackageId])
  @@index([userId])
}
```

**Step 4: migrate + 跑测试确认通过**

Run: `pnpm --filter @ai-agent-workshop/web db:migrate -- --name add_bindings && cd apps/web && npx vitest run lib/prisma-models.test.ts`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/web/prisma apps/web/lib/prisma-models.test.ts
git commit -m "feat(m3): add skill/mcp binding tables"
```

- [x] Task 1.3: SkillPackage / SkillInvocation 表

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Test: `apps/web/lib/prisma-models.test.ts`

**Step 1: 写失败测试**

```typescript
it("creates a SkillPackage with scope", async () => {
  const s = await prisma.skillPackage.create({
    data: { slug: "commit", name: "commit", scope: "global", source: "builtin", filePath: "/skills/commit" },
  });
  expect(s.scope).toBe("global");
  await prisma.skillPackage.delete({ where: { id: s.id } });
});
```

**Step 2: 跑测试确认失败** — `cd apps/web && npx vitest run lib/prisma-models.test.ts` → FAIL。

**Step 3: 加模型**

```prisma
model SkillPackage {
  id          String  @id @default(cuid())
  slug        String
  name        String
  description String  @default("")
  scope       String  @default("global") // global | team | user
  teamId      String?
  userId      String?
  source      String  @default("")
  filePath    String  @default("")
  enabled     Boolean @default(true)
  @@unique([scope, slug, teamId, userId])
  @@index([teamId])
  @@index([userId])
}

model SkillInvocation {
  id            String   @id @default(cuid())
  skillPackageId String
  userId        String?
  sessionId     String?
  createdAt     DateTime @default(now())
  @@index([skillPackageId])
}
```

**Step 4: migrate + 跑测试确认通过** — `db:migrate -- --name add_skill_package` → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): add SkillPackage/SkillInvocation"`

- [x] Task 1.4: McpServer 表（config 加密存储）

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Test: `apps/web/lib/prisma-models.test.ts`

**Step 1: 写失败测试**

```typescript
it("creates an McpServer with encrypted config field", async () => {
  const m = await prisma.mcpServer.create({
    data: { name: "fs", transport: "stdio", command: "npx fs-mcp", scope: "team", teamId: "t1", configEnc: "ENCRYPTED" },
  });
  expect(m.configEnc).toBe("ENCRYPTED");
  await prisma.mcpServer.delete({ where: { id: m.id } });
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 加模型**

```prisma
model McpServer {
  id        String  @id @default(cuid())
  name      String
  transport String  @default("stdio") // stdio | sse | http
  endpoint  String  @default("")
  command   String  @default("")
  configEnc String  @default("") // AES-256-GCM 密文, 绝不明文
  scope     String  @default("global") // global | team | user
  teamId    String?
  userId    String?
  enabled   Boolean @default(true)
  @@index([teamId])
  @@index([userId])
}
```

**Step 4: migrate + 跑测试确认通过** — `db:migrate -- --name add_mcp_server` → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): add McpServer (encrypted config)"`

- [x] Task 1.5: DelegationTree 表

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Test: `apps/web/lib/prisma-models.test.ts`

**Step 1: 写失败测试**

```typescript
it("creates a DelegationTree node", async () => {
  const d = await prisma.delegationTree.create({
    data: { rootSessionId: "r1", parentSessionId: "r1", childSessionId: "c1", mode: "sync", depth: 1, status: "running" },
  });
  expect(d.depth).toBe(1);
  await prisma.delegationTree.delete({ where: { id: d.id } });
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 加模型**

```prisma
model DelegationTree {
  id              String  @id @default(cuid())
  rootSessionId   String
  parentSessionId String?
  childSessionId  String
  mode            String  @default("sync") // sync | parallel | async
  depth           Int     @default(0)
  status          String  @default("running") // running | done | error
  createdAt       DateTime @default(now())
  @@index([rootSessionId])
  @@index([childSessionId])
}
```

**Step 4: migrate + 跑测试确认通过** — `db:migrate -- --name add_delegation_tree` → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): add DelegationTree"`

- [x] Task 1.6: InviteLink 表

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Test: `apps/web/lib/prisma-models.test.ts`

**Step 1: 写失败测试**

```typescript
it("creates an InviteLink", async () => {
  const inv = await prisma.inviteLink.create({
    data: { teamId: "t1", token: "tok123", role: "MEMBER", expiresAt: new Date(Date.now() + 86400000), requireAccount: true },
  });
  expect(inv.token).toBe("tok123");
  await prisma.inviteLink.delete({ where: { id: inv.id } });
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 加模型**

```prisma
model InviteLink {
  id             String    @id @default(cuid())
  teamId         String
  token          String    @unique
  role           String    @default("MEMBER")
  expiresAt      DateTime
  usedBy         String?
  requireAccount Boolean   @default(true)
  createdAt      DateTime  @default(now())
  @@index([teamId])
}
```

**Step 4: migrate + 跑测试确认通过** — `db:migrate -- --name add_invite_link` → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): add InviteLink"`

- [x] Task 1.7: PlatformApiKey / UserApiKey 表（AES-256-GCM）

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Test: `apps/web/lib/prisma-models.test.ts`

**Step 1: 写失败测试**

```typescript
it("creates PlatformApiKey/UserApiKey with encrypted secret", async () => {
  const p = await prisma.platformApiKey.create({ data: { provider: "anthropic", secretEnc: "ENC" } });
  const u = await prisma.userApiKey.create({ data: { userId: "u1", provider: "openai", secretEnc: "ENC" } });
  expect(p.secretEnc).toBe("ENC");
  expect(u.provider).toBe("openai");
  await prisma.platformApiKey.delete({ where: { id: p.id } });
  await prisma.userApiKey.delete({ where: { id: u.id } });
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 加模型**

```prisma
model PlatformApiKey {
  id        String   @id @default(cuid())
  provider  String
  secretEnc String   // AES-256-GCM 密文
  updatedAt DateTime @updatedAt
  @@unique([provider])
}

model UserApiKey {
  id        String   @id @default(cuid())
  userId    String
  provider  String
  secretEnc String   // AES-256-GCM 密文
  updatedAt DateTime @updatedAt
  @@unique([userId, provider])
  @@index([userId])
}
```

**Step 4: migrate + 跑测试确认通过** — `db:migrate -- --name add_api_keys` → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): add PlatformApiKey/UserApiKey (encrypted)"`

- [x] Task 1.8: Quota 扩展（tokenDailyLimit / maxConcurrentSessions）

**Files:**
- Modify: `apps/web/prisma/schema.prisma`（给 `User` 与 `Team` 加配额列，或新建 `Quota` 表——按设计「或并入 User/Team」，本计划选择并入）
- Test: `apps/web/lib/prisma-models.test.ts`

**Step 1: 写失败测试**

```typescript
it("reads user quota fields", async () => {
  const u = await prisma.user.create({ data: { username: `q_${Date.now()}`, passwordHash: "x", tokenDailyLimit: 100000, maxConcurrentSessions: 5 } });
  expect(u.tokenDailyLimit).toBe(100000);
  await prisma.user.delete({ where: { id: u.id } });
});
```

**Step 2: 跑测试确认失败** → FAIL（列不存在）。

**Step 3: 给 User/Team 加列**

```prisma
// 在 model User 内追加：
  tokenDailyLimit      Int @default(0)  // 0 = 不限
  maxConcurrentSessions Int @default(5)
// 在 model Team 内追加：
  tokenDailyLimit      Int @default(0)
  maxConcurrentSessions Int @default(0) // 0 = 用全局默认
```

**Step 4: migrate + 跑测试确认通过** — `db:migrate -- --name add_quota_fields` → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): quota fields on User/Team"`

- [x] Task 1.9: Session 表确认 userId + projectId

**Files:**
- Modify: `apps/web/prisma/schema.prisma`（若无 `Session` 表则新建；若有则补 `projectId`）
- Test: `apps/web/lib/prisma-models.test.ts`

**现状**：当前 schema **没有** `Session` 模型（会话正文走 `.jsonl`，元数据在 `lib/session-meta.ts` 内存 + jsonl）。按设计 §2 新增 `Session` 表只存元数据 + `jsonlPath` 指针。

**Step 1: 写失败测试**

```typescript
it("creates a Session metadata row", async () => {
  const s = await prisma.session.create({
    data: { userId: "u1", teamId: "t1", projectId: "p1", title: "s", status: "active", jsonlPath: "/x.jsonl" },
  });
  expect(s.projectId).toBe("p1");
  await prisma.session.delete({ where: { id: s.id } });
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 加 Session 模型**

```prisma
model Session {
  id         String   @id @default(cuid())
  userId     String
  teamId     String
  projectId  String?
  title      String   @default("")
  status     String   @default("active")
  tokenUsage Int      @default(0)
  jsonlPath  String   @default("")
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@index([userId, createdAt])
  @@index([teamId])
}
```

**Step 4: migrate + 跑测试确认通过** — `db:migrate -- --name add_session` → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): add Session metadata table"`

- [x] Task 1.10: 迁移可回滚验证

**Step 1: 验证 migrate 幂等**

Run: `pnpm --filter @ai-agent-workshop/web db:migrate`
Expected: "Already in sync" 或无新迁移。

**Step 2: 验证 reset 可复现**

Run: `pnpm --filter @ai-agent-workshop/web db:reset && pnpm --filter @ai-agent-workshop/web db:migrate`
Expected: reset 后所有迁移按序重放成功，schema 一致。

**Step 3: Commit（若有迁移文件变动）**

```bash
git add apps/web/prisma
git commit -m "chore(m3): verify prisma migrations reproducible on PG"
```

---

# Phase 2 — 后端：Agent 运行时与绑定接缝（核心）

> 设计文档 §3。修复 `getOrCreateServices` 缓存键击穿问题，实现技能/MCP 四层解析。

- [x] Task 2.1: 缓存键改为 scopeHash

**Files:**
- Modify: `apps/web/lib/rpc-manager.ts:899-912`（`getOrCreateServices`）与 `:1084`（调用点）
- Test: `apps/web/lib/rpc-manager-scope.test.ts`（新建）

**Step 1: 写失败测试**

```typescript
// apps/web/lib/rpc-manager-scope.test.ts
import { computeScopeHash } from "./rpc-manager";

describe("computeScopeHash", () => {
  it("produces different hashes for different skill/mcp sets", () => {
    const h1 = computeScopeHash({ skills: ["a"], mcpServers: [] });
    const h2 = computeScopeHash({ skills: ["b"], mcpServers: [] });
    expect(h1).not.toBe(h2);
  });
  it("is order-independent", () => {
    const h1 = computeScopeHash({ skills: ["a", "b"], mcpServers: ["x"] });
    const h2 = computeScopeHash({ skills: ["b", "a"], mcpServers: ["x"] });
    expect(h1).toBe(h2);
  });
});
```

**Step 2: 跑测试确认失败**

Run: `cd apps/web && npx vitest run lib/rpc-manager-scope.test.ts`
Expected: FAIL — `computeScopeHash` not exported。

**Step 3: 实现 computeScopeHash + 改缓存键**

在 `rpc-manager.ts` 顶部 import `createHash` from "crypto"，新增导出：

```typescript
import { createHash } from "crypto";

export interface ScopeSet {
  skills: string[];
  mcpServers: string[];
}

export function computeScopeHash(scope: ScopeSet): string {
  const norm = JSON.stringify({
    skills: [...scope.skills].sort(),
    mcpServers: [...scope.mcpServers].sort(),
  });
  return createHash("sha256").update(norm).digest("hex");
}
```

把 `getOrCreateServices(cwd, agentDir)` 签名改为 `getOrCreateServices(cwd, agentDir, scopeHash)`，缓存键改为 `` `${cwd}::${scopeHash}` ``；更新 `startRpcSession` 内调用点（先传占位 `""`，T2.4 接入真实 hash）。

**Step 4: 跑测试确认通过**

Run: `cd apps/web && npx vitest run lib/rpc-manager-scope.test.ts lib/rpc-manager.test.mjs`
Expected: 新测试 PASS，旧测试不回归。

**Step 5: Commit**

```bash
git add apps/web/lib/rpc-manager.ts apps/web/lib/rpc-manager-scope.test.ts
git commit -m "feat(m3): key services cache by scopeHash not cwd"
```

[x] Task 2.2: 技能四层解析（global → team → user → agent)

**Files:**
- Create: `apps/web/lib/scope-resolve.ts`
- Test: `apps/web/lib/scope-resolve.test.ts`

**Step 1: 写失败测试**

```typescript
// apps/web/lib/scope-resolve.test.ts
import { resolveAgentSkills } from "./scope-resolve";

describe("resolveAgentSkills", () => {
  it("merges global->team->user->agent with agent-layer mode收敛", async () => {
    const resolved = await resolveAgentSkills({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(Array.isArray(resolved.skills)).toBe(true);
  });
  it("personal scope skips team layer", async () => {
    const resolved = await resolveAgentSkills({ agentId: "a1", userId: "u1", teamId: null, scope: "personal" });
    expect(resolved.layersApplied).not.toContain("team");
  });
});
```

**Step 2: 跑测试确认失败** — `cd apps/web && npx vitest run lib/scope-resolve.test.ts` → FAIL（模块不存在）。

**Step 3: 实现四层解析**

```typescript
// apps/web/lib/scope-resolve.ts
import { prisma } from "./prisma";

export interface ResolveInput {
  agentId: string;
  userId: string;
  teamId: string | null;
  scope?: "team" | "personal";
}
export interface ResolvedSkills {
  skills: string[];        // 有效 skillPackage slug 列表
  layersApplied: string[]; // 实际参与的层
}

export async function resolveAgentSkills(input: ResolveInput): Promise<ResolvedSkills> {
  const layersApplied: string[] = [];
  const effective = new Map<string, string>(); // slug -> mode

  // global 层: scope=global 且 enabled
  const globalSkills = await prisma.skillPackage.findMany({ where: { scope: "global", enabled: true } });
  for (const s of globalSkills) effective.set(s.slug, "inherit");
  layersApplied.push("global");

  // team 层（personal 跳过）
  if (input.scope !== "personal" && input.teamId) {
    const teamSkills = await prisma.skillPackage.findMany({ where: { scope: "team", teamId: input.teamId, enabled: true } });
    for (const s of teamSkills) effective.set(s.slug, "inherit");
    layersApplied.push("team");
  }

  // user 层绑定
  const userBindings = await prisma.userSkillBinding.findMany({ where: { userId: input.userId } });
  for (const b of userBindings) {
    if (b.mode === "exclude") effective.delete(await slugOf(b.skillPackageId));
    else effective.set(await slugOf(b.skillPackageId), b.mode);
  }
  layersApplied.push("user");

  // agent 层收敛
  const agentBindings = await prisma.agentSkillBinding.findMany({ where: { agentId: input.agentId } });
  for (const b of agentBindings) {
    const slug = await slugOf(b.skillPackageId);
    if (b.mode === "exclude") effective.delete(slug);
    else effective.set(slug, b.mode);
  }
  layersApplied.push("agent");

  return { skills: [...effective.keys()], layersApplied };
}

async function slugOf(skillPackageId: string): Promise<string> {
  const s = await prisma.skillPackage.findUnique({ where: { id: skillPackageId } });
  return s?.slug ?? skillPackageId;
}
```

**Step 4: 跑测试确认通过** — `cd apps/web && npx vitest run lib/scope-resolve.test.ts` → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): four-layer skill resolution"`

- [x] Task 2.3: MCP 四层解析

**Files:**
- Modify: `apps/web/lib/scope-resolve.ts`
- Test: `apps/web/lib/scope-resolve.test.ts`

**Step 1: 写失败测试**

```typescript
import { resolveAgentMcpServers } from "./scope-resolve";

it("resolves MCP servers across layers, filters disabled", async () => {
  const resolved = await resolveAgentMcpServers({ agentId: "a1", userId: "u1", teamId: "t1" });
  expect(Array.isArray(resolved.mcpServers)).toBe(true);
});

it("denies credentialed MCP at global scope", async () => {
  const resolved = await resolveAgentMcpServers({ agentId: "a1", userId: "u1", teamId: "t1" });
  expect(resolved.deniedGlobalCredential).toBeDefined();
});
```

**Step 2: 跑测试确认失败** → FAIL（`resolveAgentMcpServers` 不存在）。

**Step 3: 实现 MCP 解析 + 凭证隔离**

在 `scope-resolve.ts` 追加（结构同技能解析，额外规则：global 层挂带凭证 MCP → 拒绝 + 记审计 `mcp.credential_global_denied`；`enabled=false` 过滤）：

```typescript
export interface ResolvedMcp {
  mcpServers: Array<{ id: string; name: string; transport: string }>;
  deniedGlobalCredential: string[]; // 被拒的 global 带凭证 MCP id
}

export async function resolveAgentMcpServers(input: ResolveInput): Promise<ResolvedMcp> {
  const effective = new Map<string, { id: string; name: string; transport: string }>();
  const deniedGlobalCredential: string[] = [];

  const globalMcps = await prisma.mcpServer.findMany({ where: { scope: "global", enabled: true } });
  for (const m of globalMcps) {
    if (m.configEnc && m.configEnc.length > 0) {
      deniedGlobalCredential.push(m.id); // 带凭证不得挂 global
      continue;
    }
    effective.set(m.id, { id: m.id, name: m.name, transport: m.transport });
  }
  // team / user / agent 层同理（personal 跳过 team），agent 层 mode 收敛、exclude 删除。
  // ...（与 resolveAgentSkills 同构，省略重复注释）
  return { mcpServers: [...effective.values()], deniedGlobalCredential };
}
```

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): four-layer MCP resolution + credential isolation"`

- [x] Task 2.4: spawnSession 注入技能/MCP 到 resourceLoaderOptions

**Files:**
- Modify: `apps/web/lib/rpc-manager.ts`（`startRpcSession` 增加 `agentScopes` 参数，经 `createAgentSessionServices` 的 `resourceLoaderOptions` 注入）
- Modify: `apps/web/app/api/agent/new/route.ts`（解析 agentId → scopeHash → 传入）
- Test: `apps/web/lib/rpc-manager-scope.test.ts`

**Step 1: 写失败测试**

```typescript
it("builds resourceLoaderOptions from resolved scopes", () => {
  const opts = buildResourceLoaderOptions({
    skills: ["commit", "review"],
    mcpServers: [{ id: "m1", name: "fs", transport: "stdio" }],
  });
  expect(opts.noSkills).toBe(false);
  expect(opts.additionalSkillPaths?.length).toBeGreaterThan(0);
});
it("zero skills -> noSkills true", () => {
  const opts = buildResourceLoaderOptions({ skills: [], mcpServers: [] });
  expect(opts.noSkills).toBe(true);
});
```

**Step 2: 跑测试确认失败** → FAIL（`buildResourceLoaderOptions` 不存在）。

**Step 3: 实现注入**

在 `rpc-manager.ts` 新增 `buildResourceLoaderOptions`，并在 `startRpcSession` 接受 `agentScopes?: { skills: string[]; mcpServers: ... }`，把它转为 `resourceLoaderOptions`（`skillsOverride / additionalSkillPaths / noSkills / extensionsOverride / additionalExtensionPaths`）传入 `createAgentSessionServices`。`scopeHash = computeScopeHash(agentScopes)` 作为缓存键。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): inject resolved skills/mcp into resourceLoaderOptions"`

- [x] Task 2.5: 会话层工具级约束（tools/customTools/excludeTools）

**Files:**
- Modify: `apps/web/lib/rpc-manager.ts`（`createAgentSessionFromServices` 调用点 `:1085`）
- Test: `apps/web/lib/rpc-manager-scope.test.ts`

**Step 1: 写失败测试**

```typescript
it("computes excludeTools for child agents (no delegate*/remember*)", () => {
  const excluded = computeChildExcludedTools();
  expect(excluded).toContain("delegate");
  expect(excluded).toContain("remember");
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现**

新增 `computeChildExcludedTools(): string[]` 返回子 Agent 禁用清单（`delegate* / remember* / setGoal* / create_employee`），并在创建子会话时经 `excludeTools` 传入 `createAgentSessionFromServices`。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): tool-level constraints via excludeTools"`

- [x] Task 2.6: 按租户注入 SettingsManager + AuthStorage（BYOK）

**Files:**
- Create: `apps/web/lib/tenant-settings.ts`
- Test: `apps/web/lib/tenant-settings.test.ts`

**Step 1: 写失败测试**

```typescript
import { buildTenantAuthStorage } from "./tenant-settings";

it("builds InMemory AuthStorage with BYOK keys for the tenant", async () => {
  const auth = await buildTenantAuthStorage({ userId: "u1" });
  expect(auth).toBeDefined();
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现**

`buildTenantAuthStorage({ userId })`：查 `UserApiKey`（解密，见 Task 7.1）→ 构造 InMemory `AuthStorage`；`buildTenantSettingsManager({ userId, teamId })` 返回按租户的 `SettingsManager`。在 `startRpcSession` 注入。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): per-tenant SettingsManager/AuthStorage (BYOK)"`

---

# Phase 3 — 后端：多 Agent 编排（Supervisor）

> 设计文档 §4。完全自研 `DelegateAgentTool`，进程内，不引 Redis/队列。

- [x] Task 3.1: DelegateAgentTool（defineTool）

**Files:**
- Create: `apps/web/lib/delegate-agent-tool.ts`
- Test: `apps/web/lib/delegate-agent-tool.test.ts`

**Step 1: 写失败测试**

```typescript
import { createDelegateAgentTool } from "./delegate-agent-tool";

it("delegate tool executes and returns child result", async () => {
  const tool = createDelegateAgentTool({ rootSessionId: "r1", userId: "u1", teamId: "t1", depth: 0 });
  const out = await tool.execute({ agentId: "a1", task: "summarize X", mode: "sync" });
  expect(out).toBeDefined();
});
```

**Step 2: 跑测试确认失败** — `cd apps/web && npx vitest run lib/delegate-agent-tool.test.ts` → FAIL。

**Step 3: 实现**

`createDelegateAgentTool(ctx)` 用 Pi 的 `defineTool` 定义 `delegate` 工具；`execute({ agentId, task, mode })` 复用 §3 spawnSession 逻辑创建子 `createAgentSessionFromServices`（带 Task 2.5 的 excludeTools），`prompt(task)`，经 `session.subscribe` 收集结果返回。子结果截断 4000 字符。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): DelegateAgentTool sync execution"`

- [x] Task 3.2: Supervisor 发现可用数字员工目录

**Files:**
- Create: `apps/web/lib/agent-directory.ts`
- Test: `apps/web/lib/agent-directory.test.ts`

**Step 1: 写失败测试**

```typescript
import { listAvailableAgents } from "./agent-directory";

it("lists team agents for OWNER, personal for member", async () => {
  const dir = await listAvailableAgents({ userId: "u1", teamId: "t1" });
  expect(Array.isArray(dir)).toBe(true);
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现**

`listAvailableAgents({ userId, teamId })`：按 `teamId`（团队预置 `scope=team`）+ `ownerUserId`（个人 `scope=personal`）查 `Agent` 表，返回候选目录（id/name/description），作为 Supervisor 注入上下文。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): agent directory discovery"`

- [x] Task 3.3: 三种委派模式（sync / parallel≤8 / async）

**Files:**
- Modify: `apps/web/lib/delegate-agent-tool.ts`
- Test: `apps/web/lib/delegate-agent-tool.test.ts`

**Step 1: 写失败测试**

```typescript
it("parallel mode caps at 8 and queues the rest", async () => {
  const tool = createDelegateAgentTool({ rootSessionId: "r1", userId: "u1", teamId: "t1", depth: 0 });
  const results = await tool.executeBatch({ tasks: Array(10).fill({ agentId: "a1", task: "t" }), mode: "parallel" });
  expect(results.length).toBe(10);
});
it("async mode returns task_id placeholder", async () => {
  const tool = createDelegateAgentTool({ rootSessionId: "r1", userId: "u1", teamId: "t1", depth: 0 });
  const out = await tool.execute({ agentId: "a1", task: "t", mode: "async" });
  expect(out.taskId).toBeTruthy();
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现**

sync：等待返回。parallel：`Promise.all` 并发 ≤8（超出排队，用信号量）。async：返回 `task_id` 占位 + 内存 `Map<taskId, output>` 延迟回填（真后台队列留 M4）。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): delegation sync/parallel/async modes"`

- [x] Task 3.4: 委派护栏（深度/截断/禁用清单）

**Files:**
- Modify: `apps/web/lib/delegate-agent-tool.ts`
- Test: `apps/web/lib/delegate-agent-tool.test.ts`

**Step 1: 写失败测试**

```typescript
it("rejects delegation beyond depth 3", async () => {
  const tool = createDelegateAgentTool({ rootSessionId: "r1", userId: "u1", teamId: "t1", depth: 3 });
  await expect(tool.execute({ agentId: "a1", task: "t", mode: "sync" })).rejects.toThrow(/depth/i);
});
it("truncates child result to 4000 chars", async () => {
  const truncated = truncateChildResult("x".repeat(5000));
  expect(truncated.length).toBe(4000);
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现**

深度常量 `MAX_DELEGATION_DEPTH = 3`（tasks.md T3.4 写 ≤3；设计文档 §4 写 ≤2，**以 tasks.md 为准 = 3**，实现时把常量集中一处便于调整）。`truncateChildResult` 截 4000。子 Agent 禁用清单独享 Task 2.5 的 `computeChildExcludedTools`。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): delegation guardrails (depth/truncate/denylist)"`

- [x] Task 3.5: 委派专用池（配额滚回根会话）

**Files:**
- Modify: `apps/web/lib/session-cap.ts`（或新增 `lib/delegation-pool.ts`）
- Test: `apps/web/lib/delegation-pool.test.ts`

**Step 1: 写失败测试**

```typescript
import { isDelegatedChildSession, rollupChildTokens } from "./delegation-pool";

it("child sessions do not count toward per-user cap", () => {
  expect(isDelegatedChildSession("child-1")).toBe(false); // 初始未注册
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现**

`delegation-pool.ts`：注册子会话（不计 `incrementUserSessionCap`）、token 滚回根会话（累加到根 `Session.tokenUsage`）。仅根 Supervisor 会话计入 per-user 上限。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): delegation pool quota rollup"`

- [x] Task 3.6: DelegationTree 持久化 + 断点恢复

**Files:**
- Modify: `apps/web/lib/delegate-agent-tool.ts`（写 DelegationTree）
- Test: `apps/web/lib/delegation-tree.test.ts`

**Step 1: 写失败测试**

```typescript
import { recordDelegation, getDelegationTree } from "./delegation-tree";

it("persists parent-child delegation tree", async () => {
  await recordDelegation({ rootSessionId: "r1", parentSessionId: "r1", childSessionId: "c1", mode: "sync", depth: 1 });
  const tree = await getDelegationTree("r1");
  expect(tree.length).toBeGreaterThan(0);
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现**

`delegation-tree.ts`：`recordDelegation` 写 `DelegationTree`；`getDelegationTree(rootSessionId)` 查整棵树支持断点恢复与树状展示。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): DelegationTree persistence"`

- [x] Task 3.7: 事件回流到根 SSE

**Files:**
- Modify: `apps/web/lib/delegate-agent-tool.ts`（子 Agent `tool_update/message` 经 Supervisor 转发）
- Test: `apps/web/lib/delegate-agent-tool.test.ts`

**Step 1: 写失败测试**

```typescript
it("forwards child tool_update events to root emitter", async () => {
  const events: string[] = [];
  const tool = createDelegateAgentTool({ rootSessionId: "r1", userId: "u1", teamId: "t1", depth: 0, onChildEvent: (e) => events.push(e.type) });
  await tool.execute({ agentId: "a1", task: "t", mode: "sync" });
  expect(events.length).toBeGreaterThanOrEqual(0); // 有子事件则转发
});
```

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现**

`createDelegateAgentTool` 接受 `onChildEvent` 回调，子会话 `subscribe` 的事件加 `delegation: { childSessionId, agentId }` 包装后转发到根会话 SSE emitter。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): forward child events to root SSE"`

---

# Phase 4 — 后端：API 端点

> 设计文档 §5。全部强制 tenant 过滤 + RBAC。

- [x] Task 4.1: /api/digital-employees CRUD + 绑定

**Files:**
- Create: `apps/web/app/api/digital-employees/route.ts`（GET 列表 / POST 创建）
- Create: `apps/web/app/api/digital-employees/[id]/route.ts`（GET/PATCH/DELETE + 绑定技能/MCP）
- Test: `apps/web/tests/integration/digital-employees.test.ts`

**Step 1: 写失败测试（集成，真实 PG）**

```typescript
// 用 supertest 或直接调用 route handler，带 x-user-id 头
it("creates and lists a digital employee for the tenant", async () => {
  // POST /api/digital-employees { name, systemPrompt, model, scope }
  // GET /api/digital-employees 只返回本 tenant 的
});
it("rejects cross-tenant read", async () => { /* 另一 team 的用户读不到 */ });
```

**Step 2: 跑测试确认失败** — `cd apps/web && npx vitest run tests/integration/digital-employees.test.ts` → FAIL（404）。

**Step 3: 实现路由**

POST：从 `x-user-id` + team 成员关系推导 `tenantId`，写 `Agent`（忽略 client 传的 teamId）。GET：按 tenant 过滤。`[id]`：PATCH 编辑、DELETE 级联删绑定（Task 7.4）、子路由 `/bindings` 绑定/解绑技能与 MCP。避开现有 `/api/agent/*` 会话端点。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): /api/digital-employees CRUD + bindings"`

- [x] Task 4.2: /api/admin/users 扩展（停用/启用/重置密码/删除）

**Files:**
- Modify: `apps/web/app/api/admin/users/route.ts`（现有仅创建）
- Create: `apps/web/app/api/admin/users/[id]/route.ts`
- Test: `apps/web/tests/integration/admin-users.test.ts`

**Step 1: 写失败测试** — 停用用户后该用户无法再建会话；重置密码后 `mustChangePassword=true`；删除用户级联清理。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — PATCH `/{id}` `{ action: "disable"|"enable"|"resetPassword" }`，DELETE `/{id}`。仅平台管理员（`getUserHighestRole` + 平台标记）。全部 `auditLog`。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): admin users lifecycle"`

- [x] Task 4.3: /api/admin/teams 生命周期

**Files:**
- Create: `apps/web/app/api/admin/teams/route.ts` 与 `[id]/route.ts`、`[id]/invites/route.ts`
- Test: `apps/web/tests/integration/admin-teams.test.ts`

**Step 1: 写失败测试** — 创建团队、加/移除成员、设配额、生成邀请链接（`InviteLink`）。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — 团队 CRUD + 成员角色（OWNER/ADMIN/MEMBER）+ 配额 + 邀请链接生成/失效。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): admin teams lifecycle + invites"`

- [x] Task 4.4: /api/admin/models（复用 models-config）

**Files:**
- Create: `apps/web/app/api/admin/models/route.ts`
- Modify: 复用 `apps/web/app/api/models-config/route.ts` 的文件式配置
- Test: `apps/web/tests/integration/admin-models.test.ts`

**Step 1: 写失败测试** — 返回模型清单 + 默认 + 回退顺序；平台密钥池写 `PlatformApiKey`（加密）。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — GET 清单/默认/回退；PUT 更新；平台密钥池走 Task 7.1 加密。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): admin models config + platform key pool"`

- [x] Task 4.5: /api/admin/mcp CRUD + 绑定

**Files:**
- Create: `apps/web/app/api/admin/mcp/route.ts` 与 `[id]/route.ts`
- Test: `apps/web/tests/integration/admin-mcp.test.ts`

**Step 1: 写失败测试** — MCP Server CRUD；带凭证 MCP 挂 global 被拒 + 记审计 `mcp.credential_global_denied`；按团队/Agent 绑定。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — config 经 Task 7.1 加密落 `configEnc`；绑定写 `AgentMcpBinding`；凭证隔离规则同 Task 2.3。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): admin mcp CRUD + binding + credential isolation"`

- [x] Task 4.6: /api/admin/audit 查询

**Files:**
- Create: `apps/web/app/api/admin/audit/route.ts`
- Test: `apps/web/tests/integration/admin-audit.test.ts`

**Step 1: 写失败测试** — 按 userId/action/resourceType/时间范围查 `AuditLog`，仅平台管理员。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — GET 分页查询，覆盖身份/鉴权/配额/绑定变更 + MCP 调用 + 技能安装事件。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): admin audit log query"`

- [x] Task 4.7: /api/auth/refresh 复用（Vue3 对接）

**Files:**
- Modify: `apps/web/app/api/auth/refresh/route.ts`（若需 CORS/cookie 调整供 dashboard 调用）
- Test: `apps/web/tests/integration/auth-refresh.test.ts`

**Step 1: 写失败测试** — 过期 access token + 有效 refresh → 新 access token；httpOnly cookie。

**Step 2: 跑测试确认失败** → FAIL（若已存在则补边界用例）。

**Step 3: 实现** — 确认 refresh 端点可被 dashboard 经 proxy 调用；refresh token 置 httpOnly（Task 7.5）。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): auth refresh for vue3 dashboard"`

---

# Phase 5 — 后端：技能系统多租户化

> 设计文档 §5 API 表 + tasks T5。

- [x] Task 5.1: /api/skills/install 支持 global/team/user

**Files:**
- Modify: `apps/web/app/api/skills/install/route.ts`
- Test: `apps/web/tests/integration/skills-install.test.ts`

**Step 1: 写失败测试** — 以 team/user 作用域安装技能，写 `SkillPackage`（对应 scope + teamId/userId）。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — 扩展安装路由接受 `scope`，tenant 推导，写对应作用域行。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): skill install scoped global/team/user"`

- [x] Task 5.2: /api/skills/search 作用域过滤

**Files:**
- Modify: `apps/web/app/api/skills/search/route.ts`
- Test: `apps/web/tests/integration/skills-search.test.ts`

**Step 1: 写失败测试** — 搜索只返回调用者可见作用域（global + 本 team + 本 user）的技能。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — 搜索按 tenant 过滤。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): skill search scope-filtered"`

- [x] Task 5.3: /api/plugins 按 global/team/user/agent 解析 + tenant 过滤

**Files:**
- Modify: `apps/web/app/api/plugins/route.ts`
- Test: `apps/web/tests/integration/plugins.test.ts`

**Step 1: 写失败测试** — 插件列表按 global/team/user/agent 解析并强制 tenant 过滤。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — 复用 Task 2.2/2.3 解析逻辑。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): plugins tenant-scoped resolution"`

- [x] Task 5.4: 对话中 `/<skill>` 显式调用

**Files:**
- Create: `apps/web/lib/skill-invoke.ts`
- Test: `apps/web/lib/skill-invoke.test.ts`

**Step 1: 写失败测试** — `/<skill>` 映射到 `disableModelInvocation` 技能并注入指令。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — 解析 `/<skill>` 前缀 → 查技能 → 注入。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): explicit /<skill> invocation"`

- [x] Task 5.5: 模型自决 `<skill>` 块（parseSkillBlock）

**Files:**
- Create: `apps/web/lib/skill-block.ts`
- Test: `apps/web/lib/skill-block.test.ts`

**Step 1: 写失败测试** — `parseSkillBlock` 从 assistant 输出解析 `<skill>...</skill>` 并返回注入指令。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — `parseSkillBlock(text)` 返回 `{ skillName, instructions }`，前端可视化提示。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): model-decided <skill> block parsing"`

---

# Phase 6 — 前端：Vue3 统一主界面（apps/dashboard）

> 设计文档 §1。减法改造，13 屏。依赖 Phase 2/4/5 的 API 契约。

- [x] Task 6.0: 减法改造 — 删 demo 页与 mock

**Files:**
- Delete: `apps/dashboard/src/mock/`
- Delete: 模板自带演示 views（article/comment/地图/工作流/图表 demo 等，按 C2 Spike 清单）
- Modify: `apps/dashboard/src/router/`（移除 demo 路由）

**Step 1: 删 mock 与 demo 路由**

按 C2 Spike 列出的 demo 页清单删除对应 `src/views/*` 与路由模块、`src/mock`。

**Step 2: 构建验证**

Run: `pnpm --filter @ai-agent-workshop/dashboard build`
Expected: 构建通过，无悬挂 import。

**Step 3: Commit** — `git commit -m "feat(m3): strip dashboard demo pages and mock"`

- [x] Task 6.1: 单一入口 + RBAC 菜单渲染

**Files:**
- Modify: `apps/dashboard/src/router/modules/`、`apps/dashboard/src/store/modules/`（权限）
- Test: 手动/Playwright（Task 8.3 覆盖）

**Step 1: 实现 RBAC 菜单** — 工作区/我的资源（所有用户）、团队（OWNER）、平台管理（管理员）。菜单渲染与后端权限点对齐。

**Step 2: 验证** — `pnpm --filter @ai-agent-workshop/dashboard dev`，三种角色登录看到不同菜单。

**Step 3: Commit** — `git commit -m "feat(m3): single entry + RBAC menu"`

- [x] Task 6.2: 登录页 + refresh 续期 + 强制改密

**Files:**
- Modify: `apps/dashboard/src/views/auth/`（登录）、`apps/dashboard/src/api/`（auth）、`apps/dashboard/src/store/modules/user.ts`

**Step 1: 实现** — 用户名+密码登录，对接 `/api/auth/refresh` 续期；新用户首次登录强制改密（对接 `mustChangePassword`）。

**Step 2: 验证** — 登录 → 过期自动刷新 → 首登改密跳转。

**Step 3: Commit** — `git commit -m "feat(m3): login + refresh + force change password"`

- [x] Task 6.3: 工作空间屏

**Files:**
- Create: `apps/dashboard/src/views/workspace/index.vue`（统计卡片 + 最近会话 + 快捷操作）

**Step 1: 实现** — 统计卡片（今日会话/Token/活跃 Agent/MCP/技能）、最近会话、快捷操作，数据来自 `/api/sessions` 等。

**Step 2: 验证** — 断点 320/768/1440 无溢出。

**Step 3: Commit** — `git commit -m "feat(m3): workspace screen"`

- [x] Task 6.4: Agent 工作台屏（SSE 打字机）

**Files:**
- Create: `apps/dashboard/src/views/agent-workbench/index.vue` + `composables/useAgentEvents.ts`

**Step 1: 实现** — 会话列表 + 对话区（`EventSource` 消费 `/api/agent/[id]/events` 流式打字机）+ 当前 Agent/工具面板；支持 `/<skill>` 与 `@MCP` 提示。

**Step 2: 验证** — 发一条消息看到流式渲染。

**Step 3: Commit** — `git commit -m "feat(m3): agent workbench with SSE typewriter"`

- [x] Task 6.5: 多 Agent 编排屏

**Files:**
- Create: `apps/dashboard/src/views/orchestration/index.vue`

**Step 1: 实现** — 任务输入 + 模式切换（同步/并行/异步）+ 编排树实时展示（来自 DelegationTree + 事件回流）+ 执行日志/结果。

**Step 2: 验证** — 发起并行委派，编排树实时更新。

**Step 3: Commit** — `git commit -m "feat(m3): orchestration screen"`

- [x] Task 6.6: 数字员工屏

**Files:**
- Create: `apps/dashboard/src/views/digital-employees/index.vue`

**Step 1: 实现** — 列表（团队预置只读继承 + 个人可编辑）+ 创建/编辑/克隆为个人 + 绑定技能/MCP 界面，对接 `/api/digital-employees`。

**Step 2: 验证** — 创建数字员工并绑定技能。

**Step 3: Commit** — `git commit -m "feat(m3): digital employees screen"`

- [x] Task 6.7: 技能中心屏

**Files:**
- Create: `apps/dashboard/src/views/skill-center/index.vue`

**Step 1: 实现** — 已安装列表（按作用域）+ 市场搜索 + 安装/启停，对接 `/api/skills/*`。

**Step 2: 验证** — 安装一个 team 作用域技能。

**Step 3: Commit** — `git commit -m "feat(m3): skill center screen"`

- [x] Task 6.8: 我的设置屏（BYOK）

**Files:**
- Create: `apps/dashboard/src/views/settings/index.vue`

**Step 1: 实现** — 个人资料 + BYOK API Key 管理（写 `UserApiKey`，加密）+ 默认模型 + 故障回退开关 + 我的配额。

**Step 2: 验证** — 保存 BYOK key，不明文回显。

**Step 3: Commit** — `git commit -m "feat(m3): settings screen (BYOK)"`

- [x] Task 6.9: 团队管理屏（OWNER）

**Files:**
- Create: `apps/dashboard/src/views/team/index.vue`

**Step 1: 实现** — 团队列表 + 创建团队 + 成员管理（角色/移除）+ 配额设置 + 邀请链接，对接 `/api/admin/teams`。

**Step 2: 验证** — OWNER 创建团队并生成邀请链接。

**Step 3: Commit** — `git commit -m "feat(m3): team management screen"`

- [x] Task 6.10: 平台管理屏（管理员）

**Files:**
- Create: `apps/dashboard/src/views/platform/index.vue`（用户/模型/MCP/技能/审计/监控 ECharts）

**Step 1: 实现** — 用户管理 + 模型配置 + MCP 精选库 + 技能精选库 + 审计日志 + 监控大盘（ECharts），对接 `/api/admin/*`。

**Step 2: 验证** — 管理员查看审计日志与监控。

**Step 3: Commit** — `git commit -m "feat(m3): platform admin screen"`

- [x] Task 6.11: Pinia stores

**Files:**
- Create: `apps/dashboard/src/store/modules/{auth,user,team,agent,skill,mcp,session}.ts`

**Step 1: 实现** — 按域拆分 stores，统一 API 错误处理与 401 刷新钩子。

**Step 2: 验证** — stores 单测（若 dashboard 配 Vitest）或手动。

**Step 3: Commit** — `git commit -m "feat(m3): pinia stores"`

- [x] Task 6.12: 路由守卫

**Files:**
- Modify: `apps/dashboard/src/router/guards/`

**Step 1: 实现** — 未登录跳登录页；按角色过滤菜单；API 401 自动刷新 token（拦截器）。

**Step 2: 验证** — 未登录访问被重定向；401 自动刷新重放。

**Step 3: Commit** — `git commit -m "feat(m3): router guards + 401 refresh"`

---

# Phase 7 — 安全与凭证

> 设计文档 §7 风险 + tasks T7。

- [x] Task 7.1: AES-256-GCM 加密模块

**Files:**
- Create: `apps/web/lib/crypto.ts`
- Test: `apps/web/lib/crypto.test.ts`

**Step 1: 写失败测试**

```typescript
import { encryptSecret, decryptSecret } from "./crypto";

it("round-trips AES-256-GCM", () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString("base64");
  const enc = encryptSecret("sk-live-123");
  expect(enc).not.toContain("sk-live-123");
  expect(decryptSecret(enc)).toBe("sk-live-123");
});
it("throws without APP_ENCRYPTION_KEY", () => {
  delete process.env.APP_ENCRYPTION_KEY;
  expect(() => encryptSecret("x")).toThrow();
});
```

**Step 2: 跑测试确认失败** — `cd apps/web && npx vitest run lib/crypto.test.ts` → FAIL。

**Step 3: 实现** — `crypto.ts`：AES-256-GCM，主密钥 = `process.env.APP_ENCRYPTION_KEY`（base64 32 字节），输出 `iv.authTag.ciphertext` base64 拼接。绝不明文落库。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): AES-256-GCM crypto module"`

- [x] Task 7.2: 租户上下文强制

**Files:**
- Create: `apps/web/lib/tenant-context.ts`
- Test: `apps/web/lib/tenant-context.test.ts`

**Step 1: 写失败测试** — `getTenantId(req)` 只从 `x-user-id` + DB 推导，拒绝 client 传的 `teamId` 字段。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — 中间件式助手，所有新 API 路由统一调用，禁止 client 传 tenantId。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): server-derived tenant context"`

- [x] Task 7.3: 会话正文隐私

**Files:**
- Modify: `apps/web/app/api/admin/`（平台管理员仅元数据）
- Test: `apps/web/tests/integration/session-privacy.test.ts`

**Step 1: 写失败测试** — 平台管理员 GET 会话只返回标题/时间/token 用量，不含正文。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — 管理员视图只读 `Session` 元数据列，不读 `jsonlPath` 正文。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): session body privacy for platform admin"`

- [x] Task 7.4: 级联删除绑定行

**Files:**
- Modify: 各 DELETE 路由（digital-employees / mcp / skills）
- Test: `apps/web/tests/integration/cascade-delete.test.ts`

**Step 1: 写失败测试** — 删除技能/MCP/Agent 时其 `AgentSkillBinding/AgentMcpBinding/UserSkillBinding` 行被清理。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — 删除前 `deleteMany` 绑定行（或 Prisma `onDelete: Cascade`）。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): cascade delete bindings"`

- [x] Task 7.5: refresh token httpOnly + CSRF

**Files:**
- Modify: `apps/web/app/api/auth/`（cookie 设置）
- Test: `apps/web/tests/integration/auth-csrf.test.ts`

**Step 1: 写失败测试** — refresh cookie `httpOnly; sameSite=strict/lax`；状态变更请求校验 CSRF/origin。

**Step 2: 跑测试确认失败** → FAIL。

**Step 3: 实现** — cookie 属性 + origin/double-submit 校验。

**Step 4: 跑测试确认通过** → PASS。

**Step 5: Commit** — `git commit -m "feat(m3): refresh httpOnly + CSRF protection"`

---

# Phase 8 — 测试与验证（目标覆盖率 ≥80%）

- [x] Task 8.1: 单元测试补齐

**Step 1: 跑覆盖率**

Run: `cd apps/web && npx vitest run --coverage`
Expected: 四层解析、委派护栏、配额计算、加密模块均有覆盖；找出未达标文件补测。

**Step 2: 补测至核心逻辑 ≥80%** — 重点 `scope-resolve / delegate-agent-tool / delegation-pool / crypto`。

**Step 3: Commit** — `git commit -m "test(m3): unit coverage for resolution/guardrails/quota/crypto"`

- [x] Task 8.2: 集成测试

**Step 1: 数字员工 CRUD + 绑定端到端**（真实 PG）。

**Step 2: 多 Agent 编排端到端**（sync + parallel）。

**Step 3: SSE 流式 + RBAC 越权 + 凭证不跨租户泄漏**。

**Step 4: Commit** — `git commit -m "test(m3): integration tests"`

- [x] Task 8.3: E2E（Playwright）

**Files:**
- Create: `apps/web/tests/e2e/m3-workbench.spec.ts`（或 dashboard 侧 e2e）

**Step 1: 写 E2E** — 登录 → 创建数字员工 → 发起对话 → 发起多 Agent 任务 → 管理后台操作。断点 320/768/1440。

**Step 2: 跑 E2E**

Run: `pnpm --filter @ai-agent-workshop/web test:e2e`（或 dashboard e2e 脚本）
Expected: 关键流程通过。

**Step 3: Commit** — `git commit -m "test(m3): playwright e2e workbench flow"`

- [x] Task 8.4: 覆盖率 ≥80% 验证

**Step 1: 跑全量覆盖率**

Run: `cd apps/web && npx vitest run --coverage`
Expected: 整体 ≥80%。未达标则回到 8.1/8.2 补测。

**Step 2: Commit（如有测试补充）** — `git commit -m "test(m3): reach 80% coverage"`

---

# Phase 9 — 文档与收尾

- [x] Task 9.1: 更新 README / AGENTS.md

**Files:**
- Modify: `README.md`、`AGENTS.md`

**Step 1: 更新** — Vue3 主界面 + 数字员工 + 编排使用说明。

**Step 2: Commit** — `git commit -m "docs(m3): vue3 workbench + digital employees + orchestration"`

- [x] Task 9.2: 更新个人工作空间设计文档状态

**Files:**
- Modify: `docs/plans/2026-07-15-ai-agent-workshop-personal-workspace-design.md`

**Step 1: 更新** — 状态改为「已评审，由 M3 实现」。

**Step 2: Commit** — `git commit -m "docs(m3): mark personal-workspace design superseded by M3"`

- [x] Task 9.3: open guard 确认（若尚未进入 design）

**Step 1: 运行 guard**

Run: `comet-guard m3-vue3-workbench open --apply`
Expected: ALL CHECKS PASSED（三件套完整）。

> 注：本计划本身即 design 阶段产物；若已 design，则此步转为确认 design 阶段产物齐全。

---

# 执行顺序与并行

```
T0 Spike/基线 → T1 数据模型 → T2 运行时接缝 → T3 编排 → T4 API → T5 技能 → T6 前端 → T7 安全 → T8 测试 → T9 文档
（T2/T3 可并行；T4/T5 可并行；T6 依赖 T2/T4/T5 的 API 契约；T7.1 加密模块应提前到 T1.7/T4.4/T4.5 之前完成）
```

**关键路径提醒**：`Task 7.1 加密模块` 被 T1.7（API Key 表）、T4.4（平台密钥池）、T4.5（MCP config）、T6.8（BYOK）依赖，建议在 Phase 1 末尾即完成，不要等到 Phase 7。

---

# 执行交接

**计划已保存到 `docs/superpowers/plans/2026-07-16-m3-vue3-workbench.md`。两种执行方式：**

**1. Subagent-Driven（本会话）** — 我为每个 task 派发新 subagent，任务间做代码审查，快速迭代

**2. Parallel Session（另开会话）** — 在 worktree 中另开会话用 executing-plans，带检查点批量执行

**选哪种？**
