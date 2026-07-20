# chat-streaming-queue

> 路径 A(Agent 工作台 Vue 端)Streaming 期间 Composer 的增强。
> 覆盖 B7(queued messages 队列 + recall)+ B8(slash 命令面板)。
> 依赖:useAgentSession 扩展 queuedMessages.steer/followUp + slashCommands + recallQueue 方法,SSE 处理加 queued 事件。

## Purpose

当 Assistant 正在流式生成时,允许用户:
- 在不打断流的情况下追加 `steer`(立即插入主线程)或 `follow_up`(等当前回答完再发)
- 用 `/` 前缀调出内置命令(快速 model 切换、压缩上下文、分叉、撤销等)
- 撤回还没发出的队列消息

这两个能力是同一个 streaming-time composability 主题,共享一个组件 `StreamingQueueBar.vue`,挂在 `ChatInput.vue` 顶部的 slot 位置。

## ADDED Requirements

### Requirement: queued messages 显示

When `isStreaming` is `true`, the system SHALL display a queue bar above the composer listing every entry in `queuedMessages.steer` (gray) and `queuedMessages.followUp` (blue). Each entry SHALL show: a kind tag, a text preview truncated to 60 characters, and a recall button. The system MUST optimistically append local items to the queue and reconcile via SSE `queue_update` events. Clicking recall SHALL call `cancelQueue(id)`; on failure, the entry MUST remain. When streaming completes (`streamStatus === 'done'`), the system MUST clear the queue.

Streaming 期间,Composer 上方显示一行或多行队列项。每项左侧带 kind 标签(`steer` 灰色 / `follow-up` 蓝色),右侧文本预览(最多 60 字符,溢出 `...`),最右侧 `×` recall 按钮。

#### Scenario: 发送 steer

- **WHEN** Assistant 正在 streaming,用户在输入框按 Enter
- **AND** `shiftKey` 持有(steer 快捷键约定) **OR** 通过其他方式标记为 steer
- **THEN** 消息立即进入 `queuedMessages.steer` 数组
- **AND** Composer 上方多出一行:`[steer] {text-preview} [×]`
- **AND** 调 `sendAgentCommand(sid, {type: 'steer', message: text})` 立即发往后端

#### Scenario: 发送 follow-up

- **WHEN** 用户按 Cmd+Enter(follow-up 快捷键) **OR** 标记为 follow-up
- **THEN** 消息进入 `queuedMessages.followUp` 数组
- **AND** Composer 上方多出一行:`[follow-up] {text-preview} [×]`
- **AND** 调 `sendAgentCommand(sid, {type: 'follow_up', message: text})` 通知后端排队

#### Scenario: 队列项无文本

- **WHEN** 队列项只有图片(无文本)
- **THEN** text 预览显示 `(image attached)` 而非空

#### Scenario: 队列项 recall

- **WHEN** 用户点击某行 `×` 按钮
- **THEN** 调 `cancelQueue(sid, queuedId)`(后端命令 type 后续 Track 确认;若后端无此 type,暂仅本地移除并 ElNotification "已从队列移除(后端未实现 recall)")
- **AND** 该行从 `queuedMessages.steer` / `followUp` 数组移除(乐观)
- **AND** 失败回滚 + warning

#### Scenario: 流结束后队列项自动消失

- **WHEN** 当前轮 Assistant 流完成(`streamStatus` 变 `done`)
- **THEN** `queuedMessages` 数组清空(sendPromptDone 事件)
- **AND** 队列行从 UI 消失

#### Scenario: 非 streaming 状态无队列行

- **WHEN** `isStreaming === false`
- **THEN** `StreamingQueueBar` 不渲染(不占高度)

### Requirement: slash 命令面板

When `inputText.startsWith('/')` and length > 0, the system SHALL display a palette below the input showing a deduplicated union of: built-in commands (`/compact` / `/branch` / `/model` / `/fork`) and session commands loaded via `loadSlashCommands(sid)`. The system MUST fuzzy-match the query (after stripping `/`) using the ranking: exact prefix > contains > character-subsequence. The palette MUST use `role="listbox"`, items `role="option"`, and `aria-activedescendant` tracking the active item. ArrowUp/ArrowDown MUST move the active item; Enter SHALL select and replace the input text with the command name + trailing space; Escape or removal of `/` MUST close.

