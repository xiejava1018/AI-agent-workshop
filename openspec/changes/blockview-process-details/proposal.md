## Why

Dashboard 的 assistant 消息在多步 agent 流程(连续 thinking + toolCall + result)下整段平铺成一坨文本流,用户难以快速定位最终回复。`apps/web` 参考实现用 `ProcessDetailsGroup` 把"中间步骤"折叠成 `Process details · N messages · M tool calls` 可展开/收起的面板 — 这是用户友好的正确呈现,应在 dashboard 端对齐实现。

## What Changes

- **新增** `apps/dashboard/src/views/agent-workbench/components/ProcessDetailsGroup.vue`:折叠面板 UI,header 显示"Process details · N messages · M tool calls",点击展开/收起内部的 assistant 子序列。
- **修改** `apps/dashboard/src/views/agent-workbench/components/ChatWindow.vue`:在 v-for render messages 时,识别连续 assistant 序列折叠为 ProcessDetailsGroup(对齐 `apps/web/components/ChatWindow.tsx` 的消息分组逻辑)。
- **复用** 既有 `MessageView.vue` 渲染每个 assistant 子消息(本 change 不重复实现 BlockView / chrome)。
- **辅助**(测试 scaffolding):为 `MessageView` 加 `inProcessDetails` prop(Vue 端默认 false,与 apps/web 同形态但**不强制每条用**;折叠组由 ChatWindow 在父级包裹,MessageView 自身仍独立可看)。
- **不引入**新依赖。
- **不变更** baseline specs(`agent-message-chrome` 已 covered chrome / MIME;`chat-composer-controls` 与本次无关)。

## Capabilities

### New Capabilities

- `assistant-message-process-details`: 在 ChatWindow 渲染层包裹连续 assistant 序列(≥ 2 个 assistant 消息且至少 1 个含 displayable block)为可折叠 ProcessDetailsGroup;header 显示计数;展开后内部仍走 MessageView 渲染。

### Modified Capabilities

(none — 本 change 是纯 ChatWindow 层折叠行为,不修改任何 baseline requirement)

## Impact

- **代码范围**:仅 `apps/dashboard/`(`ProcessDetailsGroup.vue` 新增、`ChatWindow.vue` 修改)。
- **API**:无。
- **依赖**:无新增(本地 Vue3 + element-plus icons 已具备)。
- **测试**:`ProcessDetailsGroup.test.ts` + `ChatWindow.test.ts` 覆盖折叠/展开、trigger 条件、嵌套。
- **回归风险**:低。折叠只在 ChatWindow 层做容器包裹,不动 MessageView 内部;未达 trigger 的短序列保持原样平铺。
