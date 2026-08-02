## 1. 类型与基础设施

- [x] 1.1 在 `apps/dashboard/src/views/agent-workbench/types.ts` 添加 `AgentMessage.inProcessDetails?: boolean` prop(可选);不动 strict discriminated union,默认 false(等同 apps/web `MessageView` 的 `inProcessDetails` 默认 false)。Mirror apps/web React 端同名 prop。

## 2. ProcessDetailsGroup 组件

- [x] 2.1 创建 `apps/dashboard/src/views/agent-workbench/components/ProcessDetailsGroup.vue`
  - Props: `{ messages: readonly AgentMessage[]; defaultOpen?: boolean }`
  - Template: button(chevron + counts)toggle state;`<slot>` 渲染 children
  - Computed: `messageCount`, `toolCallCount`(基于 `messages` prop 累加)
- [x] 2.2 chevron 用 element-plus `CaretRight` 图标,inline-style `transform: rotate(90deg)` on open
- [x] 2.3 写 `ProcessDetailsGroup.test.ts`:覆盖
  - 默认折叠 counts 正确
  - 点击展开 body 出现
  - custom defaultOpen
  - toolCall 计数准确(单一 text 不计、toolCall block 累加)
  - empty messages(0 messages) — 退化:header 显示 `Process details · 0 messages · 0 tool calls`,body 不渲染

## 3. 算法层 — ChatWindow.compute

- [x] 3.1 在 `ChatWindow.vue` 新增 `hasFinalAssistantAnswer(msg)` helper(mirror apps/web:hasFinalAssistantAnswer)
  - role === 'assistant' AND
  - content: string 形态 trim().length > 0 OR
  - content: array 形态 至少 1 个 block.type !== 'thinking'
- [x] 3.2 新增 `isEmptyThinkingBlock(msg)` helper — 同 apps/web
  - return !hasFinalAssistantAnswer(msg)(简化版,只判定"无 displayable")
- [x] 3.3 新增 `processGroups` computed,返回 `RenderItem[]` discriminated union:
  ```
  type RenderItem =
    | { type: 'message'; message: AgentMessage; inProcessDetails: false }
    | { type: 'group';   messages: AgentMessage[] }
  ```
  算法扫描 messages,寻找 [user, ≥3 assistant 序列且 ≥1 displayable, next user/end] 触发折叠
- [x] 3.4 模板 v-for 改成 `renderItems`,基于 `renderItem.type === 'group'` 路由 `<ProcessDetailsGroup :messages="...">` 或 `<MessageView>`

## 4. ChatWindow 集成测试

- [x] 4.1 已有的 `ChatWindow.vue` 单测:扩展覆盖 `processGroups` 行为
  - 单条 assistant 不折叠
  - ≥2 条 + toolCall 折叠
  - ≥2 条全 thinking 不折叠
  - 后接 user 时折叠区间停在该 user 前
- [x] 4.2 跑现有 vitest 不破(typecheck 0 errors)
- [x] 4.3 dev 手动验证:
  - 跑一个调 bash 的多步 agent
  - 中间步骤进 ProcessDetailsGroup(默认折叠,看到 header 与计数)
  - 点击展开,看到 thinking + toolCall + result 子项
  - 最终 reply 在折叠组外,平铺显示

## 5. 验证 + 归档

- [x] 5.1 `pnpm --filter @ai-agent-workshop/dashboard exec vue-tsc --noEmit --pretty false` — exit 0
- [x] 5.2 `pnpm --filter @ai-agent-workshop/dashboard test` — ProcessDetailsGroup + ChatWindow 单测全过,既有测试不退步
- [x] 5.3 `openspec validate blockview-process-details` — exit 0
- [x] 5.4 dev 环境手动验证一次(看折叠 + 计数 + 展开都对)
- [x] 5.5 commit message: `feat(openspec): blockview-process-details ProcessDetails 折叠 + ChatWindow 集成`
- [ ] 5.6 (后续 archive 阶段) `opsx:archive blockview-process-details` 上提 spec 为 baseline

## 6. 回合聚合(turn-grouping) — A 任务

- [x] 6.1 移植 React `findFinalAssistantIndex` / `hasDisplayableProcessMessage` /
      `countToolCalls` / `withAssistantBlocks` 到 `message-display.ts`
- [x] 6.2 新增 `buildRenderSegments(messages, {isLiveTail})` —— 把消息流拆成
      `RenderSegment[]`(`{kind:'message'}` 或 `{kind:'turn', user, processGroup, processMessages}`)
      流式尾巴(最后一个回合)按单消息渲染