输入框文本以 `/` 开头时,在输入框下方弹出命令面板。面板按模型可见命令 + session 自定义命令 + 内置命令 union,模糊匹配文本(支持按命令名 + 别名 + 描述关键词)。

#### Scenario: 触发面板

- **WHEN** 输入框 `inputText.startsWith('/')` 且长度 > 0
- **THEN** 弹出命令面板(覆盖在输入框上方)
- **AND** 自动 focus 到第一项
- **AND** 计算 query = `inputText.slice(1)`(去掉 `/`)

#### Scenario: 内置命令

- **WHEN** 用户输入 `/compact`
- **THEN** 面板至少显示 `/compact [options]` 内置项
- **AND** 内置命令清单(阶段 1):
  - `/compact` — 压缩上下文
  - `/branch` — 分叉当前 assistant 消息
  - `/model` — 切到 model 选择
  - `/fork` — 分叉当前 entry
- **AND** 每个内置项 `{name, aliases, description, source: 'builtin'}`

#### Scenario: session 自定义命令

- **WHEN** session 加载完成,`loadSlashCommands(sid)` 返回命令列表
- **THEN** 面板 union 显示 session 自定义命令
- **AND** session 命令 source 标为 `'user'`

#### Scenario: 模糊匹配

- **WHEN** query = `'com'`
- **THEN** 面板按匹配度排序,`/compact` 排第一,`/model` / `/fork` 等不匹配的不显示
- **AND** 匹配算法:精确前缀 > 包含 > 字符级子序列(query 的字符按顺序出现在 command.name 中)

#### Scenario: 键盘导航(↑↓)

- **WHEN** 面板打开时按 ArrowDown
- **THEN** activeIndex + 1(循环)
- **WHEN** 面板打开时按 ArrowUp
- **THEN** activeIndex - 1(循环)
- **AND** activeIndex 项用 `is-active` class 高亮
- **AND** 面板通过 `role="listbox"` + `aria-activedescendant` 标注

#### Scenario: 键盘选中(Enter)

- **WHEN** 面板打开时按 Enter
- **THEN** 把 activeIndex 项的命令文本(去掉 `/` 前缀)替换输入框 text 的 `/` 之后部分
- **AND** 关闭面板
- **AND** 焦点回到输入框

#### Scenario: 鼠标选中

- **WHEN** 用户点击某项
- **THEN** 行为与 Enter 选中一致

#### Scenario: 关闭面板(ESC / 输入框失焦 / 删除 `/`)

- **WHEN** 面板打开时按 ESC **OR** 输入框失焦 **OR** 用户删除 `/` 字符
- **THEN** 关闭面板,清空 query

#### Scenario: 鼠标点击面板外

- **WHEN** 面板打开时用户点击 input 外的其他区域
- **THEN** 关闭面板

### Requirement: slash 命令执行

After selecting a slash command, the system SHALL place the command name in the input field as plain text (e.g. `/compact `) without executing it. The user MUST press Enter to send, at which point the full slash-prefixed text SHALL be sent as a normal prompt via the existing `sendMessage` flow. The system SHALL NOT perform client-side parsing of slash commands in stage 1.

用户选中命令后,input 框内出现该命令的占位文本(如 `/compact `)。用户**自己**按 Enter 才真执行(走 sendMessage 流程)。

#### Scenario: 选中 `/compact` 后

- **WHEN** 用户选中 `/compact`
- **THEN** input 框 text 变为 `/compact ` (末尾空格)
- **AND** 焦点仍在 input
- **AND** 用户可以继续输入选项(如 `/compact 2000`)
- **AND** 实际压缩操作由 sendMessage 把 `/compact ...` 整体当文本发给后端,**不**在客户端做特殊解析(简化:slash 是文本,不是 action)

#### Scenario: 取消

- **WHEN** 选中后用户改主意
- **THEN** 用户直接编辑 input 框内容即可(slash 只是 placeholder,不锁定)
