## Why

Vue3 Agent 工作台已能成功发送 prompt，也能通过 SSE 收到 pi SDK 的完整回复事件，但当前活跃的 `AppShell → ChatWindow → useEventStream` 路径直接按内部事件名过滤 SDK 原始事件。真实的 `message_update` 文本增量因此被丢弃，用户只能看到自己的消息和空白助手气泡；prompt 失败时的 `prompt_error` 也不可见。

## What Changes

- 在活跃工作台的 SSE 入口恢复 SDK 原始事件到 UI 内部事件的归一化。
- 将 `message_update.assistantMessageEvent.text_delta` 转换为内部 `message_delta`，使助手文本进入消息状态机。
- 仅为 `role: assistant` 的 `message_start` 创建助手占位，避免用户事件生成空助手气泡。
- 将后端 `prompt_error.errorMessage` 转换为前端可见错误。
- 使用真实 pi SDK 事件形状补充回归测试，覆盖正文、角色过滤和错误传播。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本次只修复现有 Agent 工作台聊天事件桥接的实现偏差，不改变既有需求或对外契约，因此无需 delta spec。

## Impact

- 主要影响 `apps/dashboard/src/views/agent-workbench` 下的 SSE composable、事件类型/适配器与相关测试。
- 不修改 `apps/web` API、数据库 schema、公开 API 或依赖版本。
- 修复后 Vue 工作台与 pi SDK 当前事件契约重新对齐。
