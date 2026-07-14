---
title: "pi-web：让登录后落到 chat UI（2026-07-14 调研修正）"
date: 2026-07-14
type: design
tags: [pi-web, routing, m2-2-correction]
status: validated-by-end-to-end-smoke
based_on:
  - "[[pi-web-generalized-design]]"
supersedes:
  - "[[2026-07-14-pi-web-min-chat-ui-design]]" # earlier draft assumed no chat UI existed
summary: "修正 2026-07-14 第一版设计 — 经探查发现 fork 已经在 app/[locale]/page.tsx 挂载了完整 chat UI（AppShell 集成 SessionSidebar + ChatWindow + FileViewer + ModelsConfig + SkillsConfig + PluginsConfig），不需要重写任何组件。问题只是 (a) 登录后 router.push 写死到 /<locale>/dashboard 而不是 /<locale>，(b) next-intl 缺 timeZone 导致 dev server ENVIRONMENT_FALLBACK 死循环 OOM。两个一行级修复即让用户登录后直接进入 chat UI。"
---

# pi-web：让登录后落到 chat UI（2026-07-14 调研修正）

## 0. 起源与修正

第一版 `2026-07-14-pi-web-min-chat-ui-design.md` 错误地假定 fork 没有 chat 前端，要新建 ProjectList / Chat / sessions/[id] 等 4 个文件。重新探查后确认：

- `app/[locale]/page.tsx` 已经 `<AppShell />`（`components/AppShell.tsx`，client component）
- `components/` 下有完整 chat 套件：`ChatWindow`、`ChatInput`、`ChatMinimap`、`MessageView`、`SessionSidebar`、`BranchNavigator`、`FileExplorer`、`FileViewer`、`MarkdownBody`、`TabBar`、`ModelsConfig`、`SkillsConfig`、`PluginsConfig`
- `hooks/useAgentSession.ts` 已实现 send+receive 含 SSE 流（in `useCallback[ensureNewSession]` / `useCallback[handleSend]`，log 验证过调用 `/api/agent/new`）
- `middleware.ts` → `proxy.ts` 已在 `/api/*` 上注入 `x-user-id` 头

**用户登录后看到的"最小 dashboard"实际是个独立 M2.2 admin 摘要页面 (`app/[locale]/dashboard/page.tsx`)，不是 chat UI 入口**。它只是没被去掉，与完整 AppShell 并存。

第一版 doc 作废，本 doc 记录真正需要的最小修复。

## 1. 范围决策记录（2026-07-14 end-to-end smoke）

| 决策 | 选择 | 理由 / 替代方案 |
|---|---|---|
| 是否新建 chat UI | 否，复用既有 `AppShell` | 避免与并行维护的 useAgentSession 重复；fork 已有 35KB 渲染产物 |
| 登录后落点 | `/<locale>`（AppShell），不是 `/<locale>/dashboard` | 用户要的是会话；dashboard 仅供 OWNER/ADMIN 看项目列表和创用户 |
| 必须 bind project 才能 Start Session | 是，fork 后端契约（`/api/agent/new` 不收 cwd） | 这是 fork 后端硬约束，由现有 AppShell 客户端走 `/api/projects/[id]/bind`，不用前端专门处理 |

## 2. 修复点（两处一行级改动 + 一处 4 行添加）

### 2.1 next-intl `timeZone` — 根治 dev server OOM

**文件**：`app/[locale]/intl-provider.tsx`

**症状**：`timeZone configured` ENVIRONMENT_FALLBACK 在 `LoginPage`、`DashboardPage` 等 `useTranslations` 第一次解析时抛出，触发 client hydration mismatch，next dev 持续 re-render，最终 `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`（2026-07-14 14:00 观察到）。

**修复**：`NextIntlClientProvider` 增加 `timeZone="UTC"` prop，加注释解释为什么。

**为什么不引 `i18n/request.ts`**：fork 设计文档明示 messages 直接从 `messages/{locale}.json` 加载，配 `i18n/request.ts` 会引入 fallback / locale handling 与现有 `lib/i18n.ts::t()` 双轨制，与设计意图冲突。

### 2.2 登录后跳转 `/<locale>` 不是 `/<locale>/dashboard`

**文件**：`app/[locale]/login/page.tsx` 一行；`app/[locale]/change-password/page.tsx` 一行。

**症状**：M2.2 写代码时把 dashboard 设为登录后落点，但这页面是 admin 摘要、与 chat 无关。新用户登录进来看不到 AppShell，会以为产品"没有 chat"。这正是 2026-07-14 user-reported 的"dashboard 就长这个样子？没有菜单？"。

**修复**：`router.push(/${locale}/dashboard)` → `router.push(/${locale})`，把第二处 `change-password` 的同样跳转也改了。`mustChangePassword` 仍先跳 `/change-password`，符合 M2.2 gate 契约。

## 3. 不做什么

- ❌ 不删 dashboard 路由 — 它仍有 OWNER/ADMIN 看项目列表 + Create User 的用途
- ❌ 不动 dashboard 与 `/<locale>` AppShell 的关系 — 二者并存，让 admin 在 AppShell 之外仍有轻量管理视图
- ❌ 不改 `proxy.ts` 的 `/api/*` 注入 — 与 chat UI 工作无关
- ❌ 不加 sidebar/history/project wizard — 上一版已规划，AppShell 已包含；本 doc 只做"端到端打通"
- ❌ 不写 e2e 自动化 — dev 手测通过即收尾；后续如要 CI 再说

## 4. 验证（已完成）

```bash
# 1. login
POST /api/auth/user-login?provider=local
  body: {"username":"root","password":"Test1234!"}
  → 200 {id, username, mustChangePassword:false}

# 2. /en 渲染 chat UI
GET /en  → 200 35 KB，包含 SessionSidebar/ChatWindow/Hide sidebar 控件

# 3. bind project（Start Session 必需的前置）
POST /api/projects/<id>/bind → 200 {ok:true, lastProjectId}

# 4. ensure_session 创建空壳
POST /api/agent/new body {"type":"ensure_session"}
  → 200 {success:true, sessionId:"019f5e4c…"}
```

四步全绿，验证完成。
