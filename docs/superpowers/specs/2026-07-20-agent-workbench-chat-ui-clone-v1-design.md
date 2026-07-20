---
comet_change: agent-workbench-chat-ui-clone-v1
role: technical-design
canonical_spec: openspec
---

# Technical Design: Agent 工作台聊天窗口 · 阶段 1 复刻

> 范围: 路径 A(`apps/dashboard/src/views/agent-workbench/`)8 项能力增量。OpenSpec `proposal.md` + `design.md` + 3 个 spec 是事实源,本文档是**对它们的执行粒度细化**(commit 边界、文件级落地清单、SSE 事件 payload 推测、Test 隔离策略)。
> 关系: `openspec/changes/agent-workbench-chat-ui-clone-v1/design.md` 是高层框架,本 Design Doc 是其技术落地细化,**不重写也不替代**。

## 0. 阅读顺序

- 想了解"做什么 / 范围" → 读 `openspec/changes/.../proposal.md`
- 想了解"高层决策 / 风险" → 读 `openspec/changes/.../design.md`
- 想了解"技术落地 / 实施粒度" → 读本文档

## 1. T1 基础设施 落地清单

### 1.1 types.ts 增量(`apps/dashboard/src/views/agent-workbench/types.ts`)

新增 5 个字段,加在现有 `AgentMessage` interface 内:

```ts
export interface AgentMessage {
  id: string
  role: AgentRole
  content: string
  // ... 既有字段 ...
  // ↓ 新增
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } }
  entryId?: string
  prevAssistantEntryId?: string
  modelProvider?: string
  modelId?: string
}

export interface QueueItem {
  id: string
  kind: 'steer' | 'followUp'
  text: string
  createdAt: string
}
```

### 1.2 useEventStream.ts SSE 白名单 扩展

现有 `ALLOWED_SSE_EVENTS` 数组(7 类)+ `handleEvent` switch。新增 4 类事件 + 4 个 case:

| 事件 type | 携带 payload | 处理动作 |
|---|---|---|
| `message_usage` | `{ input, output, cacheRead, cacheWrite, cost? }` | 写到最后一条 assistant 消息的 `usage` 字段 |
| `thinking_level_changed` | `{ level: 'auto'\|'off'\|... }` | 暂存到 useAgentSession 的 `pendingThinkingLevel`(后续由 useAgentSession 从 session metadata reconcile) |
| `queue_update` | `{ steer: QueueItem[], followUp: QueueItem[] }` | 直接覆盖 useAgentSession 的 `queuedMessages` |
| `model_changed` | `{ provider, modelId }` | 暂存(useAgentSession 后续 reconcile) |

**关键安全点**:每类事件都必须在白名单常量数组中显式枚举,绝不能用 `case 'a' | 'b'` 形式(参见 memory `pi-sdk-event-narrow-whitelist-pitfall`)。处理时若字段类型不匹配,`console.warn` 后丢弃,不破坏 rawMessages。

### 1.3 useAgentSession ref 集合扩展(5 → 30+)

新增 ref 完整清单(每个都要在 UseAgentSessionReturn 中暴露):

