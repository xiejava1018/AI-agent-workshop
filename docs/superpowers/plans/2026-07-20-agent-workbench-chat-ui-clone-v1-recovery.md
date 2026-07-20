---
change: agent-workbench-chat-ui-clone-v1
design-doc: docs/superpowers/specs/2026-07-20-agent-workbench-chat-ui-clone-v1-design.md
base-ref: 081c98b415d97826eacebfa87cbeade30c300d28
---

# Agent 工作台聊天窗口 · 阶段 1 复刻 —— 恢复实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (build_mode 已设置) 实施本计划 task-by-task。每个 task 通过 reviewer 后由协调者定向勾选 `openspec/changes/agent-workbench-chat-ui-clone-v1/tasks.md`。
> Language: zh-CN。`review_mode: standard`,`tdd_mode: direct`(直接实施,但仍需补回归测试),`build_mode: subagent-driven-development`。

**Goal:** 在 `feat/agent-workbench-chat-ui-clone-v1` 分支上,把已偏离 OpenSpec 事实的 `tasks.md` 校正回来,并补齐剩余能力(slash palette + IME guard + 文档),让 8 项聊天窗口 chrome v1 增量能力真正落地、可验证、可归档。

**Architecture:** 沿用现有 Vue3 + Element Plus 单组件隔离策略。slash palette 走独立 `SlashPalette.vue` + `slash/builtin.ts`;IME guard 直接在 `ChatInput.vue` 加 composition state machine;a11y 统一扫描新增控件;T1.2 缺漏的 `message_usage` case 在 useEventStream 内补齐。docs 增量落到 `apps/dashboard/CLAUDE.md` 已知陷阱段。

**Tech Stack:** Vue 3.4 + Composition API(`<script setup lang="ts">`)、TypeScript strict、Element Plus、`@vue/test-utils` + Vitest。

---

## 0. 事实基线(已通过代码核对,不再二次验证)

| 来源 | 状态 | 证据 |
|---|---|---|
| 工作分支 | `feat/agent-workbench-chat-ui-clone-v1`,worktree `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1` | `git status` / `git log` |
| Base ref | `081c98b415d97826eacebfa87cbeade30c300d28` | `.comet.yaml:13` |
| 已落地提交 | 5 个 commit(T1-T4 + 后续消息布局修复) | `git log 081c98b..HEAD` |
| `tasks.md` | **所有 task 错勾 `[x]`**,与代码事实不符 | 直接 Read 确认 |
| T1.1 types.ts | 已含 `usage/entryId/prevAssistantEntryId/modelProvider/modelId/QueueItem/SlashCommandInfo/ToolEntry/ThinkingLevel` | `types.ts:54-330` |
| T1.2 SSE 白名单 | **部分缺失**:`message_usage` 未在 `ALLOWED_SSE_EVENTS` 与 `handleEvent` 中实现 case,只补了 `queue_update/thinking_level_changed/model_changed` | `useEventStream.ts:111-135`、handleEvent switch 缺 message_usage 分支 |
| T1.3 useAgentSession | 已暴露 16+ ref + 7 method wrapper | `useAgentSession.ts` |
| T1.4 api/agent | 6 个包装方法(`getSlashCommands/setModel/setThinkingLevel/setTools/getTools/cancelQueue`) | `api/agent.ts:157-` |
| T2 头部 chrome + token footer + 操作按钮 | MessageView.vue + MessageActionBar.vue + ChatWindow.vue 容器层 | 提交 `f9c4132` |
| T3 状态条(ModelSelector/ThinkingLevelSelector/ToolPresetSelector) | 三个子组件 + ChatInput 集成 | 提交 `5a5469f` |
| T4 StreamingQueueBar | 子组件 + ChatInput slot + `sendSteer/sendFollowUp/cancelQueue` 实现 | 提交 `081f64f` |
| T5 slash palette | **完全缺失**:`apps/dashboard/src/views/agent-workbench/slash/` 目录不存在,ChatInput 无 palette 集成 | grep 验证 |
| T6 IME guard + a11y | **完全缺失**:ChatInput.vue 无任何 `compositionstart/end/isComposing` 引用 | grep 验证 |
| T7 测试覆盖 | **未达成 140/140**:T5/T6 测试缺;`message_usage` 单元测试缺 | 测试计数见下 |
| T8 CLAUDE.md 增量 + Comet 归档 | **未做**:`apps/dashboard/CLAUDE.md` 无 T8 描述的 chrome v1 陷阱段 | Read 确认 |

**现存测试计数(describe/it 块数)**:

