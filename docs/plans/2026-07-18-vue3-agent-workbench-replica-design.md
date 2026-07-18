# Vue3 Agent 工作台复刻设计

> 日期：2026-07-18
> 源：`apps/web/components/*` (Next.js + React, 14 组件, ~14.5K 行)
> 目标：`apps/dashboard/src/views/agent-workbench/` (Vue 3 + Element Plus)

## 背景

`apps/web` 的 Agent 界面（`AppShell` + 14 个组件）是相对完整的 IDE 风格工作台。但按 `apps/web/CLAUDE.md` 的事实分层，dashboard (Vue3) 才是用户入口，apps/web 的 React UI 仅作开发参考。

dashboard 当前 `views/agent-workbench/index.vue` 是单文件 693 行，仅实现了会话列表（新建/重命名/置顶/删除）+ 基础聊天。缺：Markdown 渲染、文件浏览器、分支切换、模型/技能/插件配置、Tab、对话小地图。

API 契约已共享（`apps/web/app/api/**/route.ts` 是 Vue 端事实后端），后端不动。

## 范围

完全平移 14 个组件 + 按子目录拆分 + Element Plus + 原生 CSS。

## ⚠️ v1.1 关键修订（基线建之前发现）

1. **dashboard 已有第二条独立路径**：`components/core/layouts/art-chat-window/` + `store/modules/chat.ts`（走 `/api/v1/ai/chat` + `postStream` 文本流）。这是 Art Bot 全局浮窗，与本次复刻的 Pi Agent 工作台**完全独立**，不复用、不替换、不混。
2. **SSE 不只一条**：`/api/agent/[id]/events`（per-session 消息/工具/分支）+ `/api/agent/running/events`（全局「哪些 session 在跑」）。后者必须由侧栏消费，避免每个 session 各开 EventSource（参考 apps/web 已有用法）。
3. **`api/agent.ts` 已有基础封装**（`listSessions` / `createSession` / `sendMessage` / `renameSession` / `togglePinSession` / `deleteSession` / `listAvailableAgents` / `startDelegation`）。Track A 应**扩展**该文件，不新建 `api/sessions.ts`。原设计文档里"新建 api/sessions.ts"作废。
4. **MarkdownBody 必须用 DOMPurify**：v-html 用户/Agent 内容是 XSS 入口；markdown-it 渲染后必须过 DOMPurify（白名单 tags，不黑名单）。链接 href 过 `safeUrl()` 校验（只允许 `http:` / `https:` / `mailto:`）。文件路径 / 工作区路径渲染前也要校验。
5. **MarkdownBody 不要用 `v-html` 直接渲染未净化 HTML**：参考 web 安全规则——sanitize 必须在调用点同地，sanitize 配置走白名单而非黑名单。

## ⚠️ v1.2 关键修订（用户最终确认）

6. **复用策略**：Track A 在 `apps/dashboard/src/api/agent.ts` 上扩展（新增 `subscribeRunningSessions` / `listFiles` / `getFile` / `getModelConfig` / `setModelConfig` / `getSkills` / `setSkills` / `getPlugins` / `setPlugins` 等），不新建 `api/` 子目录。
7. **abort 流**：Track B 在 `useAgentSession` 暴露 `abort()`，ChatInput 在 streaming 时把「发送」按钮换成「停止」按钮，点击调 `abort()`。`sendMessage` 内部把 EventSource 句柄存入 ref，`abort()` 调 `es.close()` + 标记流状态为 `cancelled`。
8. **running/events**：Track A 在 SessionSidebar 启动第二个 EventSource（独立于当前选中 session 的那条），订阅 `/api/agent/running/events`，把 `runningSessionIds: Set<string>` 维护成 `Map<sessionId, boolean>`，会话项渲染时根据 `runningMap.get(id)` 加 loading 转圈或状态点。

## 目录布局

