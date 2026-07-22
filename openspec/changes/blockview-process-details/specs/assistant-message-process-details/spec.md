# assistant-message-process-details Specification

## Purpose

在 `ChatWindow` 渲染层,识别连续 assistant 消息组,把"中间步骤"折叠为可展开/收起的 `ProcessDetailsGroup`,最后一条 assistant(用户的最终 reply)独立展示,维持原 MessageView 渲染。镜像 `apps/web/components/ChatWindow.tsx` 的行为。

## ADDED Requirements

### Requirement: ProcessDetailsGroup 组件契约

The system SHALL provide a `ProcessDetailsGroup` Vue component in `apps/dashboard/src/views/agent-workbench/components/ProcessDetailsGroup.vue` that:
- Accepts an `messages: readonly AgentMessage[]` prop(折叠组内的 assistant 序列,顺序与原 v-for 一致)
- Accepts an optional `defaultOpen?: boolean` prop(默认 false,即默认折叠)
- Renders a header line showing `Process details · N messages · M tool calls` where:
  - `N` is `messages.length`
  - `M` is `countToolCalls(messages)` — number of assistant messages whose `content` is `AssistantContentBlock[]` containing a block with `block.type === 'toolCall'`
- The header is a clickable button that toggles the open state(default false = 收起)
- The chevron icon rotates 90° when open
- When open, renders the children via a default `<slot />` inside a `<div class="wb-process-details__body">`
- When closed (default), only the header is rendered(no body markup at all)
- The body MUST render MessageView children via the slot — ProcessDetailsGroup itself does NOT inspect or alter message content

`apps/dashboard/.../ProcessDetailsGroup.vue` 只做折叠容器;每条消息的 chrome / chrome / BlockView 渲染由 `MessageView` 自身负责,与 BlockView-tree-rendering change 已 ship 的实现组合使用。

#### Scenario: 默认折叠 - N/M 计数正确,正文不渲染

- **WHEN** `<ProcessDetailsGroup :messages="[m1, m2, m3]" />` 三个 assistant message 渲染(其中 m2.content 含 1 个 toolCall block)
- **THEN** DOM 显示 header `Process details · 3 messages · 1 tool calls`
- **AND** body 不渲染(找不到任何 `<slot>` 或 child MessageView)
- **AND** chevron 朝右(0°)

#### Scenario: 点击展开 - body 出现

- **WHEN** 用户点击 header
- **THEN** chevron 旋转 90°,body 出现,内部 slot 内容渲染
- **AND** 再次点击折回

#### Scenario: 自定义初始状态

- **WHEN** `<ProcessDetailsGroup :messages="..." :default-open="true" />`
- **THEN** 初始即展开状态,chevron 朝下,body 渲染

### Requirement: 连续 assistant 序列识别 — trigger 条件

The system SHALL identify a "process-details group" in `ChatWindow.vue` 渲染逻辑 (`v-for messages`) when ALL of the following hold:
- 序列长度 ≥ 3:从 lastUserIdx + 1 到 endIdx - 1 / 下一条 user 之前的 assistant 区段至少 3 条`(≥2 时只折叠 1 条 step 视觉上无折叠收益,需 ≥3 才有意义;触发严格 ≥3 是为了避免"2 条 step + 1 条 final"被错误分组)`
- 至少 1 条 displayable:序列内至少 1 条 assistant 消息满足 `hasDisplayableAssistantBlocks(msg) === true`,其中 `hasDisplayableAssistantBlocks` 与 `apps/web/lib/message-display.ts:hasDisplayableAssistantBlocks` 同义:
  - `role === 'assistant'` AND
  - `getAssistantText(msg).trim().length > 0` OR `msg.content` 含 ≥ 1 个 `block.type !== 'thinking'` 的 block (即 text/image/toolCall 都算 displayable,纯 thinking 不算)
- 序列以 "next user message 起" 或 "messages 末尾" 结束(即 group 末条之前必须出现 ≥ 1 条 assistant)

When trigger holds, the group MUST be wrapped in `<ProcessDetailsGroup :messages="groupMessages" />`;otherwise all assistant messages in the range render flat via `MessageView` (default non-collapsing behavior).

Reference: `apps/web/components/ChatWindow.tsx` lines 405-440 (`renderMessage`) 与 `findFinalAssistantIndex` / `hasFinalAssistantAnswer`.

#### Scenario: 3 条 assistant + toolCall → 前 2 进 group,1 条 flat