| 文件 | describe/it 块 | 设计期望(增量) |
|---|---|---|
| `ChatInput.test.ts` | 39 | +12 T5/T6 → 51 |
| `MessageView.test.ts` | 35 | 持平(T2 已实施) |
| `StreamingQueueBar.test.ts` | 17 | 持平(T4 已实施) |
| `useAgentSession.test.ts` | 14 | +3 → 17 |
| `useEventStream.test.ts` | 24 | +1 message_usage → 25 |
| `toolPresets.test.ts` | **不存在** | +3 |

**重要约束(来自 .comet.yaml + 用户指示)**:

- `tdd_mode: direct` → 允许直接写实现,但每个 task 仍必须补 1-N 条 vitest 回归测试(覆盖正常路径 + 至少 1 条边缘)。
- `review_mode: standard` → 每个 task 完成后,协调者(本会话)运行 `superpowers:code-reviewer` 或人工核对清单,再勾选 `tasks.md`。
- `build_mode: subagent-driven-development` → 实施时由协调者 dispatch 实施 subagent,本计划已按"可由独立 subagent 实施"粒度拆分。
- 不得修改 OpenSpec artifacts、`.comet.yaml`、`apps/web`、T1-T4 既有代码(除非是补 T1.2 message_usage 这种"实现错漏")。
- 计划文件只允许创建一个,保存到主工作区(非隔离 worktree)。

---

## 1. 任务依赖图

```
T0(校正勾选) → 串行:
   ↓
T1.2 补(message_usage case)  ┐
                              ├→ T5(slash palette 3 子任务) → T6(IME + a11y) → T7(测试/build 验证) → T8(CLAUDE.md + 归档)
T2/T3/T4 已完成,跳过          ┘
```

T1.2 补漏必须先于 T7(否则 `message_usage` 单元测试无法写)。

---

## 2. 实施任务清单

### 任务 0: 校正 OpenSpec `tasks.md` 勾选状态(预热)

**Files:**
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/openspec/changes/agent-workbench-chat-ui-clone-v1/tasks.md`

**为什么:** 当前所有 task 都被错误勾为 `[x]`,与代码事实不符。恢复计划必须先把状态"归零",后续 task 通过 reviewer 后再勾回。**不得删除任何 task 文字,只调整 `- [x]` ↔ `- [ ]` 与必要的小注释。**

**步骤:**

1. 把 T0.1/T0.2/T0.3、T1.1-T1.4、T2.1-T2.5、T3.1-T3.6、T4.1-T4.5 全部**保留** `[x]`(这些是事实已完成的)。
2. 把 T1.2 内的 `message_usage` 子项**新增**一条 `- [ ] T1.2b` 占位描述(放在 `T1.2` 之后),写明"补 message_usage 事件白名单与 case handler"。
3. 把 T5.1/T5.2/T5.3/T5.4、T6.1/T6.2/T6.3、T7.1-T7.5、T8.1/T8.2/T8.3 全部**改回** `- [ ]`(代码缺失)。
4. 在 T0 段加一行事实注释:

```markdown
> **2026-07-20 恢复标记:** T5/T6/T7/T8 因 chat-ui-clone-v1 worktree 中实际代码缺失而改回未勾选;
> T1.2 补 message_usage 子项为恢复期新增任务。详见 docs/superpowers/plans/2026-07-20-agent-workbench-chat-ui-clone-v1-recovery.md。
```

**验收命令:**

```bash
cd /Users/xiejava/AIproject/AI-agent-workshop
# 校验:T5/T6/T7/T8 必为未勾选
grep -E "^- \[ \] T(5|6|7|8)" openspec/changes/agent-workbench-chat-ui-clone-v1/tasks.md | wc -l
# 期望输出:>= 13(T5.1-T5.4 + T6.1-T6.3 + T7.1-T7.5 + T8.1-T8.3 = 4+3+5+3 = 15,允许新加 T1.2b 占位 + 注解行后实际略多)
```

**提交边界:** 不单独 commit;`tasks.md` 由协调者在每次 task 通过 reviewer 时定向勾选(参照用户指示的"恢复/校正错误勾选")。**本任务在协调者层手工 Edit,不动 git。**

---

### 任务 1.2b: 补 `message_usage` SSE 事件白名单与 case handler

**Files:**
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/composables/useEventStream.ts`
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/types.ts`
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/composables/useEventStream.test.ts`

**为什么:** design § 1.2 与 OpenSpec tasks T1.2 要求 4 类事件(`message_usage`/`thinking_level_changed`/`queue_update`/`model_changed`)。代码现状已补 3 类,缺 `message_usage`。该事件携带 `{ input, output, cacheRead, cacheWrite, cost? }`,需写入 rawMessages 中最后一条 assistant 消息的 `usage` 字段,是 T2.2 token footer 渲染的依据。