- [x] 6.3 ChatWindow 模板改用 `renderSegments`,turn 段在父级渲染
      `<ProcessDetailsGroup :message-count :tool-call-count>`,answerBlocks 独立
- [x] 6.4 MessageView 加 `displayBlocksOverride` / `suppressProcessGroup` /
      `showChrome` / `showTimestamp` props,让父级回合聚合能传入已拆好的 blocks
      并屏蔽 MessageView 内部自己的 ProcessDetailsGroup 包装
- [x] 6.5 写 `message-display.test.ts` 覆盖 turn-grouping helpers
      (16 个 it:helper 11 + buildRenderSegments 5)
- [x] 6.6 dev 验证:选中 `019f9967-...` session,Process details 显示
      `Process details · 3 messages · 3 tool calls`,点击可展开,内部有 wb-toolcall

## 7. 聊天窗口视觉对齐(B 任务)

- [x] 7.1 新增 CSS 变量 `--wb-bg-user` / `--wb-border-user`(浅蓝)/ `--wb-text-dim`
- [x] 7.2 user 气泡:浅蓝底 + 浅蓝边框 + 统一 12px 圆角 + padding 8/12 + fontSize 14
- [x] 7.3 assistant 气泡:max-width 85%(React 默认值),透明底无边框
- [x] 7.4 `.wb-message__blocks` flex-column gap 8
- [x] 7.5 `.wb-message__model-name` fontSize 11 + --wb-text-dim + marginBottom 4
- [x] 7.6 `.wb-message__chrome` gap 8 + marginTop 4 / user footer marginTop 3
- [x] 7.7 `.wb-message__time` fontSize 10,`.wb-message__usage` fontSize 11 + --wb-text-dim
- [x] 7.8 主区宽度: `.wb-messages > *` max-width 820px + 居中

## 8. 数据契约 — fetchSessionMessages 保留 AssistantContentBlock[]

- [x] 8.1 历史数据加载路径(`/api/sessions/[id]`)从拍扁 SDK block 为 string,改为
      对 assistant role 保留 `AssistantContentBlock[]`(mirror 形态),user/tool/system
      仍拍扁为 string
- [x] 8.2 新增 `sdkBlocksToMirror` —— SDK `toolCall`/`toolUse` → mirror `toolCall`,
      兼容 `toolCallId`/`id`、`toolName`/`name`、`input`/`arguments` 三组字段名差异
- [x] 8.3 更新 `api/agent.test.ts` 回归测试断言(assistant content 现在是 array,非 string)
- [x] 8.4 更新 `MessageView.test.ts` stale 断言(chrome v1 B2 后 user 不再渲染 'USER' el-tag)

## 9. T5 UI feedback 跟进

- [x] 9.1 `MessageView.test.ts` 中两条 stale 断言改写为反映 chrome v1 B2 的实际行为
      ('USER' el-tag 已剥除)

## 10. T6 scroll-to-bottom 跟进(reaction → ChatWindow 滚动不动)

- [x] 10.1 修复根因:`messagesScrollRef.value?.wrap` 始终 undefined(ElScrollbar expose 的
      键是 `wrapRef`,不是 `wrap`)。改用 `document.querySelector` 直接定位
      `.wb-messages .el-scrollbar__wrap`
- [x] 10.2 scrollToBottom 改 `force` 区分场景:用户刚发消息 / 初次加载 force=true;
      流式增增 force=false 走"贴近底部"判断
- [x] 10.3 解决 stuck on middle 问题:流式期间 Vue 多次 patch DOM,scrollHeight
      在不同帧之间会变化。仅一次 nextTick 后设 scrollTop 会停在距底 ~100px。
      引入 `IntersectionObserver` 监控 `.wb-chat-window__anchor` 是否在视口底部:
      不在 + 用户无主动滚意图时,自动 wrap.scrollTop = wrap.scrollHeight
- [x] 10.4 引入用户主动滚意图跟踪(`userScrollIntentUntil` 800ms):监听 wrap 上
      `wheel` / `touchstart` / `keydown`(PageUp/Down/Home/End/Arrows/Space)
- [x] 10.5 onUnmounted 清理 IntersectionObserver
- [x] 10.6 e2e 验证:初次加载到底、用户发消息到底、流式增增一直追到底、
      用户主动滚上去不抢用户(`inspect-scroll.mjs` / `inspect-scroll2.mjs` /
      `inspect-stream3.mjs`)
