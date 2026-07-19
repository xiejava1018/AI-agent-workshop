# 设计：Agent 工作台会话管理 Bug 修复

> change: agent-workbench-session-bugs
> 类型: hotfix workflow
> 日期: 2026-07-19

## 1. 修复方案

### Bug 1 — useSessionList.create / load 合并

**思路**:从"乐观 push 单条 + load 整体覆盖"改为"双向合并"。

`load(showLoading)`:
- 不再 `sessions.value = extractSessions(resp)`
- 改用:从后端列表构造 `Map<id, AgentSession>`,把当前 `sessions.value` 中**乐观项**(无对应后端条目,或 updatedAt 为本地时间)保留 → 输出数组(乐观项在前 + 后端项在后,按 updatedAt desc)

`create(userId)`:
- 先调 `createSession` 拿到 sid
- 仍立即 push 乐观项(标识:`s.createdAt === new Date().toISOString()` 过于脆弱,改用 WeakSet `optimisticIds: Set<string>` 标记)
- `await load(false)` 后,乐观项仍保留(因为 load 走新的合并逻辑)
- 乐观项的 updatedAt 由后续用户操作(`sendMessage`)触发后端更新,自然替换

具体实现:在 composable 内维护 `private optimisticIds = new Set<string>()`,`load()` 合并时检查:若 `sessions.value` 中的项 id 在 `optimisticIds` 中,**永远保留**(即便后端有更新也要先保留,等用户首次发消息或 5s 后台任务拉新列表时再清掉)。

### Bug 2 — 历史消息加载

**后端** `apps/web/app/api/agent/[id]/messages/route.ts`:
- GET,query: `?limit=50&before=<iso8601>`
- 读 session `.jsonl` 文件(走 `apps/web/lib/session-reader.ts` 的 `resolveSessionPath` + 文件流)
- 解析每行 JSON,转 `AgentMessage` 形态(对齐 `apps/dashboard/src/views/agent-workbench/types.ts:42`)
- 返 `{ messages: AgentMessage[], hasMore: boolean }`
- 鉴权:复用 `assertCanReadSessionScoped`(同 listSessions)

**前端** `apps/dashboard/src/api/agent.ts` 新增 `fetchSessionMessages(sessionId, opts?)`:
```ts
export const fetchSessionMessages = (sessionId: string, opts?: { limit?: number; before?: string }) =>
  httpClient.get<Http.BaseResponse<{ messages: AgentMessage[]; hasMore: boolean }>>({
    url: `${PREFIX}/${encodeURIComponent(sessionId)}/messages`,
    params: opts,
    keepFullResponse: true
  })
```

**`useAgentSession`**:
- 加 `private fetchHistoryId: string | null = null`,记录当前正在拉的 sessionId(防止 race)
- `watch(sessionId)` 触发顺序:
  1. `resetSession()`(清空本地)
  2. `fetchHistoryId = newId`
  3. `fetchSessionMessages(newId).then(({ messages }) => { if (fetchHistoryId === newId) mergeIntoMessages(messages) })`
- merge 时按 `messageId` 去重,SSE 实时事件仍按原逻辑走(append 到 messageId 对应消息)

### Bug 3 — 刷新恢复

**`AppShell.vue`**:
- `onMounted` 调 `useSessionList.load(true)` 恢复侧栏
- 读 `localStorage.getItem('wb:lastSessionId')`,若非空 + 后端列表查得到(`find(s => s.id === lastId)`) → `currentSessionId.value = lastId`
- watch `currentSessionId` 写回 localStorage
- tabs **不持久化**(产品决策简化)
- 提供 `localStorage.removeItem('wb:lastSessionId')` 兜底,登录态变更时由 userStore watch 清掉

## 2. 数据流(简版)

### 列表合并