**步骤:**

1. **先写失败测试**(`useEventStream.test.ts` 内追加 describe):

```ts
describe('message_usage 事件', () => {
  it('写入 rawMessages 最后一条 assistant 消息的 usage', async () => {
    const { useEventStream } = await import('./useEventStream')
    // ... 构造 rawMessages 内含 assistant 消息 + 触发 message_usage 事件
    // 断言:最后一条 assistant message.usage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }
  })

  it('payload 缺 input/output 字段时 console.warn 后丢弃,不破坏 rawMessages', async () => {
    // ... 触发 { type: 'message_usage' } 不带 payload
    // 断言:rawMessages 不变,console.warn 被调用
  })
})
```

2. **运行测试,确认失败:**

```bash
cd /Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1
pnpm exec vitest run apps/dashboard/src/views/agent-workbench/composables/useEventStream.test.ts -t "message_usage"
# Expected: FAIL (case 不存在)
```

3. **在 `useEventStream.ts` 内:**
   - `ALLOWED_SSE_EVENTS` 数组(行 111 附近)添加 `'message_usage'` 常量。
   - `SSEEventPayload` 联合类型(`types.ts` 内)添加 `| { type: 'message_usage'; input: number; output: number; cacheRead: number; cacheWrite: number; cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } }`。
   - `handleEvent` switch 中,在 `case 'queue_update':` 之前添加 `case 'message_usage':` 分支:找到 `rawMessages` 内最后一条 `role === 'assistant'` 的消息,把 payload 写入其 `usage` 字段;若找不到,`console.warn` 后丢弃。
   - 字段类型不匹配时 `console.warn` 后丢弃(参照 § 1.2 安全点)。

4. **运行测试,确认通过:**

```bash
pnpm exec vitest run apps/dashboard/src/views/agent-workbench/composables/useEventStream.test.ts -t "message_usage"
# Expected: PASS
```

5. **回归全量测试:**

```bash
pnpm exec vitest run
# Expected: 全部通过(原本 128 + useEventStream 新增 2 条,后续任务继续累加)
```

6. **协调者定向勾选 tasks.md T1.2b 行(`- [ ]` → `- [x]`)**,然后 commit:

```bash
git add apps/dashboard/src/views/agent-workbench/composables/useEventStream.ts \
        apps/dashboard/src/views/agent-workbench/composables/useEventStream.test.ts \
        apps/dashboard/src/views/agent-workbench/types.ts
git commit -m "fix(dashboard): wire message_usage SSE event into last assistant message"
```

**回归测试:** 至少 2 条(正常路径 + 缺字段降级)。`tdd_mode: direct` 允许直接实现,但本任务仍按 red→green 走。

---

### 任务 2: 实施 T5 slash palette(3 个子任务)

**Files:**
- Create: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/slash/builtin.ts`
- Create: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/components/SlashPalette.vue`
- Create: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/components/SlashPalette.test.ts`
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/components/ChatInput.vue`
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/components/ChatInput.test.ts`
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/types.ts`

---

#### 任务 2.1: 内置命令清单 + 类型扩展

**为什么先做:** SlashPalette.vue 与 ChatInput 集成都需要 `SlashCommandPaletteItem` 类型,builtin.ts 是数据源。

**步骤:**

1. **先扩 types.ts:** 在 `SlashCommandInfo` 之后新增 `SlashCommandPaletteItem` interface:

```ts
export interface SlashCommandPaletteItem {
  name: string
  aliases: string[]
  description: string
  source: 'builtin' | 'extension' | 'prompt' | 'skill'
}
```

2. **创建 `slash/builtin.ts`:**

```ts
import type { SlashCommandPaletteItem } from '../types'

export const BUILTIN_SLASH_COMMANDS: SlashCommandPaletteItem[] = [
  { name: '/compact', aliases: ['/压缩'], description: '压缩上下文', source: 'builtin' },
  { name: '/branch', aliases: [], description: '分叉当前 assistant 消息', source: 'builtin' },
  { name: '/model',  aliases: [], description: '切换模型', source: 'builtin' },
  { name: '/fork',   aliases: [], description: '分叉当前 entry', source: 'builtin' }
]
```

3. **验收:**

```bash
cd /Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1
pnpm exec vitest run apps/dashboard/src/views/agent-workbench/components/SlashPalette.test.ts 2>&1 | head -5
# 期望:S test files?先确保 import 不报错
pnpm exec tsc --noEmit -p apps/dashboard 2>&1 | head -10
# 期望:无类型错误
```

**提交边界:** 合并到任务 2.3 commit(不单独 commit,避免中间状态)。

---

#### 任务 2.2: `SlashPalette.vue` 组件 + 测试