| ref | 类型 | 来源 |
|---|---|---|
| `modelNames` | `Ref<Record<string, string>>` | session metadata(model.provider+modelId 映射) |
| `modelList` | `Ref<Array<{provider, modelId, name}>>` | `/api/models-config` 一次性拉取缓存 |
| `thinkingLevel` | `Ref<'auto'\|'off'\|'minimal'\|'low'\|'medium'\|'high'\|'xhigh'\|'max'>` | session metadata.thinkingLevel |
| `availableThinkingLevels` | `Ref<Record<string, string[]>>` | session metadata(模型限定) |
| `toolPreset` | `Ref<'off'\|'default'\|'full'>` | session metadata.toolPreset |
| `tools` | `Ref<ToolEntry[]>` | `get_tools` 拉取 |
| `queuedMessages` | `Ref<{steer: QueueItem[]; followUp: QueueItem[]}>` | SSE `queue_update` 覆盖 |
| `slashCommands` | `Ref<SlashCommandInfo[]>` | `get_commands` 拉取 |
| `loadSlashCommands` | `() => Promise<void>` | 包装 `get_commands` |
| `setModel` | `(provider, modelId) => Promise<void>` | 包装 `set_model` + 乐观更新 + 失败回滚 |
| `setThinkingLevel` | `(level) => Promise<void>` | 同上 |
| `setTools` | `(toolNames: string[]) => Promise<void>` | 同上 |
| `refreshTools` | `() => Promise<void>` | 包装 `get_tools` 重新拉 |
| `sendSteer` | `(text, attachments?) => Promise<void>` | 包装 `steer` + 乐观 push QueueItem |
| `sendFollowUp` | 同上 + `follow_up` | |
| `cancelQueue` | `(id) => Promise<void>` | 包装 `cancel_queue`(若 OQ-2 答"否"降级为本地移除) |

**持久化层**:
- session 切换时(`watch(sessionId)` immediate):清空所有 ref + 重新走 fetchHistory
- 初次进入时:从 `/api/sessions/[id]/context` 拿到的 metadata 填充 modelNames / thinkingLevel / toolPreset

### 1.4 api/agent.ts 包装方法

6 个新方法,**全部 wrap `sendAgentCommand` + `/api/agent/[id]` 端点**:

```ts
export const getSlashCommands = (sid: string) =>
  sendAgentCommand<SlashCommandsResponse>(sid, {type: 'get_commands'})

export const setModel = (sid: string, provider: string, modelId: string) =>
  sendAgentCommand(sid, {type: 'set_model', provider, modelId})

export const setThinkingLevel = (sid: string, level: string) =>
  sendAgentCommand(sid, {type: 'set_thinking_level', level})

export const setTools = (sid: string, toolNames: string[]) =>
  sendAgentCommand(sid, {type: 'set_tools', toolNames})

export const getTools = (sid: string) =>
  sendAgentCommand<ToolEntry[]>(sid, {type: 'get_tools'})

export const cancelQueue = (sid: string, id: string) =>
  sendAgentCommand(sid, {type: 'cancel_queue', id})
```

**类型**:`SlashCommandInfo` / `ToolEntry` 从 `apps/web/lib/types` 复制到 Vue 端(避免跨应用类型依赖)。

### 1.5 T1 commit 边界

```bash
# 单个 commit 收 T1.1-T1.4
git add apps/dashboard/src/views/agent-workbench/{types.ts,composables/,api/}
git commit -F - <<'EOF'
feat(dashboard): extend chat types and SSE events for chrome v1

- types.ts: usage/entryId/prevAssistantEntryId/modelProvider/QueueItem
- useEventStream: 4 new SSE events (message_usage/thinking_level_changed/queue_update/model_changed)
- useAgentSession: 16 new refs (modelNames/modelList/thinkingLevel/...)
- api/agent: 6 command wrappers (getSlashCommands/setModel/...)

Refs proposal § Why; details design § Decision 1-4.
EOF
```

## 2. T2 A 组 落地清单

### 2.1 头部 chrome(MessageView)

新增 props:
- `modelNames: Record<string, string>`(由 ChatWindow 传,来自 useAgentSession.modelNames)

新增计算属性:
- `modelNameLabel`(从 msg.modelProvider + msg.modelId 查 modelNames)
- `formattedTime`(3 段式:今天 / 本年 / 跨年)

模板:
```vue
<header class="wb-message__header">
  <el-tag v-if="role==='user'" type="info" plain size="small">USER</el-tag>
  <el-tag v-else type="primary" plain size="small">{{ modelNameLabel ?? 'assistant' }}</el-tag>
  <time class="wb-message__time">{{ formattedTime }}</time>
</header>
```

### 2.2 token footer

