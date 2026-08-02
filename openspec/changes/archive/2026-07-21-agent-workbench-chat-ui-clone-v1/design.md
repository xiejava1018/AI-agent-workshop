# Design: Agent 工作台聊天窗口 · 阶段 1 复刻

> change: `agent-workbench-chat-ui-clone-v1`
> 类型: full workflow
> 范围: 路径 A(`apps/dashboard/src/views/agent-workbench/`)8 项能力,3 个 spec
> 日期: 2026-07-20

---

## Context

`apps/dashboard/CLAUDE.md` 明确指出,Vue Agent 工作台是用户在浏览器里实际打开的主前端;而当前 `components/ChatWindow.vue`(163 行)+ `MessageView.vue`(126 行)+ `ChatInput.vue`(283 行)是 M3 切到 Vue3 时按"v1 简化"路线写的骨架版,功能与 React 参考实现(`apps/web/components/`,合计 4300+ 行业务代码)有数量级差距。

阶段 1 目标:把差距在**路径 A** 上缩小到 80% 视觉/交互相似度。3 个 spec 覆盖 8 项能力,共享同一条 `useAgentSession` 扩展链。

## Goals / Non-Goals

**Goals**

- 让 Agent 工作台在视觉/交互上接近 React 参考界面
- 暴露 30+ 个 useAgentSession ref(modelNames / modelList / thinkingLevel / toolPreset / queuedMessages / slashCommands / entryId / prevAssistantEntryId / usage / etc.)以支持 UI 子组件
- 修复已知漏洞(IME 组合输入保护缺失)
- 完整 vitest 套件全绿(目前 128/128)
- 不破坏现有 3 个 bug 修复(useSessionList 乐观合并 / useAgentSession.fetchHistory race / AppShell refresh 恢复)

**Non-Goals**

- 不替换 React 端实现
- 不升级 art-chat-window(路径 B)—— 这是另一条 chat 路径
- 不做 thinking block 延迟加载 / tool diff 渲染 / extension 系统 / branch 树 / chat minimap
- 不新增后端 API 命令 type(全部已存在,详见 `grep` 确认)

## Decisions

### Decision 1: 共享 useAgentSession ref 集合

把 8 项能力需要的所有 ref 集中到 `useAgentSession.ts` 一次扩展完成,然后 UI 子组件按需消费。

**为什么**: 避免在 ChatWindow / ChatInput / MessageView 之间 prop-drilling 长 prop 列表;React 端也是这种"一个 useAgentSession hook 暴露 60+ ref"的模式。Composition API 的 `computed` / `ref` 可以增量暴露,不影响现有 5 个 ref 调用方。

**替代方案**:每个能力独立 composable(`useMessageChrome` / `useModelSelector` 等),再在 ChatWindow 里组合 — 会产生更多 ref / 事件桥接,反而复杂。否决。

### Decision 2: useEventStream SSE 处理扩展

`useEventStream.ts` 当前只处理 5 类白名单事件(`message_start / message_delta / message_end / tool_update / prompt_done / error / done`)。阶段 1 需要在白名单基础上增加的事件类型(从 React 端参照):

- `message_usage` — 携带 `{input, output, cacheRead, cacheWrite}` → 写入 AssistantMessage.usage
- `thinking_level_changed` — 携带 `{level}` → 写回 session metadata
- `queue_update` — 携带 `{steer: [...], followUp: [...]}` → 更新 queuedMessages ref
- `model_changed` — 携带 `{provider, modelId}` → 写回 session metadata

每类事件在 `handleEvent` switch 中加一个 case,白名单 `ALLOWED_SSE_EVENTS` 加 4 个常量。

**替代方案**:在 useAgentSession 层重新订阅 SSE 二次解析 — 会与 useEventStream 的连接状态重复。否决。

### Decision 3: types.ts 单文件加字段

`types.ts` 当前有 `AgentMessage` / `Branch` / `ToolCall` / `StreamStatus`。阶段 1 增量加:

- `AgentMessage.usage?: {input, output, cacheRead, cacheWrite, cost?}`(cost 保留字段但 A2 不展示)
- `AgentMessage.entryId?: string`(从 session context 关联,user 消息 Fork 需要)
- `AgentMessage.prevAssistantEntryId?: string`(A3 Navigate Up 需要)
- `AgentMessage.modelProvider?: string` / `modelId?: string`(头部 chrome 需要)
- `QueueItem { id, kind: 'steer'|'followUp', text, createdAt }`