**为什么:** 这是面板本体,需要支持 3 档模糊匹配 + 键盘导航 + a11y(已在 design § 5.2 详述)。

**步骤:**

1. **先写失败测试**(`SlashPalette.test.ts`,4 条):

```ts
describe('SlashPalette', () => {
  it('query="/com" 时 /compact 排在第一', () => {
    // props.query="/com",props.items=BUILTIN_SLASH_COMMANDS
    // 断言:visibleItems[0].name === '/compact'
  })

  it('query="/comp" 走精确前缀匹配', () => {
    // 断言:visibleItems.length === 1,visibleItems[0].name === '/compact'
  })

  it('query="/" 时显示全部 4 条 builtin', () => {
    // 断言:visibleItems.length === 4
  })

  it('键盘 Enter 触发 select 事件,activeIndex 正确', async () => {
    // 模拟键盘 Enter,断言:emit('select', expectedItem) 被调用
  })
})
```

2. **运行测试,确认失败。**

3. **实现 `SlashPalette.vue`**(遵循 design § 5.2):

- Props: `query: string`、`items: SlashCommandPaletteItem[]`、`activeIndex: number`。
- Emits: `select:[item]`、`update:activeIndex:[number]`、`close`。
- 3 档模糊匹配:
  1. 精确前缀:`item.name.startsWith(query)` 或 `item.aliases.some(a => a.startsWith(query))`。
  2. 包含:`item.name.includes(query)` 或 `item.aliases.some(a => a.includes(query))`。
  3. 字符级子序列:query 字符按顺序在 `item.name` 中出现(剔除后只剩空字符串即命中)。
- 模板:`<ul role="listbox" :aria-activedescendant="...">`,每项 `<li role="option" :aria-selected="...">`。
- 样式:绝对定位在 input 下方(`top: 100%`),由父容器 `position: relative`。

4. **运行测试,确认通过:**

```bash
pnpm exec vitest run apps/dashboard/src/views/agent-workbench/components/SlashPalette.test.ts
# Expected: 4 passed
```

5. **类型检查:**

```bash
pnpm exec vue-tsc --noEmit -p apps/dashboard 2>&1 | head -10
# Expected: 无新增错误
```

**提交边界:** 合并到任务 2.3 commit。

---

#### 任务 2.3: ChatInput 集成 + slash palette 集成 + commit

**Files:**
- Modify: `apps/dashboard/src/views/agent-workbench/components/ChatInput.vue`
- Modify: `apps/dashboard/src/views/agent-workbench/components/ChatInput.test.ts`

**步骤:**

1. **先在 `ChatInput.test.ts` 追加 4 条失败测试:**

```ts
describe('slash palette 集成', () => {
  it('inputText="/" 时显示 palette,>1 字符时仍显示', async () => {
    // 触发 inputText="/com"
    // 断言:SlashPalette 组件被渲染
  })

  it('inputText="" 时 palette 隐藏', async () => {
    // 触发 inputText=""
    // 断言:SlashPalette 未渲染或 v-if false
  })

  it('选中 slash 项后 inputText 被填充为 "name " 末尾空格', async () => {
    // 触发 SlashPalette 的 select 事件 { name: '/compact' }
    // 断言:inputText === '/compact '
  })

  it('palette 打开时 Enter 不发送,改为 select 当前项', async () => {
    // 设置 isSlashPaletteOpen=true + SlashPalette activeIndex=0
    // 触发 Enter,断言:未调用 emit('send'),调用了 palette select
  })
})
```

2. **运行测试,确认失败。**

3. **修改 `ChatInput.vue`:**

- `import { BUILTIN_SLASH_COMMANDS } from '../slash/builtin'`
- `import SlashPalette from './SlashPalette.vue'`
- 新增 `slashActiveIndex: ref(0)`。
- `const isSlashPaletteOpen = computed(() => inputText.value.startsWith('/') && inputText.value.length > 1)`。
- 新增 `slashVisibleItems` computed(把 BUILTIN_SLASH_COMMANDS 与 useAgentSession 的 slashCommands 合并,走 3 档匹配)。注意:`loadSlashCommands()` 已在 useAgentSession 暴露,需在 `onMounted` 里调一次。
- 模板:在 el-input **下方**加:

```vue
<SlashPalette
  v-if="isSlashPaletteOpen"
  :query="inputText"
  :items="slashVisibleItems"
  :active-index="slashActiveIndex"
  @select="onSlashSelect"
  @update:active-index="(i) => slashActiveIndex = i"
  @close="isSlashPaletteOpen = false"
/>
```