模板(仅 `role==='assistant' && streamStatus==='done' && msg.usage` 渲染):
```vue
<footer v-if="msg.usage && msg.role==='assistant' && msg.streamStatus==='done'"
        class="wb-message__usage">
  {{ msg.usage.input.toLocaleString() }} in · {{ msg.usage.output.toLocaleString() }} out · {{ msg.usage.cacheRead.toLocaleString() }} cache
</footer>
```

### 2.3 操作按钮

新组件子文件:`MessageActionBar.vue`(独立文件 + 独立测试,避免 MessageView 体积爆炸)。

Props: `role: 'user' | 'assistant'`, `entryId?`, `prevAssistantEntryId?`, `content: string`, `isStreaming?`, `isLastAssistant?`, `cancelled?`, `partial?`。
Emits: `copy:[text]`, `edit:[entryId?, content]`, `fork:[entryId]`, `navigate:[entryId, prevId, content]`, `retry:[messageId]`。

```vue
<div class="wb-message__actions" role="toolbar" :aria-label="role==='user' ? 'User message actions' : 'Assistant message actions'">
  <button v-if="role==='user'" aria-label="Copy message" @click="$emit('copy', content)">Copy</button>
  <button v-if="role==='user'" aria-label="Edit message" @click="$emit('edit', entryId, content)">Edit</button>
  <button v-if="role==='user' && entryId" aria-label="Fork from this point" @click="$emit('fork', entryId)">Fork</button>
  <button v-if="role==='user' && prevAssistantEntryId" aria-label="Navigate up" @click="$emit('navigate', entryId, prevAssistantEntryId, content)">↑</button>
  <button v-if="role==='assistant'" aria-label="Copy message" @click="$emit('copy', content)">Copy</button>
  <button v-if="role==='assistant' && !isStreaming" aria-label="Retry this response" @click="$emit('retry', messageId)">Retry</button>
</div>
```

### 2.4 ChatWindow 容器层 emit 处理

`onCopy` 调 `copyText(content)`(新工具函数,`apps/dashboard/src/utils/clipboard.ts`,封装 `navigator.clipboard.writeText` + `execCommand` 兜底)。

`onEdit / onFork / onNavigate` 在阶段 1 仅 `console.log('TODO: ...', ...)`(后续 Track 接入)。

`onRetry(messageId)`:找到该 Assistant 消息前最近一条 user 消息(在 messages 数组里向前扫描),调 `useAgentSession.sendMessage(lastUserContent)`。

## 3. T3 B 组控件 落地清单

### 3.1 toolPresets.ts 映射

```ts
const CORE_TOOLS = ['bash', 'read', 'write', 'edit']  // 4 个核心,具体查 pi SDK
export function getToolNamesForPreset(preset: 'off' | 'default' | 'full', allTools: ToolEntry[]): string[] {
  if (preset === 'off') return []
  if (preset === 'default') return CORE_TOOLS.filter(t => allTools.some(at => at.name === t))
  return allTools.map(t => t.name)
}
```

### 3.2 三个子组件

`ModelSelector.vue` / `ThinkingLevelSelector.vue` / `ToolPresetSelector.vue` 三个组件:

- 用 `el-popover` 包裹做下拉(避免自实现定位)
- props 用 `defineProps<Props>()`(Composition API + 严格类型)
- emits 用 `defineEmits<Emits>()`
- 排序:`Intl.Collator({numeric: true, sensitivity: 'base'})`(ModelSelector)

### 3.3 ChatInput 状态条布局

在 el-input textarea 之**下**、action 行之上,加:

```vue
<footer class="wb-chat-input__statusbar">
  <ModelSelector :model="currentModel" :model-list="modelList" :model-names="modelNames"
                 :is-auto="isAutoModelSelection" @update:model="(p, m) => setModel(p, m)" />
  <ThinkingLevelSelector :level="thinkingLevel" :available-levels="availableLevelsForModel"
                          @update:level="(l) => setThinkingLevel(l)" />
  <ToolPresetSelector :preset="toolPreset"
                       @update:preset="(p) => { setTools(getToolNamesForPreset(p, tools)); refreshTools(); }" />
</footer>
```

