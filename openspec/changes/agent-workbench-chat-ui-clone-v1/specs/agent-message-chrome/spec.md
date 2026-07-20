# agent-message-chrome

> 路径 A(Agent 工作台 Vue 端)消息渲染层的视觉与交互增强。
> 覆盖 A1(头部 chrome)+ A2(token footer)+ A3(操作按钮)。
> 依赖:useAgentSession 扩展 modelNames / entryId / prevAssistantEntryId / usage,AgentMessage 类型扩展。

## Purpose

让 `MessageView.vue` 从"v1 简化"(只渲染 Markdown 文本)升级到生产级:
- 每条消息有可识别的头部(角色 + 模型 + 时间)
- Assistant 消息有 token 计数 footer
- 每条消息 hover 时出现 Copy / Edit / Fork / Retry / Navigate Up 按钮

## ADDED Requirements

### Requirement: 消息头部文本标签

The system SHALL render a textual label above the Markdown body of every message identifying its source. User messages SHALL display `[USER]`, Assistant messages SHALL display the current model name (from `modelNames[provider+modelId]`) or `[assistant]` as a fallback. The system SHALL NOT render avatars.

每条消息渲染时,在 Markdown 主体上方显示一个轻量级文本标签,标识消息来源。User 消息显示 `[USER]`,Assistant 消息显示当前模型名(来自 `modelNames[provider+modelId]` 或硬编码 "assistant")。**不画头像**(产品决策)。

#### Scenario: User 消息头部

- **WHEN** 渲染一条 `role === 'user'` 的消息
- **THEN** 在 Markdown 上方显示文本标签 `[USER]`
- **AND** 标签使用 element-plus `el-tag` 的 plain size="small" 风格,背景透明,文字色 `--wb-text-dim`

#### Scenario: Assistant 消息头部(已知模型名)

- **WHEN** 渲染一条 `role === 'assistant'` 的消息,`msg.provider + msg.modelId` 在 `modelNames` 字典里有命中
- **THEN** 在 Markdown 上方显示文本标签 `[MiniMax-M3]`(即 `modelNames[provider+modelId]` 的值)
- **AND** 标签点击不触发任何动作(纯展示)

#### Scenario: Assistant 消息头部(未知模型名)

- **WHEN** 渲染一条 `role === 'assistant'` 的消息,但 `modelNames` 没有命中
- **THEN** 标签降级为 `[assistant]`,不影响渲染

#### Scenario: 头部不影响 Markdown 布局

- **WHEN** 任何消息渲染
- **THEN** 头部标签高度 ≤ 22px,不挤压 Markdown 主体可用空间

### Requirement: 智能时间戳

The system SHALL display a timestamp on the right side of the message header. For messages created today, the system SHALL render `HH:MM` (e.g. `21:55`). For messages earlier this year, the system SHALL render `M月D日` (e.g. `7月19日`). For messages in previous years, the system SHALL render `YYYY年M月D日` (e.g. `2025年12月19日`).

每条消息头部右侧显示时间。**今天**的消息显示 `HH:MM`(如 `21:55`);**非今天**显示 `MMM D, YYYY`(如 `Jul 19, 2026`)。时间来自 `msg.createdAt`(ISO 字符串)。

#### Scenario: 今天的消息

- **WHEN** `new Date(msg.createdAt).toDateString() === new Date().toDateString()`
- **THEN** 时间戳显示 `21:55` 格式(2 位小时:2 位分钟,本地时区)

#### Scenario: 非今天但本年的消息

- **WHEN** `msg.createdAt` 早于今天但同年
- **THEN** 时间戳显示 `7月19日` 格式(月+日,中文本地化)

#### Scenario: 跨年消息

- **WHEN** `msg.createdAt` 早于今天且不同年
- **THEN** 时间戳显示 `2025年12月19日` 格式(年+月+日)

### Requirement: token 计数 footer

When an Assistant message has `streamStatus === 'done'` and `msg.usage` is defined, the system SHALL render a footer below the Markdown body showing `{input} in · {output} out · {cacheRead} cache` with thousands-separator formatting. The system SHALL NOT display the cost field. When `usage` is missing or the message is still streaming, the system SHALL NOT render the footer.

Assistant 消息 `streamStatus === 'done'` 且 `msg.usage` 存在时,在 Markdown 主体下方显示 `{n} in · {n} out · {n} cache` 计数。**不显示 cost**(产品决策)。格式:`6,721 in · 498 out · 128 cache`(千分位逗号)。

#### Scenario: 完成消息有 usage

- **WHEN** 渲染 `role === 'assistant'` 且 `streamStatus === 'done'` 且 `msg.usage = {input:6721, output:498, cacheRead:128}`
- **THEN** footer 显示 `6,721 in · 498 out · 128 cache`
- **AND** 数字千分位逗号格式化(`toLocaleString()`)
- **AND** 字体 size 11px,色 `--wb-text-dim`,与 Markdown 主体间距 6px