```
apps/dashboard/src/views/agent-workbench/
├── index.vue                          # 主壳,等价 AppShell.tsx
├── types.ts                           # 共享类型
├── api/
│   ├── sessions.ts                    # 扩展 apps/dashboard/src/api/agent.ts(已存在),不新建
│   ├── messages.ts                    # /api/agent/[id]/events(SSE)+ /api/agent/[id](POST)
│   ├── files.ts                       # ⚠️ v1.3: apps/web 没有 /api/agent/*/files 端点,Track C 用 mock 兜底
│   ├── running.ts                     # /api/agent/running/events(侧栏「在跑」状态)
│   └── config.ts                      # /api/agent/config/{models,skills,plugins} (待确认)
├── composables/
│   ├── useAgentSession.ts             # 当前会话状态 + 消息流
│   ├── useEventStream.ts              # EventSource + cap + released 幂等门
│   ├── useSessionList.ts              # 会话列表 CRUD
│   ├── useFileExplorer.ts             # 文件树
│   └── useConfigPanel.ts              # 配置面板数据
├── components/
│   ├── SessionSidebar.vue             # 2150 行源 → 等价物
│   ├── ChatWindow.vue                 # 1047
│   ├── MessageView.vue                # 1336
│   ├── ChatInput.vue                  # 1950
│   ├── BranchNavigator.vue            # 400
│   ├── FileExplorer.vue               # 323
│   ├── FileViewer.vue                 # 998
│   ├── FileIcons.vue                  # 249
│   ├── MarkdownBody.vue               # 250
│   ├── ModelsConfig.vue               # 1648
│   ├── SkillsConfig.vue               # 918
│   ├── PluginsConfig.vue              # 1014
│   ├── TabBar.vue                     # 102
│   └── ChatMinimap.vue                # 381
└── styles/
    └── workbench.css                  # IDE 风格变量与共享样式
```

## 关键映射规则

| React | Vue 3 |
|---|---|
| `useState` | `ref` / `reactive` |
| `useEffect` | `watch` / `watchEffect` / `onMounted` |
| `props` | `defineProps` |
| Context | `provide` / `inject` 或 Pinia |
| Portal | `el-dialog` / `el-popover` |
| `<X key={k}>` 重建 | `:key="currentSessionId"` + `watch` 清理副作用 |

## 组件契约

### 顶层 `index.vue`

三栏布局：`SessionSidebar | (TabBar + ChatWindow) | ConfigPanel`（抽屉）。

```ts
const currentSessionId = ref<string | null>(null)
const activePanel = ref<'none' | 'files' | 'models' | 'skills' | 'plugins'>('none')
const { sessions, refresh } = useSessionList()
```

### SessionSidebar.vue

```ts
interface Props {
  currentSessionId: string | null
  collapsed?: boolean
}
defineEmits<{
  select: [sessionId: string]
  create: []
  rename: [sessionId: string, newTitle: string]
  pin: [sessionId: string, pinned: boolean]
  delete: [sessionId: string]
}>()
```

只管列表,不含消息流。emits 是与外界的唯一通道。

### ChatWindow.vue

```ts
interface Props { sessionId: string }
const { messages, sendMessage, abort, isStreaming } = useAgentSession(
  toRef(props, 'sessionId')
)
```

`:key="sessionId"` 由 `index.vue` 显式绑定,切换会话时自然重建。

### MessageView.vue

```ts
interface Props {
  message: AgentMessage
  branches?: Branch[]
  isLast?: boolean
}
defineEmits<{
  branchSwitch: [messageId: string, branchId: string]
  toolExpand: [toolCallId: string]
  retry: [messageId: string]
}>()
```

### ChatInput.vue

```ts
interface Props {
  disabled?: boolean
  placeholder?: string
  sessionId: string
}
defineEmits<{ send: [text: string, attachments: File[]] }>()
```

内部:文本历史(↑↓ 翻)、附件拖拽、@mention、技能快捷键。

### BranchNavigator.vue

```ts
interface Props { branches: Branch[]; currentBranchId: string }
defineEmits<{ switch: [branchId: string] }>()
```

### FileExplorer.vue

```ts
interface Props { sessionId: string; rootPath?: string }
defineEmits<{ fileOpen: [path: string]; fileChanged: [path: string] }>()
const { tree, expanded, loading } = useFileExplorer(toRef(props, 'sessionId'))
```

### FileViewer.vue