- 修改 `onKeydown`:在第 1 行添加 `if (isSlashPaletteOpen.value) { /* 拦截键盘交给 palette */ return }`(后续在 T6 任务里改成 `if (isSlashPaletteOpen.value || isComposing.value) return`)。
- `onSlashSelect(item)`: `inputText.value = item.name + ' '` + 关闭 palette。

4. **运行测试,确认通过 + 全量回归:**

```bash
pnpm exec vitest run apps/dashboard/src/views/agent-workbench/components/ChatInput.test.ts
pnpm exec vitest run
# Expected: ChatInput 4 new + 既有 39 = 43 passed
```

5. **协调者定向勾选 `tasks.md` T5.1/T5.2/T5.3/T5.4 → [x]`,然后 commit:**

```bash
git add apps/dashboard/src/views/agent-workbench/slash/builtin.ts \
        apps/dashboard/src/views/agent-workbench/components/SlashPalette.vue \
        apps/dashboard/src/views/agent-workbench/components/SlashPalette.test.ts \
        apps/dashboard/src/views/agent-workbench/components/ChatInput.vue \
        apps/dashboard/src/views/agent-workbench/components/ChatInput.test.ts \
        apps/dashboard/src/views/agent-workbench/types.ts
git commit -m "feat(dashboard): slash command palette with builtin + session commands"
```

**回归测试:** T5 总计 +4(SlashPalette) + 4(ChatInput 集成) = 8 条。

---

### 任务 3: 实施 T6 IME 保护 + a11y 扫描

**Files:**
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/components/ChatInput.vue`
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/components/ChatInput.test.ts`
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/components/MessageActionBar.vue`(a11y 兜底)
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/components/SlashPalette.vue`(a11y 已含)
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/components/StreamingQueueBar.vue`(a11y 已有 aria-label,核对即可)

---

#### 任务 3.1: IME 保护实现

**为什么:** design § 6.1 + OpenSpec T6.1。中文拼音输入法未完成时按 Enter 会把候选字写入,而非确认中文;此时不应触发 `handleSend`。

**步骤:**

1. **先在 `ChatInput.test.ts` 追加 2 条失败测试:**

```ts
describe('IME composition guard', () => {
  it('compositionstart 后按 Enter 不发送,只把 IME 候选写入 inputText', async () => {
    // 模拟:触发 compositionstart,然后 keydown Enter
    // 断言:emit('send') 未调用,但 inputText 内容仍由 IME 决定
  })

  it('compositionend 后按 Enter 正常发送', async () => {
    // 模拟:compositionstart → compositionend → keydown Enter
    // 断言:emit('send', text, []) 被调用一次
  })
})
```

2. **运行测试,确认失败。**

3. **修改 `ChatInput.vue`:**

- 新增 `const isComposing = ref(false)`。
- 新增 `function onCompositionStart(): void { isComposing.value = true }` 与 `onCompositionEnd(): void { isComposing.value = false }`。
- 修改 el-input 模板,绑定:

```vue
<el-input
  v-model="inputText"
  type="textarea"
  :rows="3"
  :placeholder="placeholder"
  :disabled="disabled"
  class="wb-chat-input__textarea"
  @keydown="onKeydown"
  @compositionstart="onCompositionStart"
  @compositionend="onCompositionEnd"
/>
```

- 修改 `onKeydown` 第 1 行:

```ts
function onKeydown(evt: Event | KeyboardEvent): void {
  const e = evt as KeyboardEvent
  // IME 保护:composition 期间放行浏览器默认行为
  if (isComposing.value) return
  // slash palette 打开时把键盘交给 palette
  if (isSlashPaletteOpen.value) return
  // ... 原逻辑
}
```

4. **运行测试,确认通过。**

5. **回归:**

```bash
pnpm exec vitest run apps/dashboard/src/views/agent-workbench/components/ChatInput.test.ts
# Expected: 既有 43 + 2 = 45 passed
```

**提交边界:** 合并到任务 3.3 commit。

---

#### 任务 3.2: a11y 兜底扫描

**为什么:** design § 6.2 + OpenSpec T6.2。slash palette 与 MessageActionBar 已用语义化标签,但仍需做最后扫描,确保 hover 区键盘可达、aria-label 完整。

**步骤:**

1. **Read 核对 MessageActionBar.vue** 当前实现:确认所有 `<button>` 都有 `aria-label`,确认 hover 区有 `tabindex="0"`(原 `<button>` 默认 0,无需额外设置)。若无,补 `aria-label`。
2. **核对 StreamingQueueBar.vue** 当前 aria-label:确认 `aria-label="Recall queued message"` 已存在。
3. **核对 SlashPalette.vue**(任务 2.2 已实现):确认 `role="listbox"` + `aria-activedescendant` + 每项 `role="option"` + `aria-selected` 已正确。
4. **核对 ChatInput.vue**:el-input 内的 textarea 应已有 `aria-label`(由 placeholder 衍生),但若 `<slot name="queue" />` 注入的 StreamingQueueBar 没有 wrapper role,补 `<div role="region" aria-label="Queued messages">`。

