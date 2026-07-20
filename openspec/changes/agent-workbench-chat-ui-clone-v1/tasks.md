# 任务清单:Agent 工作台聊天窗口 · 阶段 1 复刻

> change: `agent-workbench-chat-ui-clone-v1`
> 类型: full workflow
> 日期: 2026-07-20

---

## 0. 前置

> **2026-07-20 恢复标记：** T5/T6/T7/T8.1 因功能 worktree 中实际代码缺失而改回未勾选；另新增 T1.2b 补齐 `message_usage`。详见恢复实施计划。

- [x] T0.1 读 React 参考实现 `apps/web/components/ChatWindow.tsx` + `MessageView.tsx` + `ChatInput.tsx` + `useAgentSession.ts` 确认阶段 1 8 项能力的具体数据契约
- [x] T0.2 跑基线测试:`pnpm exec vitest run` → 128/128 pass
- [x] T0.3 跑基线构建:`pnpm --filter @ai-agent-workshop/dashboard build` ✓ + `pnpm --filter @ai-agent-workshop/web build` ✓

---

## 1. 基础设施(types + SSE + composable 扩展)

> 阶段 1 多个能力共用的底层扩展,放第一桶,所有后续任务都依赖此桶完成。

- [x] T1.1 扩展 `apps/dashboard/src/views/agent-workbench/types.ts`:
  - `AgentMessage.usage?: { input, output, cacheRead, cacheWrite, cost? }`
  - `AgentMessage.entryId?: string`
  - `AgentMessage.prevAssistantEntryId?: string`
  - `AgentMessage.modelProvider?: string` / `modelId?: string`
  - `QueueItem { id, kind: 'steer'|'followUp', text, createdAt }`
- [x] T1.2 扩展 `useEventStream.ts` SSE 事件白名单(从 7 类增到 11 类):
  - `message_usage` → 写入 rawMessages 最后一条 assistant 消息的 usage
  - `thinking_level_changed` → 暂存(useAgentSession 后续从 `/api/sessions/[id]/state` 拉 session metadata)
  - `queue_update` → 暂存到 useAgentSession 的 `queuedMessages`
  - `model_changed` → 暂存
  - 在 `handleEvent` switch 中加 4 个 case
  - 在 `ALLOWED_SSE_EVENTS` 数组中加 4 个常量
- [x] T1.2b 补齐遗漏的 `message_usage` 白名单、handler 与回归测试
- [x] T1.3 扩展 `useAgentSession.ts` ref 集合(从 5 → 30+ ref):
  - `modelNames: Ref<Record<string, string>>`(从 session metadata 推)
  - `modelList: Ref<Array<{provider, modelId, name}>>`(从 `/api/models-config` 拉)
  - `thinkingLevel: Ref<ThinkingLevel>`(8 个 enum)
  - `availableThinkingLevels: Ref<Record<string, string[]>>`(从 session metadata 推)
  - `toolPreset: Ref<'off'|'default'|'full'>`
  - `tools: Ref<ToolEntry[]>`(从 `get_tools` 拉)
  - `queuedMessages: Ref<{steer: QueueItem[]; followUp: QueueItem[]}>`
  - `slashCommands: Ref<SlashCommandInfo[]>`
  - `loadSlashCommands: () => Promise<void>`
  - `setModel(provider, modelId): Promise<void>`
  - `setThinkingLevel(level): Promise<void>`
  - `setTools(toolNames): Promise<void>` + `refreshTools(): Promise<void>`
  - `sendSteer(text, attachments?): Promise<void>` + `sendFollowUp(text, attachments?): Promise<void>`
  - `cancelQueue(id): Promise<void>`
- [x] T1.4 扩展 `apps/dashboard/src/api/agent.ts` 包装方法:
  - `getSlashCommands(sid)` → `get_commands`
  - `setModel(sid, provider, modelId)` → `set_model`
  - `setThinkingLevel(sid, level)` → `set_thinking_level`
  - `setTools(sid, toolNames)` → `set_tools`
  - `getTools(sid)` → `get_tools`
  - `cancelQueue(sid, id)` → `cancel_queue`(后端 type 待 OQ-2 确认)
