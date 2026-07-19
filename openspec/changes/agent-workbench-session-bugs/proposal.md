# 提案：Agent 工作台会话管理 3 个回归 Bug

> change: agent-workbench-session-bugs
> 类型: hotfix workflow
> 日期: 2026-07-19

## 1. 为什么做

M3 Vue3 工作台交付后(`apps/dashboard/src/views/agent-workbench/`),用户日常使用
中发现 3 个高优先级回归 bug:

1. **新建第二个会话列表里看不到**——连续创建两个会话时,第一个会话从侧栏消失,
   只显示最新一个;关闭再开同样丢失。
2. **tab 切换历史消息消失**——点击其他 tab 或新建第二个 tab,切换过去后历史
   聊天内容空白,只剩 SSE 实时推来的新消息。
3. **刷新页面所有会话没了**——侧栏会话列表、当前选中的 tab、所有打开的多 tab
   在浏览器刷新后全部丢失,等同于"从未使用过"。

3 个 bug 都属于"已有能力的回归修复",**不新增 capability、不引入新公共 API
schema**(Bug 2 新增后端 GET 端点属于"补齐已有 capability 缺失能力",不算
public API 扩展),可走 hotfix workflow。

## 2. 根因速览

| Bug | 根因 |
|-----|------|
| 1   | `apps/dashboard/src/views/agent-workbench/composables/useSessionList.ts:127-148` 的 `create()`:`await load(false)` 整体覆盖 `sessions.value`,把之前乐观 push 的会话挤掉;后端 listSessions 走 Prisma(见 `apps/web/app/api/agent/sessions/route.ts:39`),新建空会话是否立即可见依赖 Prisma `create` 同步性,旧实现逻辑错误地假设它总是同步可见 |
| 2   | `apps/dashboard/src/views/agent-workbench/components/ChatWindow.vue:28-29` 调的 `useAgentSession` 只维护 SSE 实时流,`watch(sessionId)` 触发 `resetSession()` 但**不重新拉历史**。更深层:`apps/web/app/api/agent/[id]/` 下无 messages 端点(只有 events/files/share,见 `apps/dashboard/src/api/agent.ts:57` 注释),后端从未暴露"按 session 拉历史消息"的 API |
| 3   | `AppShell.vue` / `SessionSidebar` 全是 in-memory `ref`,无持久化;`useSessionList.load(true)` 只在 SessionSidebar 初次挂载时调一次。Bug 1 修了后,刷新 + 重新 load 能恢复侧栏列表,但 `currentSessionId` 和 `tabs` 仍会丢 |

## 3. 修复目标

### Bug 1 — 列表乐观 push 被覆盖
- `useSessionList.create()` 改用 Map-by-id 合并:load 后端列表 → 保留乐观 push 项(以前 push 但后端尚未返回的) → 合并去重
- `load()` 自身也要从"整体替换"改为"按 id 合并",保留乐观项
- 新增单元测试覆盖"连续两次新建会话"场景

### Bug 2 — tab 切换历史消息消失
- **后端**新增 `GET /api/agent/[id]/messages` 端点:从 session `.jsonl` 文件读历史消息,返 `{ messages: AgentMessage[] }`,分页参数 `?limit=N&before=<timestamp>`
- **前端** `apps/dashboard/src/api/agent.ts` 新增 `fetchSessionMessages(sessionId)`
- **前端** `useAgentSession` 新增 `fetchHistory(sessionId)`,在 `watch(sessionId)` 触发 `resetSession()` 后立即调,merge 进 messages
- 新增 E2E 测试覆盖"新建会话 → 切回 → 历史完整"

### Bug 3 — 刷新后丢失
- `AppShell` `onMounted` 调 `useSessionList.load(true)`,从后端恢复列表
- `currentSessionId` 从 `localStorage['wb:lastSessionId']` 恢复(若后端 listSessions 能查到对应 session)
- `tabs` 不持久化(产品决策:刷新后只恢复当前会话一个 tab,简洁)
- 暴露 `localStorage` 清理开关(测试用)

## 4. 影响面

- **前端**(`apps/dashboard`):
  - `src/views/agent-workbench/composables/useSessionList.ts`(改)
  - `src/views/agent-workbench/composables/useAgentSession.ts`(改)
  - `src/views/agent-workbench/components/ChatWindow.vue`(改)
  - `src/views/agent-workbench/AppShell.vue`(改)
  - `src/api/agent.ts`(新增 `fetchSessionMessages`)
  - `src/views/agent-workbench/composables/useAgentSession.test.ts`(新增用例)
  - `src/views/agent-workbench/composables/useSessionList.test.ts`(新增用例,新增文件)

- **后端**(`apps/web`):
  - `app/api/agent/[id]/messages/route.ts`(新增)

- **依赖**:无新增 npm 包;后端用现成 `apps/web/lib/session-reader.ts` 读 .jsonl。

## 5. 验收标准

- [ ] 连续 3 次新建会话后,侧栏 3 个全部可见
- [ ] tab 切换:会话 A 写消息 → 切到会话 B → 再切回 A,A 历史完整
- [ ] 刷新页面后,侧栏列表恢复,当前选中的会话(若有)恢复选中
- [ ] 单测全绿,`useSessionList` / `useAgentSession` 覆盖率 ≥ 80%
- [ ] E2E:`pnpm --filter @ai-agent-workshop/dashboard test:e2e` 全绿
- [ ] 后端 `curl /api/agent/[id]/messages` 返回正确 JSON 形态