```ts
interface Props { sessionId: string; filePath: string }
defineEmits<{ close: [] }>()
```

### FileIcons.vue

```ts
interface Props { filename: string; isDir: boolean }
```

### MarkdownBody.vue

```ts
interface Props { content: string; mode?: 'full' | 'compact' }
```

### ModelsConfig.vue / SkillsConfig.vue / PluginsConfig.vue

```ts
interface Props { sessionId?: string }  // undefined = 全局
defineEmits<{ close: [] }>()
```

### TabBar.vue

```ts
interface Props { tabs: Tab[]; activeTabId: string }
defineEmits<{ select: [tabId: string]; close: [tabId: string] }>()
```

### ChatMinimap.vue

```ts
interface Props { messages: AgentMessage[] }
defineEmits<{ jumpTo: [messageId: string] }>()
```

## 类型层 `types.ts`

```ts
export interface AgentSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  pinned: boolean
  available?: boolean
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  branchId?: string
  parentMessageId?: string
  createdAt: string
}

export interface ToolCall {
  id: string
  name: string
  status: 'pending' | 'running' | 'done' | 'error'
  args?: unknown
  result?: unknown
}

export interface Branch {
  id: string
  parentMessageId: string
  createdAt: string
}

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

export interface Tab {
  id: string
  sessionId: string
  title: string
}
```

## 状态归属

| 数据 | 归属 |
|---|---|
| 当前 session id、消息列表、stream 状态 | `useAgentSession` (per-session composable) |
| 会话列表(pin/重命名/搜索) | `useSessionList` composable |
| SSE 连接 | `useEventStream` composable |
| 文件树 | `useFileExplorer` composable |
| 配置(model/skill/plugin) | `useConfigPanel` composable + 缓存 |
| 用户偏好 | dashboard 全局 store |

## SSE 事件流（关键防护）

参考 apps/web 已验证的三层防护（见 `apps/web/components/SessionSidebar.tsx` + memory `events-sse-refcount-cap-closure`）：

```ts
// useEventStream.ts 骨架
export function useEventStream(sessionId: Ref<string>) {
  const released = ref(new WeakSet<MessageEvent>())
  let es: EventSource | null = null
  const cap = new WeakSet()

  function connect() {
    if (es) es.close()
    es = new EventSource(`/api/agent/${sessionId.value}/events`)
    es.onmessage = (ev) => {
      if (released.value.has(ev) || cap.has(ev)) return
      cap.add(ev)
      handle(ev.data)
    }
    es.onerror = () => setTimeout(connect, 1500)
  }

  onUnmounted(() => {
    es?.close()
    released.value = new WeakSet()
  })

  watch(sessionId, () => connect())
  return { /* ... */ }
}
```

**窄白名单**（防 pi SDK 事件泛洪,见 memory `pi-sdk-event-narrow-whitelist-pitfall`）：

```ts
const ALLOWED_EVENTS = new Set([
  'message.start', 'message.delta', 'message.complete',
  'tool.start', 'tool.delta', 'tool.complete',
  'branch.created', 'branch.switched',
  'file.changed', 'session.pinned', 'session.renamed',
  'error', 'done'
])
// 其它事件 → console.warn 并丢弃
```

## 错误处理

四层防护：

| 层 | 职责 | 实现 |
|---|---|---|
| 1. 网络层 | 401 refresh、5xx 退避、abort | dashboard 现有 axios 拦截器 |
| 2. SSE 层 | 重连退避、cap 去重、released 幂等门 | `useEventStream` |
| 3. 消息层 | 流中断、超时、未知事件 | `useAgentSession` 包装:超时 90s 提示,流错误标记 `partial=true` |
| 4. UI 层 | 用户可见反馈 | Element Plus `ElNotification` / `ElMessage` |

错误码 → 文案：

| 错误 | 文案 | 行动 |
|---|---|---|
| `401` | "登录已过期，正在续期…" | 自动 refresh |
| `403` + `x-must-change-password` | "请先修改初始密码" | 跳登录页 |
| `404` (session) | "该会话文件不存在" | 侧栏标红,提示新建 |
| `409` | "操作冲突，请刷新后重试" | Toast + 自动 refresh |
| `5xx` | "服务暂时不可用" | Toast + 重试按钮 |
| SSE 断连 >30s | "连接中断，正在重连…" | 顶部条状提示 |