- [x] T1.5 commit T1:`feat(dashboard): extend chat types and SSE events for chrome v1`

---

## 2. A 组: 消息渲染层(`MessageView.vue` 重写)

> 覆盖 spec `agent-message-chrome` 的全部 Requirement。

- [x] T2.1 `MessageView.vue` 加头部 chrome:
  - 在 Markdown 主体上方加 `<header class="wb-message__header">`
  - User 标签 `<el-tag size="small" type="info" plain>USER</el-tag>`
  - Assistant 标签 `<el-tag size="small" type="primary" plain>{modelName ?? 'assistant'}</el-tag>`
  - 时间戳 `<time class="wb-message__time">{formatTime(msg.createdAt)}</time>`
  - `formatTime` 工具函数(今天 HH:MM / 本年 M月D日 / 跨年 YYYY年M月D日)
  - 新增测试用例 3 条
- [x] T2.2 `MessageView.vue` 加 token footer:
  - 在 Markdown 主体下方,仅当 `role === 'assistant' && streamStatus === 'done' && msg.usage` 时渲染
  - `<footer class="wb-message__usage">` + `{{formatToken(msg.usage.input)}} in · {{formatToken(msg.usage.output)}} out · {{formatToken(msg.usage.cacheRead)}} cache`
  - `formatToken` 工具:`n.toLocaleString()`(千分位逗号)
  - **不展示 cost**(A2-b 决策)
  - 新增测试用例 3 条
- [x] T2.3 `MessageView.vue` 加操作按钮(user + assistant):
  - User 按钮: Copy + Edit + Fork(entryId)+ Navigate Up(prevAssistantEntryId)
  - Assistant 按钮: Copy + Retry
  - 复制用 `navigator.clipboard.writeText()` 兼容降级到 `document.execCommand('copy')`,`copyText` 工具函数放 `apps/dashboard/src/utils/clipboard.ts`(新增)
  - 按钮 hover 显示 + 非 hover 隐藏但保留空间(避免跳动)
  - `aria-label` 完整
  - 新增测试用例 5 条
- [x] T2.4 `ChatWindow.vue` 容器层接 emit:
  - `onCopy(text)` → 已通过 MessageView 内部 ElNotification 处理
  - `onEdit(entryId, content)` → 阶段 1 仅 `console.log`,后续 Track 接入
  - `onFork(entryId)` → 阶段 1 仅 `console.log`
  - `onNavigate(entryId, prevId, content)` → 阶段 1 仅 `console.log`
  - `onRetry(messageId)` → 找到该消息前的最后一条 user 消息,调 `useAgentSession.sendMessage(lastUserContent)`
  - 4 个 emit 占位说明 + TODO 注释指明后续 Track
- [x] T2.5 commit T2:`feat(dashboard): message header chrome + token footer + action buttons (v1)`
  - 总 commit:MessageView 整体 + ChatWindow 容器层
  - 提交前跑 `pnpm exec vitest run` + `pnpm --filter @ai-agent-workshop/dashboard build` 全绿

---

## 3. B 组-控件: Composer 状态条(B4 + B5 + B6)

> 覆盖 spec `chat-composer-controls` 的全部 Requirement。

- [x] T3.1 新增 `apps/dashboard/src/views/agent-workbench/composables/toolPresets.ts`:
  - `getToolNamesForPreset(preset, allTools): string[]`
  - `off → []`,`default → 4 个核心`,`full → allTools`
  - 写测试用例覆盖三档
- [x] T3.2 `ChatInput.vue` 加状态条 UI:
  - 在 actions 行之上加 `<footer class="wb-chat-input__statusbar">`
  - 左: model 标签 + ▾(`ModelSelector` 子组件,新增)
  - 中: thinking 标签 + ▾(`ThinkingLevelSelector` 子组件,新增)
  - 右: tool preset 标签 + ▾(`ToolPresetSelector` 子组件,新增)
  - 三个子组件用 `el-popover` 包裹做下拉(避免自实现定位)
  - streaming 时整个状态条 `pointer-events: none` + `opacity: 0.5`
