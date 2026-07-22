## Context

Dashboard 当前在 `ChatWindow.vue` 里用 `v-for messages` 顺序平铺 `<MessageView :message="msg">`。多步 agent 流程中,连续的 assistant 消息(包含 thinking + toolCall + result)整段顺序渲染,文本流挤在一块,用户难以快速定位最终回复。`apps/web` 的 React `ChatWindow.tsx` 在 v-for render 之前用 `findFinalAssistantIndex` + `hasDisplayableAssistantBlocks` 识别 candidate 折叠组并用 `<ProcessDetailsGroup>` 包裹中间步骤,本 change 镜像该行为到 Vue 端。

`assistant-message-blockview` change(已 ship 16 commits)在 `MessageView.vue` 已支持 `AssistantContentBlock[]` 渲染 + chrome / BlockView — 本 change **复用** 既有 MessageView,不在这里改 message rendering。

## Goals / Non-Goals

**Goals:**

- 在 `ChatWindow.vue` 渲染层根据 trigger 条件(组长度 ≥ 3 且至少 1 个 displayable assistant)折叠中间步骤为 `<ProcessDetailsGroup>`。
- 最终 reply 与 `<MessageView>` 渲染路径不变,带完整 chrome。
- 计数 header 准确(消息数 + toolCall block 数)。
- 默认折叠,点击展开/收起。
- 新组件 `ProcessDetailsGroup.vue` 纯容器,不重新实现 message 渲染。

**Non-Goals:**

- 不实现 message-level 渲染逻辑(BlockView-tree-rendering 已 ship,本 change 不动 MessageView 内部)。
- 不在折叠组内嵌套折叠组(单层折叠)。
- 不实现服务端 SSE 事件折叠或后端分组(纯前端展示层)。
- 不引入新依赖或设计 tokens。

## Decisions

### Decision 1: 算法层放在 ChatWindow.vue 而非独立 composable

**选择**:在 `ChatWindow.vue` 的 `<script setup>` 内新增 `processGroups` computed,把 `AgentMessage[]` 折叠成 `(type: 'flat' | 'group', messages[])[]` 的序列;模板用 `v-for` 路由 type。

**对比**:
- (A) 内联在 ChatWindow.vue:简单,但跨组件复用困难 **采用 A**(本次不需复用)。
- (B) 抽到 `composables/useProcessGroups.ts`:更可测试,但增加间接性。

**理由**:单点使用,内联足够;后续若多个 message-list 容器复用再抽出。

### Decision 2: 折叠算法镜像 apps/web

**选择**:`processGroups` 算法直接镜像 `apps/web/components/ChatWindow.tsx` 的 `findFinalAssistantIndex` / `hasDisplayableAssistantBlocks` 两条 helper 的逻辑:

```ts
function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  // mirror apps/web:hasFinalAssistantAnswer
  // role === 'assistant' AND
  // (text content.trim() > 0 OR content has block.type !== 'thinking')
}

function isEmptyThinkingBlock(message: AgentMessage): boolean {
  // mirror apps/web:isEmptyThinkingBlock
  // role !== 'assistant' OR content is empty OR only thinking blocks
}
```

`processGroups` 输出形如:
```ts
type RenderItem =
  | { type: 'message'; message: AgentMessage; inProcessDetails: boolean }
  | { type: 'group'; messages: AgentMessage[]; defaultOpen: boolean }

const renderItems = computed<RenderItem[]>(() => {
  // scan messages, when finding a 'user' followed by ≥2 assistants with ≥1 displayable,
  // collect intermediate assistants into a 'group'; the final assistant becomes 'message' (inProcessDetails: false)
})
```

**对比**:对齐 apps/web(逻辑一致) vs 自定义算法。**采用对齐**。

### Decision 3: 用 `<slot />` 而非 props 传 messages

**选择**:`ProcessDetailsGroup` 不接收 children messages array,只接收计数 prop + 用 `<slot>` 渲染 children。Children 是 ChatWindow 模板里的 `<MessageView>` 实例。

**理由**:避免重复传入;保持 ProcessDetailsGroup 纯容器职责(决策点 1)。

### Decision 4: 默认折叠

**选择**:`defaultOpen: false`,只有 `defaultOpen` prop 显式 true 才展开。