- **WHEN** messages 是 [user"u1", a1(纯 thinking), a2(content 含 1 个 toolCall), a3(纯 text final)]
- **THEN** a1 + a2 包入 ProcessDetailsGroup;header `Process details · 2 messages · 1 tool calls`
- **AND** a3 不在 ProcessDetailsGroup(平铺 MessageView,作为最终回复)
- **AND** 后续 user 直接渲染

#### Scenario: 2 条 assistant + toolCall → 不折叠 (segment < 3)

- **WHEN** messages 是 [user"u1", assistant"a1"(content 含 1 个 toolCall), assistant"a2"(纯 text)]
- **THEN** 两 assistant 全平铺,因 segment.length=2 < 3 触发阈值不满足

#### Scenario: 单条 assistant - 不折叠

- **WHEN** messages 是 [user"u1", assistant"a1"(单条,text)]
- **THEN** a1 不进 ProcessDetailsGroup;直接 MessageView 平铺

#### Scenario: 多条但全 thinking - 不折叠

- **WHEN** messages 是 [user"u1", assistant"a1"(纯 thinking), assistant"a2"(纯 thinking)]
- **THEN** 两 assistant 全 thinking 不满足 hasDisplayable → 不折叠,均按 MessageView 平铺

#### Scenario: 多条 displayable + 后续 user - 折到当前 user (segment ≥ 3)

- **WHEN** messages 是 [user"u1", a1(displayable), a2(displayable), a3(displayable thinking-tail), user"u2", a4(displayable)]
- **THEN** 第一组 [a1, a2, a3] 折叠到 u2 之前
- **AND** a4 不在折叠组(新 user 之后又是新一轮;单条 a4 trigger 不够)

### Requirement: 最终回复独立渲染

The system SHALL NOT include the "最终 assistant reply" within the ProcessDetailsGroup — the LAST assistant message in any [user, assistant_sequence] range is the user's actual reply and MUST render flat via `<MessageView :message="finalAssistant" />`. The process-details group covers only the `assistant` messages BEFORE the final reply (the "intermediate" steps). The final reply uses the same MessageView rendering, with full chrome (header / actions / time).

`<ProcessDetailsGroup>` 的 messages prop 只包含中间步骤。

#### Scenario: 3 条 assistant + 1 条 final reply

- **WHEN** [user"u1", a1(steps), a2(steps), a3(steps + final text)]
- **THEN** ProcessDetailsGroup 含 a1 + a2(header 显示 `Process details · 2 messages · N tool calls`)
- **AND** a3 不在 ProcessDetailsGroup(平铺 MessageView,作为最终回复)

#### Scenario: 仅 1 条 final reply

- **WHEN** [user"u1", a1(纯 final text,无 toolCall)]
- **THEN** 不触发折叠,直接 MessageView

### Requirement: 折叠组错误边界

The system SHALL gracefully degrade when a folded group renders: if any inner `<MessageView>` throws during render, the error MUST propagate to the group container (not to the entire ChatWindow) — Vue's default error propagation is sufficient, no special handling required for this iteration.

(Pass-through to apps/web — no special handling implemented in Vue port.)

#### Scenario: 内部 MessageView 出错不阻塞 ChatWindow

- **WHEN** 折叠组内的某条 MessageView 渲染抛错
- **THEN** 错误冒泡到折叠组的 boundary;其他 message 不受影响
- **AND** ChatWindow 整体仍能滚动渲染后续消息

### Requirement: 计数准确性

The header counts SHALL be accurate for the user-visible group:
- `messages.length` 直接计 `messages` prop 长度(已 unfold 的 assistant 数)
- `toolCalls` 为 `messages` 内 toolCall block 计数(countToolCalls 委托 `displayAssistantBlocks` 路径)

计数在打开/关闭状态之间不变。

#### Scenario: M 计数:toolCall block 数量

- **WHEN** 折叠组 messages: [a1(含 2 个 toolCall blocks), a2(纯 text), a3(含 1 个 toolCall block)]
- **THEN** header 显示 `Process details · 3 messages · 3 tool calls`(sum of toolCall blocks across the 3 messages)

#### Scenario: M 计数:text-only 消息不计入

- **WHEN** 折叠组仅 text 消息
- **THEN** header 显示 `Process details · N messages · 0 tool calls` 或省略工具计数文案(`0 tool calls` 也合法)