streaming 时整个 footer 加 `is-disabled` class(pointer-events: none + opacity: 0.5)。

## 4. T4 B 组队列 落地清单

### 4.1 StreamingQueueBar.vue(新文件)

Props: `items: QueueItem[]`, emits: `recall:[id]`。
模板:
```vue
<ul class="wb-stream-queue" v-if="items.length > 0">
  <li v-for="item in items" :key="item.id" class="wb-stream-queue__item">
    <el-tag :type="item.kind === 'followUp' ? 'primary' : 'info'" size="small">{{ item.kind }}</el-tag>
    <span class="wb-stream-queue__text">{{ previewText(item.text) }}</span>
    <button :aria-label="`Recall queued ${item.kind} message`" @click="$emit('recall', item.id)">×</button>
  </li>
</ul>
```

text 预览:
```ts
function previewText(text: string): string {
  if (!text) return '(image attached)'
  return text.length > 60 ? text.slice(0, 60) + '...' : text
}
```

### 4.2 ChatInput 集成

在 attachments 列表之上、textarea 之下加 `<slot name="queue" />`,由父级 ChatWindow 注入 `<StreamingQueueBar :items="queueItems" @recall="cancelQueue" />`。

`queueItems` = `computed(() => [...queuedMessages.followUp, ...queuedMessages.steer])`(followUp 在前,steer 在后,符合 React 视觉)。

## 5. T5 B 组 slash 落地清单

### 5.1 内置命令(`apps/dashboard/src/views/agent-workbench/slash/builtin.ts`)

```ts
import type { SlashCommandPaletteItem } from '../types'  // 新增类型
export const BUILTIN_SLASH_COMMANDS: SlashCommandPaletteItem[] = [
  { name: '/compact', aliases: ['/压缩'], description: '压缩上下文', source: 'builtin' },
  { name: '/branch', aliases: [], description: '分叉当前 assistant 消息', source: 'builtin' },
  { name: '/model', aliases: [], description: '切换模型', source: 'builtin' },
  { name: '/fork', aliases: [], description: '分叉当前 entry', source: 'builtin' },
]
```

### 5.2 SlashPalette.vue(新文件)

Props: `query: string`, `items: SlashCommandPaletteItem[]`。
Emits: `select:[item]`, `close`。

模糊匹配算法(3 档):
1. 精确前缀:`item.name.startsWith(query)` 或 item.aliases 中任一
2. 包含:`item.name.includes(query)` 或 aliases.includes
3. 字符级子序列:query 字符按顺序在 item.name 中出现

模板:
```vue
<ul v-if="visibleItems.length > 0" role="listbox" class="wb-slash-palette" :aria-activedescendant="`slash-item-${activeIndex}`">
  <li v-for="(item, i) in visibleItems" :key="item.name" :id="`slash-item-${i}`"
      role="option" :aria-selected="i === activeIndex"
      :class="['wb-slash-palette__item', { 'is-active': i === activeIndex }]"
      @click="$emit('select', item)">
    <span class="wb-slash-palette__name">{{ item.name }}</span>
    <span class="wb-slash-palette__desc">{{ item.description }}</span>
  </li>
</ul>
```

### 5.3 ChatInput 集成

`isSlashPaletteOpen` = `inputText.startsWith('/') && inputText.length > 1`。
面板用 `el-popover` 或绝对定位(input 下方,top: 100%)。
键盘事件:onKeydown 里 `if (isSlashPaletteOpen.value) { ... }`。

## 6. T6 IME + 可访问性 落地清单

### 6.1 IME 保护