**为什么**:阶段 1 全是 Vue 端扩展,React 端 types.ts 已经定义好相似形状。直接复用 React 类型语义但放在 Vue 自己的 types.ts,避免跨应用类型依赖。

### Decision 4: ChatInput IME 保护 — composition 事件

```ts
const isComposing = ref(false)
function onCompositionStart() { isComposing.value = true }
function onCompositionEnd() { isComposing.value = false }
function onKeydown(e: KeyboardEvent) {
  if (isComposing.value) return  // 中文输入未完成,放行 IME 默认行为
  if (e.key === 'Enter' && !e.shiftKey /* ... */) {
    e.preventDefault()
    void handleSend()
  }
}
```

在 el-input 模板上绑 `@compositionstart="onCompositionStart"` `@compositionend="onCompositionEnd"`.

**为什么**:Vue 主流做法,Chromium / Firefox / Safari 行为一致。`keyCode === 229` 兜底也行,但需要写额外逻辑,容易遗漏。composition 事件语义清晰。

**替代方案**:仅靠 `keyCode === 229` 判断(React 端原始做法)— 在 IME 拼接边界 case 不可靠。否决。

### Decision 5: 操作按钮 emit 而非直接调用

`MessageView.vue` 内 hover 出现的 Copy / Edit / Fork / Retry / Navigate 按钮,只 emit 事件到父级 ChatWindow,不在 MessageView 内部直接调 `useAgentSession` 之类。

**为什么**:
- Vue 中"presentational component 不调 hook"是 cleaner pattern
- ChatWindow 容器决定 retry 时是否要找到前一条 user 消息 / Fork 是否要乐观切换 session
- 已有 useAgentSession 在 ChatWindow 一处实例化,通过 props 传给 MessageView 也行,但 emit 模式让 MessageView 纯展示

**替代方案**:MessageView 接 useAgentSession 实例,直接 send / fork — 违反 Vue 中"presentational 组件不调业务 hook"的惯例。否决。

### Decision 6: tool preset 映射表独立工具

新增 `apps/dashboard/src/views/agent-workbench/composables/toolPresets.ts`,导出 `getToolNamesForPreset(preset, allTools): string[]`。映射规则:

- `off` → `[]`
- `default` → 内置 4 个核心工具名(`['bash', 'read', 'write', 'edit']`,具体列表查 pi SDK 实际注册)
- `full` → `allTools`(传入的全部已注册工具)

`allTools` 来自 `sendAgentCommand(sid, {type: 'get_tools'})` 的响应,缓存到 `useAgentSession.tools: Ref<ToolEntry[]>`。

**为什么**:React 端有 `apps/web/lib/tool-presets.ts` 同名实现;Vue 端不能跨应用复用 (CLAUDE.md "apps/web 不再承担业务模块"),需要独立写。**预期会有 2–3 行的差异**(内置工具名清单),后续可对齐。

### Decision 7: slash palette 用 `role="listbox"` + 键盘焦点

```
[输入框 inputText]
   ↓ (inputText.startsWith('/'))
[SlashPalette]  ← absolute positioned below input
  role="listbox"
  aria-activedescendant={items[activeIndex].id}
```

每个选项 `role="option" aria-selected={i === activeIndex}"`. 键盘 `ArrowUp/Down` 改 activeIndex,`Enter` 选中,`Esc` 关闭。

**为什么**:React 端用 `role="listbox"` 同款,wai-aria 标准做法;屏幕阅读器友好。

## Risks / Trade-offs

| 风险 | 影响 | 缓解 |
|---|---|---|
| useAgentSession ref 数量从 5 → 30+,类型/单测膨胀 | 中 | 增量扩展,每次 PR 走 128 测试验证不回归 |
| SSE 事件类型增加 4 类,白名单需要严格枚举 | 中 | 与 React 端白名单对齐,新增事件若不识别则 console.warn 丢弃,不破坏现有流 |
| 操作按钮 emit 但父级不接(Edit / Fork / Navigate 阶段 1 仅 console.log) | 低 | 阶段 1 是 UI 展示阶段,功能联通放在后续 Track。emit 接口先稳定 |
| 状态条 preset 切换触发 `get_tools`,接口失败 | 低 | 失败静默,保留上次成功值,不弹错误 |
| `usage.cost.total` 后端会推但阶段 1 不展示 | 低 | types.ts 保留字段(后续 A2 之外的 change 可能用),不读不渲染 |
| IME 事件在某些移动端浏览器兼容性 | 低 | 主流桌面浏览器 OK,移动端不在阶段 1 范围 |
| art-chat-window 路径 B 暂不升,产品上有双轨体验 | 中 | 已确认:后续开新 change 处理;CLAUDE.md 留声明 |

