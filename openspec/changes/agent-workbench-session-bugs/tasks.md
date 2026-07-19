# 任务清单：Agent 工作台会话管理 Bug 修复

> change: agent-workbench-session-bugs
> 类型: hotfix workflow
> 日期: 2026-07-19

---

## 0. 前置

- [ ] T0.1 跑基线门禁:`pnpm install` + `pnpm --filter @ai-agent-workshop/web build` + `pnpm --filter @ai-agent-workshop/dashboard build`(确认仓库没坏)

## 1. Bug 1 — useSessionList 列表乐观合并

- [x] T1.1 改 `composables/useSessionList.ts`:
  - `load()` 不再整体覆盖;改用 Map<id, AgentSession> 合并,保留乐观项
  - `create()` 把新建 sid 加入 `optimisticIds: Set<string>` 跟踪
  - `delete` 成功后清掉对应 optimisticId
- [x] T1.2 新增 `composables/useSessionList.test.ts`:
  - 用例 1:"load 后 sessions.value 含本地乐观项"
  - 用例 2:"连续 create 3 次后 sessions.value.length = 3"
  - 用例 3:"rename 失败时 title 回滚"

## 2. Bug 2 — tab 切换历史消息

- [x] T2.1 新增后端 `apps/web/app/api/agent/[id]/messages/route.ts`:
  - GET handler,query `limit`/`before`
  - 走 `resolveSessionPath` + `getSessionEntries` + `buildSessionContext`
  - 解析每行为 AgentMessage 形状
  - 鉴权走 `assertCanReadSessionScoped`
- [x] T2.2 新增前端 `api/agent.ts`:`fetchSessionMessages(sessionId, opts?)`
- [x] T2.3 改 `composables/useEventStream.ts`:暴露 `prependMessages(history)`,按 id 去重
- [x] T2.4 改 `composables/useAgentSession.ts`:
  - 加 `fetchHistorySeq` 防 race
  - `watch(sessionId)` 触发顺序:resetSession → fetchHistory → prepend
  - 失败静默
- [x] T2.5 扩 `composables/useAgentSession.test.ts`:
  - 用例 1:"切换 sessionId 后 fetchHistory 被调" ✅
  - 用例 2:"快速切换两次,后到达的响应不覆盖先到达的" ✅
  - 用例 3:"fetchHistory 失败静默" ✅

## 3. Bug 3 — 刷新后恢复

- [x] T3.1 改 `AppShell.vue`:
  - `onMounted` 调 `useSessionList.load(true)` 拉列表(独立实例,仅读)
  - 读 `localStorage['wb:lastSessionId']` 恢复 currentSessionId(后端查得到才恢复)
  - `watch(currentSessionId)` 写回 localStorage(异常静默)
- [ ] T3.2 userStore watch 登录态变化时清理 `wb:lastSessionId`(本次跳过,登录态变更由 auth 流处理)

## 4. 测试与验证

- [ ] T4.1 `pnpm --filter @ai-agent-workshop/dashboard test` 全绿,`useSessionList`/`useAgentSession` 覆盖率 ≥ 80%
- [ ] T4.2 `pnpm --filter @ai-agent-workshop/web build` 通过(后端端点类型检查)
- [ ] T4.3 `pnpm --filter @ai-agent-workshop/dashboard build` 通过(前端编译)
- [ ] T4.4 E2E(Playwright):`新建 → 写消息 → 切走 → 切回历史完整` 跑通
- [ ] T4.5 手动验收 3 个 bug 场景

## 5. 文档与收尾

- [ ] T5.1 更新 `apps/dashboard/CLAUDE.md` 已知陷阱段:补充"乐观合并"和"历史 fetch"两个新陷阱
- [ ] T5.2 commit:`fix(dashboard): merge optimistic sessions to fix list overwrite`
- [ ] T5.3 commit:`fix(web): add GET /api/agent/[id]/messages for history`
- [ ] T5.4 commit:`feat(dashboard): load history on session switch + persist lastSessionId`

---

## 阶段依赖

```
T0 → T1 → T2 → T3 → T4 → T5
(T1 和 T2 可并行;T3 依赖 T1,因为 currentSessionId 恢复依赖 load 成功)
```