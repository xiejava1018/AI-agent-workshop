# Vue 3 Agent 工作台复刻 — Handoff 文档

> 日期：2026-07-19
> 给下次会话(自己 / 另一个 Claude 会话 / 用户)开工用
> **不要在没有精读 §4 文件的情况下继续改 AppShell.vue**

## 1. 这次会话做了什么

| 项 | 状态 |
|---|---|
| 调研 + 设计 v1.5 | ✅ `docs/plans/2026-07-18-vue3-agent-workbench-replica-design.md` |
| 基线骨架 (types.ts + workbench.css) | ✅ |
| Track A (SessionSidebar / 配置面板 / TabBar) | ✅ commit `854de42` |
| Track B (ChatWindow / Input / SSE / Markdown) | ✅ commit `25d0d1b` |
| Track C (FileExplorer / Viewer / Minimap) | ✅ commit `7e83d0f` |
| 3 Track 合并到 main | ✅ `5f40c62` / `0ce68ff` / `446f4ec` |
| AppShell.vue 薄壳 | ⚠️ 在仓库，未挂路由 |
| 后端 files 端点 | ✅ `d1e4100` |
| PR #9 合并 | ✅ `49c3444` |
| **端到端集成验证** | ❌ **未做** |
| 路由切换到新 AppShell | ❌ **回退了**（commit `4a98a7e` 被 reset） |

## 2. 当前路由指向

- `apps/dashboard/src/views/agent-workbench/index.vue` = **老 693 行实现**（用户当前能正常使用）
- `apps/dashboard/src/views/agent-workbench/AppShell.vue` = **新三栏薄壳（不挂路由，仓库里但用户看不到）**
- 14 组件代码全部在仓库，编译/类型/vitest 都过

## 3. 这次会话踩过的坑（下次别再踩）

### 3.1 盲改 layout
- commit `3799b7d`（已 force-reset 回退）盲目加 scoped flex 约束，没看根因就改
- **教训**：CLAUDE.md `verification-before-completion` 不是空话

### 3.2 仓促声称完成
- 没跑端到端就直接说"100% 完成"
- **教训**：单元测试通过 ≠ 集成能跑

### 3.3 写 AppShell 时没精读子组件
- 以为 `handleSelect`/`handleCreate` 只要写个 stub 就能跑
- 实际：SessionSidebar 内部 `useSessionList.createSession()` 是自己跑，AppShell 拿不到新会话 ID；ChatWindow 需要 sessionId prop + 内部 useEventStream 拉历史，但当时没验证
- **教训**：写容器组件前必须精读每个子组件的实际 API 行为

## 4. 下次开工前**必读**的文件（按优先级）

| 顺序 | 文件 | 看什么 |
|---|---|---|
| 1 | `apps/dashboard/src/views/agent-workbench/components/SessionSidebar.vue` | emits 实际发什么、`useSessionList` 是否暴露 sessions ref 给父 |
| 2 | `apps/dashboard/src/views/agent-workbench/components/ChatWindow.vue` | props 实际接受什么、useAgentSession 怎么拉历史消息 |
| 3 | `apps/dashboard/src/views/agent-workbench/composables/useEventStream.ts` | EventSource 连接时机、错误回调、abort 行为 |
| 4 | `apps/dashboard/src/views/agent-workbench/composables/useAgentSession.ts` | 消息合并逻辑、空状态 |
| 5 | `apps/dashboard/src/views/agent-workbench/composables/useSessionList.ts` | createSession 返回结构、listSessions 响应字段 |

## 5. 集成验证清单（按顺序跑，**全部跑通再切路由**）

### 5.1 浏览器手动验证（最重要）
- [ ] 打开 `http://localhost:3006/#/workspace/agent`
- [ ] Vite HMR 重新加载（保存 AppShell.vue 后应自动）
- [ ] 点"新建" → 新会话出现在侧栏 AND ChatWindow 加载该会话
- [ ] 点历史会话 → Tab 加一项 + ChatWindow 显示历史消息
- [ ] 在 ChatInput 输入消息发送 → 看到 SSE 流式回包
- [ ] 流式回包中点"停止" → 流立刻停
- [ ] 置顶/重命名/删除会话 → 侧栏列表 + Tab 同步更新
- [ ] 点顶栏 4 个按钮（文件/模型/技能/插件）→ 右侧抽屉正确切换

### 5.2 E2E 自动化（可选，但建议）
- `apps/web/tests/e2e/files-routes.spec.ts` 已经为后端 files 端点写了 smoke（d1e4100）
- 新加 `apps/web/tests/e2e/appshell-interaction.spec.ts`：
  - login → /workspace/agent
  - 创建会话 → 断言侧栏出现
  - 发消息 → 断言 ChatWindow 出现新消息（用 SSE mock）
  - 截图保存

### 5.3 切路由（**所有上面 5.1/5.2 通过后**才做）
- 备份当前 `index.vue` → `index.old.vue`（**这一步之前的会话已经做过，记得把那个 index.old.vue 删掉**——已经备份过了）
- 把 `index.vue` 替换为薄壳：`<template><AppShell /></template>`
- 跑 `pnpm tsc + pnpm lint + pnpm vitest`，全过才提交

## 6. 已知的小坑（CLAUDE.md 已记，本次再次验证）

- `apps/dashboard/CLAUDE.md` 第 25 行：切换会话必须清 `messages` + `isTyping`，否则旧消息残留
- ChatWindow `:key="sessionId"` 强制重建是**正确做法**（已写在 AppShell 里）
- SSE 三层防护（released WeakSet / capturedWrapper / cap WeakSet）已在 `useEventStream.ts` 完整实现
- MarkdownBody 的 DOMPurify + safeUrl 二次校验已实现

## 7. 性能基线（可对比下次改进）

- 单元测试：**75 通过**（核心 composable + 关键组件交互）
- vue-tsc：0 错
- eslint：0 错
- 代码量：14 组件 ~3500 行 + 5 composable ~1400 行 + AppShell/types/styles ~900 行 + 后端 3 文件 ~335 行 ≈ **6100 行**

## 8. 如果遇到新问题

1. **新建会话不出现**：检查 `useSessionList.createSession` 返回结构，AppShell 需不需要直接调而不是 emit
2. **ChatWindow 空白**：检查 `useEventStream` 的 connection 时机（onMounted? watch sessionId?）+ 历史消息 API
3. **TabBar 错位**：检查 `tabs` ref 是否在 handleSelect/handleDelete/handleTabClose 里正确维护
4. **右侧抽屉不显示**：检查 `activePanel` ref 的 v-if 条件 + ConfigPanel 子组件 props

## 9. 不要做（YAGNI）

- ❌ 不要重写 AppShell — 现有结构对，先精读 + 修交互
- ❌ 不要新建 `composables/useAppShell.ts` — 现有 handleSelect 等就够
- ❌ 不要改后端 files 端点 — d1e4100 已合并且覆盖边界场景
- ❌ 不要换 Element Plus 主题色 — 基线 `--wb-*` 变量已定义
- ❌ 不要把 `index.old.vue` 当唯一回退 — 它只是参考

## 10. 一行话总结

**代码 100% 写完，但集成 0% 验证。下次开工先精读 §4 五个文件再动 AppShell。**