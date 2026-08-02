## Why

Agent 工作台(`apps/dashboard/src/views/agent-workbench/components/ChatWindow.vue`)M3 切到 Vue3 后一直跑的是 `apps/dashboard/CLAUDE.md` §"Vue 端 v1 简化"路线,只覆盖消息列表 / 输入框 / SSE 实时流三件最基础的事。用户在浏览器里看到的对话窗口因此相当粗糙:没有消息头部(无模型名 / 时间戳 / 头像区分)、没有 token 计数、没有 Copy / Edit / Fork / Retry 操作按钮,Composer 也没有 model 选择、thinking level、tool preset、steer / follow-up 队列、slash 命令面板。

参考实现 `apps/web/components/ChatWindow.tsx`(1047 行)+ `ChatInput.tsx`(1950 行)+ `MessageView.tsx`(1336 行)已经达到生产级水平,React 端 60+ 个 ref 暴露出来的能力(模型列表、thinking 等级、tool preset、queue、slash command、notices、extension 等)没有一行映射到 Vue 端。这条鸿沟让"主前端是 apps/dashboard"的设计承诺打了折扣 —— 用户从 React 参考界面截图(端口 30141)对比 Agent 工作台截图(端口 3006),后者明显像半个产品。

## What Changes

阶段 1 覆盖路径 A(`apps/dashboard/src/views/agent-workbench/`),新增 8 项能力(分 3 个 spec):

- **A1 消息头部 chrome**:每条消息渲染 `[USER]` / `[model name]` 文本标签 + 智能时间戳(今天只显示时分,非今天显示月日年)。不画头像(产品决策:不画头像以保持观感简洁)
- **A2 token footer**:Assistant 消息完成后底部渲染 `{n} in · {n} out · {n} cache` 计数。**不显示 cost**(产品决策:不让用户对 token 花费焦虑)。TPS 实时速率不在阶段 1 范围
- **A3 操作按钮**:每条 user 消息 hover 时显示 Copy / Edit / Fork(有 entryId 时)/ Navigate Up(有 prevAssistantEntryId 时);Assistant 消息 hover 时显示 Copy / Retry。Copy 写入剪贴板,其他按钮仅 emit 透传(后续 Track 接入真实跳转)
- **B4 model 选择下拉**:Composer 底部显示当前 model(可关闭自动选择),点击弹出下拉(按 `Intl.Collator({numeric:true})` 排序),选中后调 `sendAgentCommand({type:'set_model'})`
- **B5 thinking level 下拉**:Composer 底部显示 8 个等级(`auto / off / minimal / low / medium / high / xhigh / max`),选中后调 `sendAgentCommand({type:'set_thinking_level'})`
- **B6 tool preset 切换**:Composer 底部三态切换 `off / default / full`,每个 preset 展开为 toolNames 数组后调 `sendAgentCommand({type:'set_tools'})`,再用 `get_tools` 拉新列表
- **B7 queued messages 队列 + recall**:Streaming 期间 Composer 上方显示 steer(灰色) / followUp(蓝色)队列行;recall 按钮调 `cancel_queue` 命令撤回
- **B8 slash 命令面板**:输入框输入 `/` 触发,弹出面板含内置命令(`/compact` / `/branch` / `/model` / `/fork`)+ session 自定义命令(通过 `get_commands` 拉取),↑↓ 键盘导航,Enter 选中

阶段 1 不做(明确划入后续 change):thinking block 延迟加载 + LRU 缓存、tool call 配对 diff 渲染、compaction 消息类型、Extension 系统、BranchNavigator 树、ChatMinimap、art-chat-window(路径 B)的同步升级。

## Capabilities

### New Capabilities

- `agent-message-chrome`: A1 消息头部 chrome + A2 token footer + A3 操作按钮(共享 useAgentSession 扩展与 types 增字段)
- `chat-composer-controls`: B4 model 下拉 + B5 thinking level 下拉 + B6 tool preset 切换(共享 Composer 状态条控件与 set_model/set_thinking_level/set_tools 命令封装)
- `chat-streaming-queue`: B7 队列行 + recall + B8 slash 命令面板(共享 streaming 期间的 Composer 增强与 slash palette)

### Modified Capabilities

无。现有 12 个 main spec(都是后端 / 平台 / 鉴权类)与本 change 不存在 REQUIREMENTS 冲突。

## Impact

**受影响的代码**

- `apps/dashboard/src/views/agent-workbench/components/ChatWindow.vue` — 容器层扩展,接更多 emit
- `apps/dashboard/src/views/agent-workbench/components/MessageView.vue` — 重写,加头部 chrome + token footer + 操作按钮
- `apps/dashboard/src/views/agent-workbench/components/ChatInput.vue` — 重写,加 model/thinking/preset 状态条、IME 保护、slash palette、queue 行
- `apps/dashboard/src/views/agent-workbench/composables/useAgentSession.ts` — 扩展 ref 集合(从 5 个 ref → 30+ ref)
- `apps/dashboard/src/views/agent-workbench/composables/useEventStream.ts` — SSE 处理加 usage / thinkingLevel / queuedMessages 解析
- `apps/dashboard/src/views/agent-workbench/types.ts` — 加 usage / toolResult / thinkingBlock / queuedMessages 类型
- `apps/dashboard/src/api/agent.ts` — 加 `getSlashCommands` / `setModel` / `setThinkingLevel` / `setTools` 包装
- `apps/dashboard/src/views/agent-workbench/components/__tests__/MessageView.test.ts`(新增)
- `apps/dashboard/src/views/agent-workbench/components/__tests__/ChatInput.test.ts`(扩展)

**受影响的 API**

无后端新增。`apps/web/app/api/agent/[id]/route.ts` 已支持 `prompt / steer / follow_up / set_model / set_tools / get_tools / get_commands / fork` 等命令 type;`/api/models-config/route.ts` 已存在。

**依赖**

- 不新增 npm 包
- `markdown-it` 和 `dompurify` 已存在(`MarkdownBody.vue` 在用)
- `Intl.Collator` 浏览器原生

**测试**

- 每个能力至少 1 个 vitest 用例
- 完整 workbench 套件全绿(目前 128/128)
- dashboard build + web build 通过
- 浏览器手动验收(用户自己跑)
