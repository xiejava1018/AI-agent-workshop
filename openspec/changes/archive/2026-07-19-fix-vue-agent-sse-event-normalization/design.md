## Context

当前活跃 Vue3 工作台通过 `useEventStream` 直接消费 `/api/agent/[id]/events` 的 pi SDK 原始事件。pi SDK 使用 `message_update` 承载 `assistantMessageEvent.text_delta`，而 UI 状态机使用内部 `message_delta`。旧 `useAgentEvents` 已有正确映射，但 AppShell 新路径没有经过它，且当前入口在白名单判断前未做归一化。

## Goals / Non-Goals

**Goals:**

- 为活跃工作台提供单一、可测试的 SDK 事件归一化入口。
- 恢复助手文本增量、正确过滤用户 `message_start`、显示 `prompt_error`。
- 用真实 SDK 事件形状锁定回归。

**Non-Goals:**

- 不修改 apps/web SSE/API 契约。
- 不新增事件类型或产品能力。
- 不处理 Next dev 冷编译与全局 15 秒 HTTP 超时。
- 不在本 hotfix 中增加 SSE replay/reconnect 历史补偿。

## Decisions

1. 将纯函数归一化逻辑放到工作台 composable 可复用模块，并由活跃 `useEventStream` 在白名单判断前调用。纯函数便于以 SDK 原始 fixture 做单元测试。
2. 内部状态机继续使用现有 `message_start/message_delta/message_end/tool_update/error/prompt_done` 形状，避免扩大 UI 层改动。
3. `message_start` 仅在 SDK 消息角色为 assistant 时下发；用户消息继续由发送动作乐观写入。
4. `prompt_error.errorMessage` 统一转换为内部 `error.content`，复用现有错误通知路径。
5. 保留未知 SDK 事件的窄过滤策略；已识别但对 UI 无意义的事件由归一化函数返回 null，不进入状态机。

## Risks / Trade-offs

- [SDK 事件字段未来变化] → 回归测试直接使用当前安装版本的真实事件形状，并集中维护归一化函数。
- [旧、新 composable 出现两份映射] → 抽取公共适配器供两条路径复用，避免继续复制。
- [工具事件展示行为变化] → 本次只保持旧适配器已经定义的 `tool_execution_start/end → tool_update` 行为，不扩展 UI。