#### Scenario: 缺失 usage

- **WHEN** 渲染 `role === 'assistant'` 但 `msg.usage` 缺失(undefined)
- **THEN** footer 不渲染(不留空 div)

#### Scenario: 流式中消息

- **WHEN** `role === 'assistant'` 且 `streamStatus === 'streaming'`
- **THEN** footer 不渲染(等流完成再补)

### Requirement: User 消息操作按钮(hover)

The system SHALL display a hover action group on the top-right of every user message containing: `Copy` (always), `Edit` (always), `Fork` (only when `entryId` is defined), and `Navigate Up` (only when `prevAssistantEntryId` is defined). Clicking `Copy` SHALL copy `msg.content` to the clipboard and briefly show `Copied` for 1.5s. `Edit`, `Fork`, and `Navigate Up` SHALL emit events to the parent; the parent is responsible for the actual action.

User 消息 hover 时,右上角显示一组操作按钮:`Copy` + `Edit` + `Fork`(仅当 `entryId` 存在)+ `Navigate Up`(仅当 `prevAssistantEntryId` 存在)。按钮在非 hover 状态隐藏(占位不可见,但保留空间以避免 hover 跳动)。

#### Scenario: Copy 按钮

- **WHEN** 用户点击 `Copy` 按钮
- **THEN** 调用 `copyText(msg.content)`(复制为纯文本)
- **AND** 按钮文字短暂变为 `Copied` 1.5 秒后恢复
- **AND** 复制失败时按钮文字变为 `Failed`,通过 `ElNotification({type:'warning'})` 提示

#### Scenario: Edit 按钮(emit 透传)

- **WHEN** 用户点击 `Edit` 按钮
- **THEN** emit `edit:[entryId, content]`
- **AND** 父级 ChatWindow 在阶段 1 暂不接真实逻辑,只 `console.log` 透传(后续 Track 接入:把 content 灌回输入框 + 触发重发)

#### Scenario: Fork 按钮(需要 entryId)

- **WHEN** `entryId` 存在且用户点击 `Fork`
- **THEN** emit `fork:[entryId]`
- **AND** 父级在阶段 1 暂不接,只 `console.log`

#### Scenario: Fork 按钮(entryId 缺失)

- **WHEN** `entryId` 缺失(`undefined` / 空字符串)
- **THEN** Fork 按钮不渲染

#### Scenario: Navigate Up 按钮(需要 prevAssistantEntryId)

- **WHEN** `prevAssistantEntryId` 存在且用户点击 `Navigate Up`
- **THEN** emit `navigate:[entryId, prevAssistantEntryId, content]`
- **AND** 父级在阶段 1 暂不接,只 `console.log`

### Requirement: Assistant 消息操作按钮(hover)

The system SHALL display a hover action group on the top-right of every Assistant message containing: `Copy` (always) and `Retry` (only when not currently streaming). Clicking `Retry` SHALL emit an event; the parent is responsible for re-sending the previous user message. `Copy` SHALL copy `msg.content` to the clipboard. The system SHALL NOT display `Edit` or `Fork` on Assistant messages.

Assistant 消息 hover 时显示 `Copy` + `Retry` 按钮。**无 Edit / Fork**(因为 Assistant 消息是 agent 输出,语义上不需要这两个)。

#### Scenario: Copy 按钮(Assistant)

- **WHEN** 用户点击 Assistant 消息的 `Copy` 按钮
- **THEN** 行为与 User Copy 一致(纯文本复制,1.5s `Copied` 反馈)

#### Scenario: Retry 按钮

- **WHEN** 用户点击 Assistant 消息的 `Retry` 按钮
- **THEN** emit `retry:[messageId]`
- **AND** 父级在阶段 1 调用 `useAgentSession.sendMessage(lastUserContent)`(找到该 Assistant 消息前的最后一条 user 消息,重新发送)

#### Scenario: 流式 Assistant 消息无 Retry

- **WHEN** `streamStatus === 'streaming'`
- **THEN** Retry 按钮不渲染(避免中断流)

#### Scenario: cancelled Assistant 消息显示 Retry

- **WHEN** `cancelled === true` 或 `partial === true`
- **THEN** 按钮始终显示(用户可能想重试被打断的回答)

### Requirement: 操作按钮可访问性

The system SHALL provide an `aria-label` on every action button describing the action in natural language (e.g. `aria-label="Copy message"`, `aria-label="Fork this point"`). The action group MUST be keyboard-reachable via Tab and activatable via Enter/Space.

所有按钮必须有 `aria-label` 描述具体动作,例如 `aria-label="Copy message"`、`aria-label="Fork this point"`。

#### Scenario: 屏幕阅读器朗读

- **WHEN** 屏幕阅读器聚焦在 Copy 按钮
- **THEN** 朗读 "Copy message" 而非仅 "Copy"
