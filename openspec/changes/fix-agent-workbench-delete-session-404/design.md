## Context

Vue dashboard（`apps/dashboard`，用户入口，"工作区 / Agent 工作台"）在删除会话时返回 HTTP 404。前端调用 `apps/dashboard/src/api/agent.ts:113` 的 `deleteSession(sessionId)` → `httpClient.del(/api/sessions/${encodeURIComponent(sessionId)})`；后端 `apps/web/app/api/sessions/[id]/route.ts` 已存在并含有 `DELETE` handler。404 的真实根因尚未落地复现，候选区间在 3 处：

1. 前端 `httpClient.del` 实际发出的 method/URL 与后端 handler 不匹配（例如 baseURL 拼错、proxy rewrite 把 `DELETE` 转成 `GET`）。
2. 后端中间件把未授权或方法不允许的请求改写为 404（`middleware.ts` 命中鉴权链 + Edge runtime）。
3. Next.js App Router 的路由文件虽存在，但导出名拼写/handler 形态（如非 `async function DELETE`）导致 routes 实际未注册。

CLAUDE.md 已提醒：React 端的 `apps/web/components/SessionSidebar.tsx` 与 Vue 端是**平行存在**的两套实现，本次 bug 仅发生于 Vue 端，React 端的处理路径只能用作参考不能直接套用。

## Goals / Non-Goals

**Goals:**
- 在用户点击删除按钮后，请求返回 2xx，会话从列表中消失（Vue `useSessionList` 调 `loadSessions` 刷新）。
- 加一个集成测试覆盖 `DELETE /api/sessions/:id` 全链路（包含用户登录态），阻断该类 404 再次发生。

**Non-Goals:**
- 不改 DELETE API 契约。
- 不动 React 端 `apps/web/components/SessionSidebar.tsx`（用户路径不走它）。
- 不动鉴权 schema、Prisma schema、事件流。
- 不引入新依赖。

## Decisions

1. **精确定位策略**：在改源码前，先用真实 cookie + 已登录 session 直接对 dev server 调 `DELETE /api/sessions/<id>`，抓出 method、URL、response headers + body；这是排查中间件 / proxy 改写的最直接证据，比仅靠 Read 代码推断可靠。
2. **TDD RED 先行**：先在 `apps/web/tests/integration/` 添加一个 DELETE session 的集成测试和 `apps/dashboard` 侧的 vitest/RTL 单测断言 `deleteSession` 实际调用形态，二者都先红。
3. **修复范围**：若根因在前端 → 仅动 `apps/dashboard/src/api/agent.ts` 或其 httpClient 包装；若根因在后端中间件/路由注册 → 动 `apps/web/app/api/sessions/[id]/route.ts` 或 `apps/web/middleware.ts`。
4. **失败测试必备**：覆盖鉴权失败（401）、会话不存在（404）、成功（200）三条路径以便 guard 复现。

## Risks / Trade-offs

- 中间件拦截型 404 不容易被集成测试捕获（middleware 在 route handler 之前），需要 e2e 或真实 cookie 复现。
- 后端 Next.js dev server 启动慢，复现阶段耗时可能长；尽量复用已启动实例。
- 如根因发现是 api 路径不匹配（不是 runtime 问题），可能涉及前几个月已合并的多套 URL 约定，需要保持改动最小、只改我们关心的。

## Open Questions（Phase 3 假说收敛后定稿）

### 单一可证伪根因假说（Hypothesis）

> **H1**：在用户的 dev server 当前运行实例里，Next.js 把 `DELETE /api/sessions/<id>` 当作"未注册路由"处理，返回 next 默认 404 HTML 页面；axios `error.message` = 'Request failed with status code 404' 被 Vue 前端原样弹出。
>
> **支撑证据**：
> 1. `apps/web/app/api/sessions/[id]/route.ts:279` `export async function DELETE` 真实存在。
> 2. Vue 端 `formatError` 在 server 返 `{error:"..."}` 时会显示 serverMsg，但截图里是 axios 默认 message，说明**后端回的不是 JSON `{error}` 而是 HTML**——典型 Next.js "未注册路由" 默认响应。
> 3. `git log` 最末 commit `2fde6bc chore(web): pin dev script to webpack to avoid Next 16 Turbopack workspace-root error` 表明已知 Next 16 + turbopack + monorepo 工作区根解析有问题；同类路由注册问题可能仍然存在。
> 4. middleware matcher 不拦截后端 404 → 因为 404 在 route 注册前已结束。

> **证伪方案**：在 apps/web 写一个集成测试 import `apps/web/app/api/sessions/[id]/route.ts` 的 `DELETE` handler 直接调用，若它正常返回 200，则 H1 部分成立（即 handler 自身是好的，问题在 dev server 启动层/路由注册 / turbopack），修改目标转向 next.config.ts / dev script / dev 启动 port 配置。

### 备选根因（必排除）

- **A. sessionId 在磁盘上不存在**：route handler 仍返回 404 但 body 是 `{error:"Session not found"}`。可证伪：formatError 取 serverMsg 失败条件不存在（实则只要检查 e.response.data 是 string 还是 object 即可判定）。
- **B. CSRF / cookie 丢失**：截图用户能 GET 列表 → 排除。
- **C. Vite proxy 改写**：read /Users/xiejava/.claude/skills/... 已确认无 bypass/rewrite → 排除。

### Phase 1 收集证据归档
- 前端：`apps/dashboard/src/utils/http/index.ts:58` `baseURL:'', method:'DELETE'` ✓
- 前端：`apps/dashboard/src/api/agent.ts:113-117` `del('/api/sessions/${id}')` ✓
- 前端：`apps/dashboard/src/views/agent-workbench/components/SessionSidebar.vue:121-124` `handleDelete → deleteSession → emit` ✓
- 前端：`apps/dashboard/src/views/agent-workbench/composables/useSessionList.ts:193-206` `deleteSess` + `formatError` ✓
- vite：`apps/dashboard/vite.config.ts:37-42` `/api` proxy → `http://127.0.0.1:30141`，`changeOrigin:true` ✓
- middleware：`apps/web/middleware.ts:22-37` matcher 两层，`/api/sessions/[id]` 必被 jwt 拦截，不发 404 ✓
- 后端：`apps/web/app/api/sessions/[id]/route.ts:279-327` `DELETE handler` 真实存在，唯一发 404 的是 `resolveSessionPath(id) → null`（行 290-292）✓
- routes 索引：`apps/web/app/api/sessions/[id]/{context,state,export,entries/[entryId]/thinking}/route.ts` 互不冲突 ✓
- 其它：`apps/web/app/api/agent/sessions/route.ts` 单独 namespace ✓