5. **写 1 条单元测试**:在 ChatInput.test.ts 加 `it('StreamingQueueBar slot 被包裹在 role="region" 内')`(断言 wrapper div 存在)。

**验收:**

```bash
grep -n "aria-label\|role=" apps/dashboard/src/views/agent-workbench/components/{MessageActionBar,StreamingQueueBar,SlashPalette,ChatInput}.vue
# Expected: 每个交互控件都有 aria-label 或 role
```

---

#### 任务 3.3: 提交 T6

**步骤:**

1. **运行全量回归:**

```bash
cd /Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1
pnpm exec vitest run
# Expected: 140+ passed(原 128 + T1.2b 2 + T5 8 + T6 3 = 141)
```

2. **协调者定向勾选 `tasks.md` T6.1/T6.2/T6.3 → [x]`,然后 commit:**

```bash
git add apps/dashboard/src/views/agent-workbench/components/ChatInput.vue \
        apps/dashboard/src/views/agent-workbench/components/ChatInput.test.ts \
        apps/dashboard/src/views/agent-workbench/components/MessageActionBar.vue
git commit -m "fix(dashboard): IME composition guard + a11y polish for chat input"
```

---

### 任务 4: 实施 T7 全量测试/build/runtime 验证

**Files:**
- Tests: 既有 6 个测试文件,本任务做核对 + 补充 toolPresets 测试。
- Create: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/src/views/agent-workbench/composables/toolPresets.test.ts`

**为什么:** design § 7.1 列出 14 + 12 + 3 等用例目标,且要求 `pnpm exec vitest run` 至少 140/140 pass。本任务做最后核对 + 补 `getToolNamesForPreset` 测试。

**步骤:**

1. **核对 6 个测试文件全绿:**

```bash
cd /Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1
pnpm exec vitest run
# Expected: 141+ passed,0 failed
```