## Migration Plan

无数据库迁移。无功能开关(直接 push 即可,因为现有 useAgentSession 5 个 ref 调用方在类型不变的情况下不会破)。

回滚策略:每个能力一个独立 commit(按 tasks.md),`git revert <commit>` 单独回滚。整套回滚 `git revert 081c98b..HEAD`(从 base_ref 到新 HEAD)。

## Open Questions

- **OQ-1**: 后端是否真的在 SSE 里推 `message_usage` 事件?React 端解析了,Vue 阶段 1 也要解析。**需在第一个 build task 之前用浏览器开发者工具实测一次**,如果后端只在 `prompt_done` 里附 usage,就只需要解析一处。
- **OQ-2**: `cancel_queue` 命令 type 是否存在?React 端 recall 用的是 `cancel_queue` 还是 SSE 推的删除事件?如果后端没有 cancel_queue,需要先在后端补一个端点(脱离本 change 范围),否则 recall 仅本地有效。
- **OQ-3**: `get_commands` 的响应 schema 是否能直接用于 slash palette 的 `SlashCommandInfo[]`?React 端有规范化逻辑(`normalizeQueuedMessages` 等),Vue 端要不要同等规范化?简化:Vue 端只用 name + aliases + description 三个字段,后端多给少给都兼容。
- **OQ-4**: tool preset 切换后,流式生成是否中断?React 端实现里没明确说,需要实测。**如果会中断**,阶段 1 不在 streaming 时允许切换 preset(disabled 状态),与"状态条 streaming 时禁用"决策一致。

## Test Coverage

| 能力 | 测试用例 | 文件 |
|---|---|---|
| A1 头部 chrome | "Assistant 头部命中 modelNames 显示模型名" / "未命中降级为 assistant" / "User 显示 USER 标签" | `MessageView.test.ts`(新增) |
| A2 token footer | "完成消息且有 usage → 显示三段数字" / "流式中不渲染" / "usage 缺失不渲染" | 同上 |
| A3 操作按钮 | "Copy 点击触发 ElNotification" / "Edit emit edit 事件" / "Fork 在 entryId 缺失时不渲染" | 同上 |
| B4 model 下拉 | "点击展开下拉,选项按 Collator 排序" / "选中触发 set_model" / "空 modelList 降级" | `ChatInput.test.ts`(扩展) |
| B5 thinking level | "默认值 = session.thinkingLevel" / "选中触发 set_thinking_level" | 同上 |
| B6 tool preset | "切到 full 调 set_tools" / "切到 off 传空数组" / "映射表覆盖 default" | 同上 + 新增 `toolPresets.test.ts` |
| B7 队列 | "steer 队列行渲染" / "followUp 蓝色区分" / "recall 移除行" | `ChatInput.test.ts` |
| B8 slash | "输入 / 触发面板" / "模糊匹配 com → /compact 排第一" / "↑↓ 改 activeIndex" / "Enter 替换 inputText" | 同上 |
| IME | "中文拼音按 Enter 不发送" | 同上 |

完整 workbench 套件 128/128 + dashboard build + web build = 验收通过线。

## 任务清单分桶

```
T1  基础设施     (1-2 commits) - types 扩展 + useEventStream SSE 加事件 + useAgentSession ref 集
T2  A 组          (3 commits)   - MessageView 重写: 头部 + footer + 按钮
T3  B 组-控件     (2 commits)   - ChatInput 状态条: model + thinking + preset
T4  B 组-队列     (2 commits)   - ChatInput streaming 期间: queue + recall
T5  B 组-slash    (2 commits)   - ChatInput slash palette
T6  IME + 可访问性 (1 commit)   - 全局修
T7  测试 + 验证   (1 commit)   - 全套 128+ 测试 + build
T8  归档          (1 commit)   - docs + commit message
```

预计 12–14 个 commit,2–3 个 PR 形态可分。
