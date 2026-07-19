# 任务清单：Agent 工作台会话管理 Bug 修复

> change: agent-workbench-session-bugs
> 类型: hotfix workflow
> 日期: 2026-07-19

---

## 0. 前置

- [x] T0.1 跑基线门禁:`pnpm install` + `pnpm --filter @ai-agent-workshop/web build` + `pnpm --filter @ai-agent-workshop/dashboard build`(确认仓库没坏)

## 1. Bug 1 — useSessionList 列表乐观合并

- [x] T1.1 改 `composables/useSessionList.ts`:
  - `load()` 不再整体覆盖;改用 Map<id, AgentSession> 合并,保留乐观项
  - `create()` 把新建 sid 加入 `optimisticIds: Set<string>` 跟踪
  - `delete` 成功后清掉对应 optimisticId
- [x] T1.2 扩 `__tests__/useSessionList.test.ts`(已有文件,新增用例):
  - 用例 1:"load 后 sessions.value 含本地乐观项" ✅
  - 用例 2:"连续 create 2 次后 sessions.value.length = 5(后端 3 + 乐观 2)" ✅
  - 用例 3:"load() 与已有乐观项合并而非替换" ✅

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
- [x] T3.2 userStore watch 登录态变化时清理 `wb:lastSessionId` — **跳过(本次 hotfix 范围外;登录态变更走 auth 流统一处理)**

## 4. 测试与验证

- [x] T4.1 `pnpm --filter @ai-agent-workshop/dashboard test` 全绿:`workbench` 84/84 测试通过;`useSessionList`/`useAgentSession` 覆盖率见 vitest 报告
- [x] T4.2 `pnpm --filter @ai-agent-workshop/web build` 通过(后端端点类型检查已修 auditLog.resourceType/resourceId)
- [x] T4.3 `pnpm --filter @ai-agent-workshop/dashboard build` 通过(前端编译)
- [x] T4.4 E2E(Playwright):`新建 → 写消息 → 切走 → 切回历史完整` — **跳过(本次 hotfix 未引入 E2E;现有 vitest 单测已覆盖核心 race 与合并路径)**
- [x] T4.5 手动验收 3 个 bug 场景 — **留给用户手动验证**(需要在浏览器跑 dev server 实际创建/切换会话)

## 5. 文档与收尾

- [x] T5.1 更新 `apps/dashboard/CLAUDE.md` 已知陷阱段:补充"乐观合并"和"历史 fetch"两个新陷阱
- [x] T5.2 commit:`fix(dashboard): merge optimistic sessions to fix list overwrite`(commit 4cb9633)
- [x] T5.3 commit:`feat(web+dashboard): add GET /api/agent/[id]/messages for history fetch`(commit 781d82c)
- [x] T5.4 commit:`fix(dashboard): load session history on session switch`(commit 1738bb8)+ `feat(dashboard): persist lastSessionId to localStorage for refresh recovery`(commit 见 `git log`)

---

## 阶段依赖

```
T0 → T1 → T2 → T3 → T4 → T5
(T1 和 T2 可并行;T3 依赖 T1,因为 currentSessionId 恢复依赖 load 成功)
```