2. **补 `toolPresets.test.ts`**(design § 7.1 要求 3 条;`getToolNamesForPreset` 在 `apps/dashboard/src/api/agent.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { getToolNamesForPreset } from '@/api/agent'
import type { ToolEntry } from '@/views/agent-workbench/types'

const allTools: ToolEntry[] = [
  { name: 'bash' }, { name: 'read' }, { name: 'write' }, { name: 'edit' },
  { name: 'grep' }, { name: 'fetch' }
]

describe('getToolNamesForPreset', () => {
  it('preset="none" 返回 []', () => {
    expect(getToolNamesForPreset('none', allTools)).toEqual([])
  })

  it('preset="default" 返回 4 个核心工具', () => {
    expect(getToolNamesForPreset('default', allTools)).toEqual(['bash', 'read', 'write', 'edit'])
  })

  it('preset="full" 返回 allTools 全部 name', () => {
    expect(getToolNamesForPreset('full', allTools)).toEqual(['bash', 'read', 'write', 'edit', 'grep', 'fetch'])
  })
})
```

> **注意:** `types.ts` 中 `ToolPreset` 已定义为 `'none' | 'default' | 'full'`(而非 design 草稿的 `'off' | 'default' | 'full'`),`api/agent.ts` 中的 `getToolNamesForPreset` 必须使用 `'none'` 才与类型对齐。先 Read `api/agent.ts` 中的实际签名,如果实现已用 `'none'`,直接照写测试;如果实现用 `'off'`,**协调者决定是否调整**(本任务优先核对再写测试,不擅自改实现)。

3. **类型检查 + dashboard build:**

```bash
pnpm exec vue-tsc --noEmit -p apps/dashboard
pnpm --filter @ai-agent-workshop/dashboard build
# Expected: build 成功
```

4. **web build 验证(确保没破后端聚合):**

```bash
pnpm --filter @ai-agent-workshop/web build
# Expected: build 成功
```

5. **浏览器手动验收(用户跑 dev server,协调者代为询问):** design § 7.4 列出 7 个场景,本任务**不阻塞 commit**;协调者跑完步骤 1-4 后,主动询问用户是否已浏览器实测,如未跑则在 commit message 中标注 `[skip-browser-manual]` 留给后续 PR review。

6. **协调者定向勾选 `tasks.md` T7.1/T7.2/T7.3 → [x]`(T7.4 取决于用户实测,标注 `[x]` 前必须确认)。**

7. **commit:**

```bash
git add apps/dashboard/src/views/agent-workbench/composables/toolPresets.test.ts \
        apps/dashboard/src/views/agent-workbench/components/ChatInput.test.ts \
        apps/dashboard/src/views/agent-workbench/components/MessageView.test.ts \
        apps/dashboard/src/views/agent-workbench/components/StreamingQueueBar.test.ts \
        apps/dashboard/src/views/agent-workbench/composables/useAgentSession.test.ts \
        apps/dashboard/src/views/agent-workbench/composables/useEventStream.test.ts
git commit -m "test(dashboard): chat chrome v1 full coverage"
```

**验收命令:**

```bash
pnpm exec vitest run --reporter=verbose 2>&1 | tail -20
# Expected: 144+ passed
pnpm exec vitest run --coverage 2>&1 | grep -E "All files|useAgentSession|SlashPalette|ChatInput" | head -10
# Expected: 覆盖率 >= 既有基线(具体数字记录到 commit body)
```

---

### 任务 5: 实施 T8 CLAUDE.md 增量 + 走 comet-verify 归档

**Files:**
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1/apps/dashboard/CLAUDE.md`
- Modify: `/Users/xiejava/AIproject/AI-agent-workshop/openspec/changes/agent-workbench-chat-ui-clone-v1/tasks.md`(勾选 T8.1)

**为什么:** design § 7 + OpenSpec T8 描述。CLAUDE.md 已知陷阱段必须把 chat chrome v1 的 3 个新增陷阱固化进去,否则后续接手 agent 会再踩。

---

#### 任务 5.1: 更新 `apps/dashboard/CLAUDE.md`

**步骤:**

1. **Read 当前 `apps/dashboard/CLAUDE.md`**(已 Read 过)。
2. **在"已知陷阱"段最后追加 3 条:**

```markdown
- chat chrome v1 头部 chrome 的 `modelNameLabel` 查表 fallback:`MessageView.vue` 内若 `modelNames[provider:modelId]` 查不到,fallback 到 `modelId ?? 'assistant'`。**不要**让 unknown 显示为 'undefined' 或 'null'。
- chat chrome v1 IME 保护:`ChatInput.vue` 必须绑 `@compositionstart/@compositionend` 在 `<el-input>` 上,且 `onKeydown` 第一行 `if (isComposing.value) return`。**不要**只在 textarea 原生 keydown 上判断 IME(el-input 包装层会拦截 native event)。中文拼音 Enter 不发送。
- chat chrome v1 操作按钮 emit 模式:`MessageActionBar.vue` 是 presentational,不调任何 hook/import 不引用 useAgentSession。所有副作用(`onCopy/onEdit/onFork/onNavigate/onRetry`)由 ChatWindow 容器层接 emit 后调 hook。**不要**在 action bar 内联调 `useAgentSession.sendMessage`。
```

3. **协调者定向勾选 `tasks.md` T8.1 → [x]`,commit:**

```bash
git add apps/dashboard/CLAUDE.md openspec/changes/agent-workbench-chat-ui-clone-v1/tasks.md
git commit -m "docs(change): archive agent-workbench-chat-ui-clone-v1"
```

> **注意:** commit message 与 OpenSpec tasks T8.3 一致。OpenSpec 设计里 T8 是 docs(change)类型而非 docs(dashboard),commit message 必须精确匹配 tasks.md 文字。

---

#### 任务 5.2: 走 comet-verify 归档

**步骤:**

1. **由协调者(本会话)运行 `comet-verify` skill**(用户配置决定如何调,通常 `Skill` 工具)。`comet-state scale` 确定验证级别(预计 medium,因为有 UI 变更 + a11y + 8 个 commit 边界)。
2. 跑通 `pnpm exec vitest run`、`pnpm --filter @ai-agent-workshop/dashboard build`、`pnpm --filter @ai-agent-workshop/web build` 三件套,**结果写进 `verification_report`**。
3. 若 verify pass,定向勾选 `tasks.md` T8.2/T8.3 → `[x]`(T8.3 的 commit 已在 5.1 完成,此处仅勾选)。
4. 跑 `comet-archive-change` 或 `openspec-archive-change`(具体由用户当前环境决定)。
5. 若 verify fail:跑 `comet-state transition <name> verify-fail`,回 `phase: build`,回到任务 4 补失败项。

**验收命令:**

```bash
cd /Users/xiejava/AIproject/AI-agent-workshop
cat openspec/changes/agent-workbench-chat-ui-clone-v1/.comet.yaml | grep -E "phase|verify_result|archive"
# Expected:phase: archive 或 verify_result: pass + archived: true
```

---

## 3. 全局验收清单(协调者最后核对)

```bash
cd /Users/xiejava/AIproject/AI-agent-workshop/.worktrees/chat-ui-clone-v1

# 1. git log 6 个 commit + 1 个 fix commit
git log --oneline 081c98b..HEAD
# Expected: 6-7 commits,最后一条 docs(change): archive agent-workbench-chat-ui-clone-v1

# 2. tests 全绿
pnpm exec vitest run
# Expected: 144+ passed

# 3. dashboard build
pnpm --filter @ai-agent-workshop/dashboard build
# Expected: success

# 4. web build
pnpm --filter @ai-agent-workshop/web build
# Expected: success

# 5. OpenSpec tasks 勾选一致
grep -E "^- \[ \]" openspec/changes/agent-workbench-chat-ui-clone-v1/tasks.md | wc -l
# Expected: 0

# 6. CLAUDE.md 含 chrome v1 陷阱段
grep -c "chat chrome v1" apps/dashboard/CLAUDE.md
# Expected: 3

# 7. push + PR(用户授权后)
git push origin feat/agent-workbench-chat-ui-clone-v1
gh pr create --base main --head feat/agent-workbench-chat-ui-clone-v1
```

---

## 4. 风险与回退

| 风险 | 触发条件 | 回退策略 |
|---|---|---|
| OQ-1 后端 SSE 未推 `message_usage` | T1.2b 单元测试通过,但 dev server 实测 token footer 不显示 | 把 footer 渲染条件改为 `msg.usage !== undefined`,已实现,降级优雅 |
| OQ-2 `cancel_queue` 后端 type 不存在 | T4 实施时实测,API 返回 4xx | useAgentSession.cancelQueue 降级为本地移除 + console.warn(已在 design § 1.4 标记) |
| OQ-3 `get_commands` schema 不兼容 | T5 集成时 slash palette 显示为空 | palette 同时展示 builtin + slashCommands;builtin 不依赖后端,降级优雅 |
| OQ-4 tool preset 切换中断 streaming | T7 浏览器实测时观察 | 状态条 streaming 时 `pointer-events: none`,已实施,不会触发 |
| build_mode=subagent-driven 误派发 | 子任务被独立派发后忘了 review_mode 验收 | 每个 task 收尾强制走 `superpowers:code-reviewer` 或协调者逐条核对验收清单 |
| 工具函数 `getToolNamesForPreset` 实现命名差异(`off` vs `none`) | `toolPresets.test.ts` 类型不匹配 | 任务 4 步骤 2 先 Read 实际签名,实现与测试保持一致;若冲突,协调者决定调整 |

---

## 5. 提交边界总览(7-8 个 commit)

```
1. fix(dashboard): wire message_usage SSE event into last assistant message    (T1.2b)
2. feat(dashboard): slash command palette with builtin + session commands      (T5)
3. fix(dashboard): IME composition guard + a11y polish for chat input          (T6)
4. test(dashboard): chat chrome v1 full coverage                              (T7)
5. docs(change): archive agent-workbench-chat-ui-clone-v1                      (T8)
```

**与 base-ref 之间总 commit 数:5(已实施 4 个 + 恢复期 1 个新增 doc) + 4(本计划新增) = 9 个 commit**(注意:T1.2b 是新增 commit,T5/T6/T7/T8.3 各 1 个 commit;T8.1 已在 docs commit 内合并 tasks.md 勾选)。

> 若协调者希望合并 T1.2b 到 T2 既有提交(`f9c4132`),由协调者决定用 fixup rebase(`git rebase -i HEAD~5` → `s` 合并),本计划**不强制**。

---

## 6. 协调者操作守则(本会话独有)

1. **每个 task 完成 → 定向 Edit `tasks.md`**(只改勾选符号或加 1 行 commit hash,不删不改文字)。
2. **每个 task 完成 → 运行 `superpowers:code-reviewer`**(用户授权时)或人工核对验收清单,再 commit。
3. **`build_mode: subagent-driven-development` 已配置**,但本任务量较小(4-5 个 commit),协调者可选择 dispatch 1 个 implementer subagent 跑完 T5-T6-T7,自己执行 T8 文档收尾。
4. **不得修改 `.comet.yaml`、`openspec/changes/.../design.md`、`openspec/changes/.../proposal.md`、`openspec/changes/.../specs/*`**。
5. **不得修改 `apps/web/`**;所有改动限定在 `apps/dashboard/` 与本计划文档。
6. **每个 commit 后必须跑**:`pnpm exec vitest run` → 全绿才能进下一个 task。
7. **T8.2 verify 阶段失败**:跑 `comet-state transition <name> verify-fail` 回 build,修完重跑。

---

**计划结束。协调者确认后,从任务 1.2b 开始 dispatch 实施。**
