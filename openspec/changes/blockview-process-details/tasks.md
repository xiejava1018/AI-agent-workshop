## 1. 类型与基础设施

- [ ] 1.1 在 `apps/dashboard/src/views/agent-workbench/types.ts` 添加 `AgentMessage.inProcessDetails?: boolean` prop(可选);不动 strict discriminated union,默认 false(等同 apps/web `MessageView` 的 `inProcessDetails` 默认 false)。Mirror apps/web React 端同名 prop。

## 2. ProcessDetailsGroup 组件

- [ ] 2.1 创建 `apps/dashboard/src/views/agent-workbench/components/ProcessDetailsGroup.vue`
  - Props: `{ messages: readonly AgentMessage[]; defaultOpen?: boolean }`
  - Template: button(chevron + counts)toggle state;`<slot>` 渲染 children
  - Computed: `messageCount`, `toolCallCount`(基于 `messages` prop 累加)
- [ ] 2.2 chevron 用 element-plus `CaretRight` 图标,inline-style `transform: rotate(90deg)` on open
- [ ] 2.3 写 `ProcessDetailsGroup.test.ts`:覆盖
  - 默认折叠 counts 正确
  - 点击展开 body 出现
  - custom defaultOpen
  - toolCall 计数准确(单一 text 不计、toolCall block 累加)
  - empty messages(0 messages) — 退化:header 显示 `Process details · 0 messages · 0 tool calls`,body 不渲染

## 3. 算法层 — ChatWindow.compute

- [ ] 3.1 在 `ChatWindow.vue` 新增 `hasFinalAssistantAnswer(msg)` helper(mirror apps/web:hasFinalAssistantAnswer)
  - role === 'assistant' AND
  - content: string 形态 trim().length > 0 OR
  - content: array 形态 至少 1 个 block.type !== 'thinking'
- [ ] 3.2 新增 `isEmptyThinkingBlock(msg)` helper — 同 apps/web
  - return !hasFinalAssistantAnswer(msg)(简化版,只判定"无 displayable")
- [ ] 3.3 新增 `processGroups` computed,返回 `RenderItem[]` discriminated union:
  ```
  type RenderItem =
    | { type: 'message'; message: AgentMessage; inProcessDetails: false }
    | { type: 'group';   messages: AgentMessage[] }
  ```
  算法扫描 messages,寻找 [user, ≥3 assistant 序列且 ≥1 displayable, next user/end] 触发折叠
- [ ] 3.4 模板 v-for 改成 `renderItems`,基于 `renderItem.type === 'group'` 路由 `<ProcessDetailsGroup :messages="...">` 或 `<MessageView>`

## 4. ChatWindow 集成测试

- [ ] 4.1 已有的 `ChatWindow.vue` 单测:扩展覆盖 `processGroups` 行为
  - 单条 assistant 不折叠
  - ≥2 条 + toolCall 折叠
  - ≥2 条全 thinking 不折叠
  - 后接 user 时折叠区间停在该 user 前
- [ ] 4.2 跑现有 vitest 不破(typecheck 0 errors)
- [ ] 4.3 dev 手动验证:
  - 跑一个调 bash 的多步 agent
  - 中间步骤进 ProcessDetailsGroup(默认折叠,看到 header 与计数)
  - 点击展开,看到 thinking + toolCall + result 子项
  - 最终 reply 在折叠组外,平铺显示

## 5. 验证 + 归档

- [ ] 5.1 `pnpm --filter @ai-agent-workshop/dashboard exec vue-tsc --noEmit --pretty false` — exit 0
- [ ] 5.2 `pnpm --filter @ai-agent-workshop/dashboard test` — ProcessDetailsGroup + ChatWindow 单测全过,既有测试不退步
- [ ] 5.3 `openspec validate blockview-process-details` — exit 0
- [ ] 5.4 dev 环境手动验证一次(看折叠 + 计数 + 展开都对)
- [ ] 5.5 commit message: `feat(openspec): blockview-process-details ProcessDetails 折叠 + ChatWindow 集成`
- [ ] 5.6 (后续 archive 阶段) `opsx:archive blockview-process-details` 上提 spec 为 baseline