- [x] T3.3 `ModelSelector.vue`:
  - props: `model: {provider, modelId} | null`,`modelNames: Record<string, string>`,`modelList`,`isAutoModelSelection: boolean`
  - emits: `update:model`
  - 排序用 `Intl.Collator({numeric: true, sensitivity: 'base'})`
  - 选中调 `props.setModel(provider, modelId)`(从父级传)
- [x] T3.4 `ThinkingLevelSelector.vue`:
  - props: `level: ThinkingLevel`,`availableLevels: ThinkingLevel[]`(8 个全集或模型限定子集)
  - emits: `update:level`
  - 选中调 `props.setThinkingLevel(level)`
- [x] T3.5 `ToolPresetSelector.vue`:
  - props: `preset: 'off'|'default'|'full'`
  - emits: `update:preset`
  - 选中调 `props.setTools(getToolNamesForPreset(preset, allTools))` + `props.refreshTools()`
- [x] T3.6 commit T3:`feat(dashboard): chat composer status bar (model + thinking + tool preset)`

---

## 4. B 组-队列: Streaming 期间 Composer 增强(B7)

> 覆盖 spec `chat-streaming-queue` 的 B7 部分。

- [x] T4.1 `ChatInput.vue` 加 `StreamingQueueBar` slot:
  - 在 attachments 列表之上、textarea 之下的位置加 `<slot name="queue" />`
  - 父级 ChatWindow 把 `<StreamingQueueBar>` 注入到该 slot
- [x] T4.2 `StreamingQueueBar.vue`(新增):
  - props: `items: QueueItem[]`
  - emits: `recall:[id]`
  - 每个 item 渲染:`<el-tag :type="kind === 'followUp' ? 'primary' : 'info'" size="small">{kind}</el-tag> {text-preview} <el-button :icon="Close" circle size="small" @click="recall(item.id)" />`
  - text 预览截 60 字符 + `...`,无文本显示 `(image attached)`
  - `aria-label="Recall queued message"`
- [x] T4.3 `useAgentSession.sendSteer` / `sendFollowUp` 实现:
  - 调 `sendAgentCommand(sid, {type: 'steer'|'follow_up', message: text, images: [...]})`
  - 后端会通过 SSE `queue_update` 事件回推完整队列,前端用响应 reconcile
  - 乐观:本地先 push 一个 QueueItem(等 SSE 覆盖)
  - 失败回滚 + warning
- [x] T4.4 `useAgentSession.cancelQueue(id)` 实现:
  - 调 `sendAgentCommand(sid, {type: 'cancel_queue', id})`(OQ-2 确认后端 type)
  - 若后端 type 不存在,降级为本地移除 + warning
- [x] T4.5 commit T4:`feat(dashboard): streaming-time queue bar (steer/followUp + recall)`

---

## 5. B 组-slash: 命令面板(B8)

> 覆盖 spec `chat-streaming-queue` 的 B8 部分。

- [x] T5.1 内置命令清单(`apps/dashboard/src/views/agent-workbench/slash/builtin.ts`):
  - `/compact` — `{name, aliases: ['压缩'], description: '压缩上下文', source: 'builtin'}`
  - `/branch` — `{name, aliases: [], description: '分叉当前 assistant 消息', source: 'builtin'}`
  - `/model` — `{name, aliases: [], description: '切换模型', source: 'builtin'}`
  - `/fork` — `{name, aliases: [], description: '分叉当前 entry', source: 'builtin'}`
  - 导出 `BUILTIN_SLASH_COMMANDS: SlashCommandPaletteItem[]`
