# apps/dashboard

`apps/dashboard` 是基于 `vue-pure-admin` 模板改造的 Vue3 + Element Plus 前端。**这是用户在浏览器里实际打开的产品**。

## 角色

**主前端**。仓库的"Agent 工作台""数字员工""工作区""工作空间""模型配置""审计日志""监控大盘""菜单管理""角色管理"等 13 屏都在这里。

依据：`docs/superpowers/specs/2026-07-16-m3-vue3-workbench-design.md` §1 第 37 行。

## 后端依赖

Vue 不直连数据库 / Pi Agent，**经 Vite proxy 消费 `apps/web` 的 API**：

- 普通 API：Vite proxy `/api/*` → `apps/web`
- SSE：`EventSource` 消费 `/api/agent/[id]/events`
- 401 续 token：`POST /api/auth/refresh`

任何"前端 bug"如果根因是后端，**先改 `apps/web`**，不要在 Vue 这边绕开。

## 改代码前的判断

1. 用户截图/描述里的 UI 是这里——这是默认改动位置。
2. 会话/聊天相关的状态管理有两个独立路径，**别混**：
   - `views/agent-workbench/index.vue` 用组件本地 `ref`（旧路径，逐步替换中）
   - `components/core/layouts/art-chat-window/index.vue` 用 `store/modules/chat.ts` (Pinia)
   改一个之前先确认它跟的是哪条路径。
3. RBAC 动态菜单 / 路由守卫是模板自带的，不要重写；要改鉴权逻辑优先改后端 + 权限点契约。

## 已知陷阱

- `views/agent-workbench/index.vue` 的 `selectSession(id)` 是组件本地函数——历史上漏了清空 `messages` 和 `isTyping`，导致切换会话时旧消息残留。改会话切换逻辑时**确认** `messages.value = []` + `isTyping.value = false`。
- SSE 事件类型分发有 `===` vs `|` 优先级坑的历史教训（注释里有）。新增 case 时记得显式枚举类型，不要写 `event.type === 'a' | 'b'`。
- `useSessionList` 的乐观 push：连续 create 多个会话时，乐观项由 `optimisticIds: Set<string>` 跟踪；`load()` 走 Map-by-id 合并而非整体覆盖，避免乐观项被挤掉。**改乐观更新逻辑时**确保 `optimisticIds.delete(id)` 也在 delete 成功路径上同步执行，否则已删除会话会"复活"。
- `useAgentSession.fetchHistory()` 用 `fetchHistorySeq` 序号防 race——快速切两次会话时，只采纳最后一次请求的响应。**新增类似的"按 sessionId 异步拉数据"模式**时记得复用这个序号门控，否则会跨会话污染。
- `AppShell` 用 localStorage[`wb:lastSessionId`] 恢复 currentSessionId，但 SessionSidebar 内部还有自己的 `useSessionList` 实例——两实例独立，AppShell 仅**读**侧栏列表用于查"last id 是否存在"，不写入共享状态。**改造时**记得区分"读实例"vs"写实例"，避免双实例互相覆盖。

### chat chrome v1

- `MessageView.vue` 的 `assistantLabel` 是两级查表：先 `modelNames[\`${provider}:${modelId}\`]`，再 `modelNames[modelId]`，最后兜底字面量 `'assistant'`。命中空字符串会被 `if (named)` 当 falsy 跳过继续往下查。**改 modelNames 映射或 fallback 文案时**确认所有未命中分支都落到 `'assistant'`，不要让 unknown 模型渲染成 `undefined`/`null`。
- IME 组合守卫必须独占、且在 slash palette 之前：`ChatInput.vue` 的 `isComposing` ref 由 `<el-input>` 上的 `@compositionstart`/`@compositionend` 翻转，`onKeydown` 顶部 `const e = evt as KeyboardEvent` 后紧跟 `if (isComposing.value) return`，在 palette 块之前。中文拼音按 Enter 确认候选时该守卫放行，不会误触发 `handleSend`。**改 onKeydown 时**不要把 IME 守卫与 palette 守卫合并成 OR——组合期间方向键要交给 IME 候选，不能被 palette activeIndex 截走。
- `MessageActionBar.vue` 是 presentational：只 import `ElNotification` / `ref` / `copyText`，不 import 也不调 `useAgentSession`。`edit` / `fork` / `navigate` / `retry` 全部 emit 由 `MessageView` 转给 `ChatWindow` 容器层处理（`retry` 实做向前找 user 消息重发，其余阶段 1 仅 `console.log` TODO）。`copy` 是有意例外——本组件内直接 `copyText` + `flashCopy('copied'|'failed')` + 失败 `ElNotification`，再 `emit('copy')` 通知父级。**在 action bar 加新动作时**一律 emit 透传到容器层，不要在子组件内调 hook / RPC；只有跟自身 UI 紧绑定的反馈才留在本组件。