```ts
const isComposing = ref(false)
function onCompositionStart() { isComposing.value = true }
function onCompositionEnd() { isComposing.value = false }
function onKeydown(e: KeyboardEvent) {
  if (isComposing.value) return  // ← 关键:IME 未完成放行浏览器默认行为
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    void handleSend()
  }
}
```

el-input 模板: `@compositionstart="onCompositionStart" @compositionend="onCompositionEnd"`。

### 6.2 可访问性扫描

- 所有新按钮加 `aria-label`
- slash palette 用 `role="listbox"` + `aria-activedescendant`
- MessageView 操作按钮区 `role="toolbar"`
- 操作按钮 hover 区域键盘可达(`tabindex="0"`,Vue 组件默认 button 自带)

## 7. T7 测试策略 详细

### 7.1 单元测试

| 文件 | 增量 | 关键用例 |
|---|---|---|
| `useAgentSession.test.ts` | +3 | "modelNames ref 暴露" / "setModel 乐观+回滚" / "loadSlashCommands 调 get_commands" |
| `MessageView.test.ts`(新增) | +14 | 6 头部 chrome + 3 token footer + 5 操作按钮 |
| `ChatInput.test.ts` | +12 | 3 model + 3 thinking + 3 preset + 3 queue + 4 slash + 1 IME(归并) |
| `toolPresets.test.ts`(新增) | +3 | off 返回 [] / default 4 个核心 / full 全部 |

### 7.2 集成测试(浏览器手动)

T7.4 列出 7 个具体场景,用户在 dev server 跑。

### 7.3 不可触及线(再次强调)

- 128 既有测试全绿
- dashboard build + web build 不破
- 不引入 npm 包

## 8. 8 个 commit 边界(汇总)

```
1. feat(dashboard): extend chat types and SSE events for chrome v1  (T1.1-1.4)
2. feat(dashboard): message header chrome + token footer + action buttons (v1)  (T2.1-2.4)
3. feat(dashboard): chat composer status bar (model + thinking + tool preset)  (T3.1-3.5)
4. feat(dashboard): streaming-time queue bar (steer/followUp + recall)  (T4.1-4.4)
5. feat(dashboard): slash command palette with builtin + session commands  (T5.1-5.3)
6. fix(dashboard): IME composition guard + a11y polish for chat input  (T6.1-6.2)
7. test(dashboard): chat chrome v1 full coverage  (T7.1-7.3)
8. docs(change): archive agent-workbench-chat-ui-clone-v1  (T8.1-8.3)
```

## 9. Worktree 工作流

按用户决策,使用 `superpowers:using-git-worktrees` 创建独立 worktree:

```bash
git worktree add ../agent-workbench-chat-ui-clone-v1 -b feat/agent-workbench-chat-ui-clone-v1
cd ../agent-workbench-chat-ui-clone-v1
# 在此 worktree 完成 T1-T7
# 测试绿后:
git push origin feat/agent-workbench-chat-ui-clone-v1
gh pr create --base main --head feat/agent-workbench-chat-ui-clone-v1
```

worktree 与 main 共享同一个 dev server / node_modules(节省重启时间),`pnpm --filter` 自动识别。

## 10. Risk Matrix(继承 OpenSpec design.md § 风险 + 实施粒度)

| 风险 | 实施时表现 | 检测方法 |
|---|---|---|
| OQ-1 后端 SSE 没推 `message_usage` | T2.2 footer 永远不显示 | vitest + 浏览器实测 |
| OQ-2 `cancel_queue` 后端无 type | T4 recall 降级为本地 + warning | curl 测端点 |
| OQ-3 `get_commands` schema 差异 | T5 palette 显示空或不显示 | 浏览器 devtools 看响应 |
| OQ-4 tool preset 切中断流 | T3.5 streaming 时禁用整个 footer | 浏览器实测 |
| useAgentSession ref 膨胀导致循环依赖 | watch 链死循环 | vitest + console 监控 |

任一 OQ 答"否" → 走 Spec Patch 流程,不强行上残缺能力。