原则：永不静默吞错。上层不感知错误码,只接收 `error: Ref<string|null>` + `clearError()`。

## 测试策略

| 类型 | 范围 | 工具 |
|---|---|---|
| 单元 | composable + 关键组件 | Vitest + @vue/test-utils |
| E2E | 新建会话 → 发消息 → 收流 → 置顶/重命名/删除 → 文件浏览 → 配置面板 | Playwright |
| 可视 | index.vue 三栏布局 + MessageView 流式状态 | Playwright screenshot, 320/768/1024/1440 |

**TDD 顺序**（每个组件）：类型 → composable 单测(RED→GREEN) → 组件 props/emits 单测 → E2E → 视觉快照。

不写测试：`FileIcons`、`MarkdownBody`（纯展示）。

## 并行拆分（3 track）

依赖关系：types.ts 必须最先产出,workbench.css 第二批,index.vue 最后统合。

```
Track A (会话侧栏 + 配置 + Tab)        Track B (聊天核心)              Track C (文件 + 杂项)
─────────────────────────────        ──────────────────              ──────────────────
types.ts (A 第一个产出)               ChatWindow.vue                  FileExplorer.vue
SessionSidebar.vue                    MessageView.vue                 FileViewer.vue
TabBar.vue                            ChatInput.vue                   FileIcons.vue
ModelsConfig.vue                      BranchNavigator.vue             ChatMinimap.vue
SkillsConfig.vue                      MarkdownBody.vue                useFileExplorer.ts
PluginsConfig.vue                     useAgentSession.ts              api/files.ts
useSessionList.ts                     useEventStream.ts               workbench.css (C 第一个产出)
useConfigPanel.ts                     api/messages.ts
api/sessions.ts
api/config.ts
```

**协调流程**：

1. 主会话建 `types.ts` 与 `workbench.css` 基线（5 分钟）
2. 启动 3 个独立 worktree,各一个 Sonnet 子代理并行
3. 每个 track 完成后提交独立分支
4. 主会话按顺序 merge：types/css → A → B → C → index.vue 统合
5. 跑 E2E + 视觉快照

## 工作量估算

| Track | 估算行数 | 风险 |
|---|---|---|
| Track A | ~3500 | 低 |
| Track B | ~3000 | 中-高(SSE 调试) |
| Track C | ~1500 | 低 |
| 统合 + E2E | ~500 | 低 |
| **总计** | **~8500** | Vue 比 React 紧凑(~40% 减少) |

## 实施清单（待启动 Track 时确认）

1. 主会话创建 `types.ts` + `workbench.css` + 空目录骨架
2. 启动 Track A / B / C 子代理(各发一份本设计文档摘要)
3. 每个 track 完成 → 主会话 review + merge
4. index.vue 统合（由主会话在所有组件就绪后写）
5. E2E + 视觉快照验证
6. 提交 + 文档更新

## 已知陷阱（来自 apps/web/CLAUDE.md + memory）

1. **会话切换必须清理 EventSource** — `apps/web/CLAUDE.md` 第 31 行：`AppShell` 显式 bump `sessionKey` 重建 `<ChatWindow>`。Vue 端用 `:key="currentSessionId"` + `onUnmounted` 清理，**漏清理会导致消息串流**。
2. **SSE 三层防护必须完全复刻** — apps/web 验证过的 `released`/`capturedWrapper`/`WeakSet cap` 不能省。
3. **pi SDK 事件窄白名单** — 不在白名单的事件 `console.warn` 后丢弃,不进 ref。
4. **后端不动** — `apps/web/app/api/**/route.ts` 是 Vue 端事实后端,所有调用走 dashboard 现有 axios。

## 不做（YAGNI）

- 暂不实现暗黑/亮色主题切换 — 跟随 dashboard 全局
- 暂不实现协作/共享会话 — apps/web 也没做
- 暂不实现语音输入/输出 — 不在源范围
- 暂不重写后端 — API 契约已共享