```
load() 后端返 [A, C]
sessions.value 本地 [A', B]    ← B 是乐观 push,B 还没真发消息
optimisticIds = {B}

合并 Map:
  A ← 后端(覆盖 A')
  B ← 本地(乐观,保留)
  C ← 后端(新)
输出 [B, C, A](按 updatedAt desc)
```

### tab 切换历史

```
handleSelect(B)
  currentSessionId = B
  ChatWindow :key="B" 重建
  useAgentSession 重置
  watch(sessionId) 触发:
    resetSession()
    fetchSessionMessages(B)
      → 后端 GET /api/agent/B/messages
      → 返 [{role:'user',...}, {role:'assistant',...}, ...]
      → mergeIntoMessages()(按 messageId 去重)
```

## 3. 错误处理

- `fetchSessionMessages` 失败 → 静默不弹通知(空 messages 不影响新消息流);`error` ref 仍可读
- 后端 messages 端点鉴权失败 → 同 listSessions,401/403 走 vite proxy 自动续 token
- 乐观 push 的 sessionId 若后端 listSessions 一直不返(可能 sid 被拒)→ 5s 后台清掉(避免无限保留)

## 4. 测试覆盖

- **`useSessionList.test.ts`**(新增文件):
  - "连续 3 次 create 后 sessions.value 长度 = 3"
  - "load 后乐观项保留"
  - "rename 乐观更新失败回滚"
- **`useAgentSession.test.ts`**(扩):
  - "切换 sessionId 后 messages 被 fetchHistory 填回"
  - "切换未完成时再次切换不 race"
- **E2E**:`apps/dashboard` Playwright
  - "新建 → 写消息 → 切走 → 切回历史完整"

## 5. 风险与回滚

- 风险 1:后端 messages 端点解析 .jsonl 格式若与 AgentMessage 形状不一致 → 单元测试覆盖
- 风险 2:乐观 push 5s 后台清理若和用户高频操作 race → 简化方案:不做 5s 清理,只用 `optimisticIds` 标识,后端真正返回时再清(实测 listSessions 已能命中新建空 session,见后端实现)
- 回滚:每个 commit 独立,`git revert` 单个 commit 即可

## 6. Implementation Divergence(2026-07-19 verify 记录)

verify 阶段发现以下与原文 § 1 (Bug 2) 不符的偏差,经用户决策(选项 A)接受并在此留痕:

| 维度 | design 原写 | 实际实现 | 原因 |
|------|-----------|---------|------|
| Bug 2 历史拉取的端点 | 新增 `GET /api/agent/[id]/messages`(T2.1) | **复用** Next.js 已有的 `GET /api/sessions/[id]` | (a) 端口 30141 的 React 参考界面一直用 `/api/sessions/[id]` 拉历史,Vue 端走同一端点避免双实现;(b) 该路由由 `SessionManager.open` + `buildSessionContext` 读 .jsonl,产物已经包含 UI 需要的完整 messages 分支路径,Vue 直接喂入 `useAgentSession.fetchHistory` 即可;(c) 真实根因是响应形状解析 bug(`res.data?.context` 应为 `res.context`),改端点不解决该 bug |
| `apps/web/app/api/agent/[id]/messages/route.ts`(T2.1) | 应作为 Vue 端 fetchSessionMessages 的目标 | 文件确实新增(`38f2...` 期间),但 **当前没有 Vue 消费者** —— 暂时为未使用的端点 |

接受的代价:
1. design 制品与实现不完全对齐,后续归档时该 design doc 会被标记 `superseded-by-main-spec`,新 spec 应反映"实际用 `/api/sessions/[id]`"的事实。
2. `/api/agent/[id]/messages` 成为未消费的端点 —— 建议后续 change 删除(或保留作通用化后端能力,但 Vue 端不用)。

未触动:
- `useAgentSession.fetchHistory` 的 race 防护 / merge 顺序与 design § 1 (Bug 2) 一致。
- 其他设计决策(乐观合并 localStorage 持久化、消息按 messageId 索引、append-only 实时流)未变。