- [x] T5.2 `SlashPalette.vue`(新增):
  - props: `query: string`,`items: SlashCommandPaletteItem[]`,`modelNames: Record<string, string>`
  - emits: `select:[item]`,`close`
  - `role="listbox"`,每个项 `role="option" aria-selected`
  - `aria-activedescendant` 跟随 activeIndex
  - 模糊匹配:精确前缀 > 包含 > 字符级子序列
  - 写测试用例 4 条(触发 / 匹配 / 键盘 / 选中)
- [x] T5.3 `ChatInput.vue` 接 slash palette:
  - 监听 `inputText`,`isSlashPaletteOpen = computed(() => inputText.startsWith('/') && inputText.length > 1)`
  - 面板 absolute 定位在 input 下方
  - ↑↓ Enter ESC 事件
  - 选中后:`inputText = item.name + ' '`(末尾空格)+ 关闭面板
- [x] T5.4 commit T5:`feat(dashboard): slash command palette with builtin + session commands`

---

## 6. IME 保护 + 可访问性

- [ ] T6.1 `ChatInput.vue` 加 IME 保护:
  - `isComposing: ref(false)`
  - `onCompositionStart / onCompositionEnd` 绑在 el-input 上
  - `onKeydown` 头一行 `if (isComposing.value) return`(放行 IME 默认行为)
  - 测试用例:中文拼音按 Enter 不发送
- [ ] T6.2 全局可访问性扫描:
  - 所有新按钮加 `aria-label`
  - slash palette 加 `role="listbox"` + `aria-activedescendant`
  - 操作按钮 hover 区域键盘可达(`tabindex`)
- [ ] T6.3 commit T6:`fix(dashboard): IME composition guard + a11y polish for chat input`

---

## 7. 测试 + 验证

- [ ] T7.1 全量测试:`pnpm exec vitest run` → 至少 140/140(原 128 + 新增 ≥12)
- [ ] T7.2 类型检查 + 构建:`pnpm --filter @ai-agent-workshop/dashboard build` ✓
- [ ] T7.3 web build:`pnpm --filter @ai-agent-workshop/web build` ✓
- [ ] T7.4 浏览器手动验收(用户跑 dev server):
  - 打开已有 session → 看到模型名 + 时间戳 + token footer + Copy 按钮
  - 切换 model 下拉 → UI 立即更新 + 后端持久化
  - 切 thinking level → 同上
  - 切 tool preset → 同上
  - Streaming 时输入消息按 Enter → steer 队列行出现
  - 输入 `/com` → 面板弹出 + /compact 排第一
  - 中文输入"ni"按 Enter → 不发送,只把候选字写入
- [ ] T7.5 commit T7:`test(dashboard): chat chrome v1 full coverage`

---

## 8. 文档与收尾

- [ ] T8.1 更新 `apps/dashboard/CLAUDE.md` 已知陷阱段:
  - 头部 chrome 的 modelName 查表 fallback 规则
  - IME 事件绑定的必要性
  - 操作按钮 emit 模式(presentational 不调 hook)

> T8.2（进入 verify）与 T8.3（archive）由 Comet 阶段守卫和归档流程跟踪，不作为 build 阶段 checkbox。

---

## 阶段依赖

```
T0 → T1 → {T2, T3, T4, T5} → T6 → T7 → T8
        ↘    ↘    ↘
         并行可(分 4 个 commit)
```

T2 / T3 / T4 / T5 互相独立,可由 4 个 implementer 并行(若用 subagent-driven-development)。
T6 在 T2-T5 完成后做(统一修 IME + a11y 扫描)。
T7 必须在 T6 之后。

---

## 关键未知项(已在 design § Open Questions 记录)

- **OQ-1** SSE `message_usage` 事件是否真的由后端推?实施 T1.2 时实测
- **OQ-2** `cancel_queue` 后端命令 type 是否存在?实施 T1.4 时实测
- **OQ-3** `get_commands` 响应 schema 与 `SlashCommandInfo[]` 兼容?实施 T1.4 时实测
- **OQ-4** tool preset 切换会中断 streaming?实施 T3.5 时实测

任一 OQ 答"否"则需要开新 change 补后端。