**理由**:与 apps/web 一致(默认折叠);用户需要主动展开看 toolCall 中间过程,符合 spec 中 "N messages · M tool calls" 暗示"可折叠"语义。

### Decision 5: 计数在 props 内做

**选择**:`ProcessDetailsGroup` 接收 `messages: readonly AgentMessage[]` prop,内部 `computed` 自计 N / M,不依赖父级传入。

**理由**:组件自包含,父级不需重复算。

### Decision 6: chevron 旋转通过 CSS transform(不用 :class toggle)

**选择**:用 inline-style `transform: rotate(90deg)` 切换,不用 `:class="{ 'is-open': ... }"` + CSS 静态 class。

**理由**:更直观;节省额外 SCSS 块。

### Decision 7: chevron icon 复用 element-plus `CaretRight` (apps/web 用 `<svg>` 内联)

**对比**:
- (A) 用 element-plus `CaretRight` icon: 一致风格(已有 CaretBottom 在 ChatInput footer)。**采用 A**。
- (B) 内联 svg 镜像 apps/web:无依赖,但样式与 dashboard 其它 chevron 不一致。

## Risks / Trade-offs

**[R1] 嵌套折叠组冲突** → 单一层折叠。Algorithm 输出严格 `[flat|group]` 序列(无 group-of-group 嵌套)。如果未来多级折叠,需要重写 algorithm。Mitigation:本 iteration 不开多级;OpenSpec spec 加未来 ticket 时再展开。

**[R2] 计数 countToolCalls 与 apps/web 不完全一致** → Vue 端的 `countToolCalls` 实现纯本地函数,与 apps/web 的 `countToolCallBlocks` 字段对齐 (mirror 契约)。Mitigation: 复用 `BlockView` 已 mirror 的 `AssistantContentBlock[]` 字段访问;计数总是 toolCall block 累加,与 `BlockView.test.ts` 中 mirror 形态一致。

**[R3] 默认折叠破坏 streaming 体验** → streaming 期间的 assistant message 实时累加,默认折叠意味着用户看不到 streaming dots。Mitigation: ProcessDetailsGroup 只 wrap "上一条 user 之后到 final reply 之间"的 assistant 区间;streaming 阶段(消息未 done)时该消息不被纳入 group(由 `isEmptyThinkingBlock` / streaming-status 决定);只有 streamStatus === 'done' 的中间步骤才进 group。详见实现期 derive 算法。

**[R4] processGroups 在 messages 高频追加时反复重算** → Vue computed 自动 memo,只依赖 messages.value;无显式 cache。大型 session(100+ 消息)性能无忧,因为每次 v-for 重渲是已知开销。

**[R5] archives 时 process-details baseline spec 不存在** → 本 change 是全新 capability,无 baseline supersede;`opsx:archive blockview-process-details` 时 `assistant-message-process-details` spec 直接上提为 dashboard 新基线 capability(与 `assistant-message-blockview` 同处理)。

## Migration Plan

无后端 schema 迁移;无环境变量变更。部署仅需:

1. (本会话) `openspec/changes/blockview-process-details/` 三件套 proposal / spec / design / tasks,跑 `openspec validate`。
2. (实现期) subagent-driven-development 按 tasks 顺序:先 ProcessDetailsGroup 单组件 + 测试,再 ChatWindow 修改 + 测试。
3. (verify) dev 环境手动验证:登录 → 跑一个 bash 调用的多步 agent → 看到中间步骤进 ProcessDetailsGroup,点击展开。
4. (archive) `opsx:archive` 后:spec 上提到 `openspec/specs/assistant-message-process-details/`。

## Open Questions

1. **ProcessDetailsGroup 内部是否需要"展开时只读视图"标记**:docs 类消息在 ProcessDetailsGroup 里展开后,默认以 chrome + BlockView 渲染。可读性 OK,但"展开"按钮是否需要 disable(例如流未结束时禁用展开)。本 iteration 不开,后续观察。
2. **计数 'tool calls' 文案单复数**:`1 tool call` vs `2 tool calls`(英文单复数);中文直接 `N 个工具调用`。Vue 端用中文。
3. **defaultOpen 是否要"始终展开" / "始终折叠" 全局开关**:参考 apps/web 只有 per-group defaultOpen;本 iteration 不引入全局设置,遵循 React 端默认。
