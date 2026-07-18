# apps/web

`apps/web` 是一个 Next.js (App Router) 应用。在 monorepo 里它扮演**双重角色**——这是阅读任何代码之前必须知道的事：

## 角色

| 角色 | 说明 |
|------|------|
| **Vue3 后端聚合层** | `apps/dashboard` 经 Vite proxy `/api` → `apps/web` 消费 API。Route handlers (`app/api/**/route.ts`) 是 Vue 的事实后端。 |
| **开发/参考界面** | 仍有一组 React UI（`components/AppShell.tsx` + `hooks/useAgentSession.ts` 等）面向浏览器。**保留供开发与设计参考**，不是用户入口。 |

依据：`docs/superpowers/specs/2026-07-16-m3-vue3-workbench-design.md` §1 第 31 行。

## 用户从哪个入口来

- 用户截图/描述提到 "Agent 工作台""数字员工""工作区" 等 → **Vue 端**（`apps/dashboard`），**不要**在 apps/web 改。
- 用户提到 React/Next.js 特征、URL 端口 30141（web 默认 dev 端口） → 才来这里。

## 改代码前的判断

1. **如果改动属于路由 / API / SSE / Prisma / 鉴权** —— 这是 Vue 后端聚合的活，可以改。
2. **如果改动属于 React UI（components / hooks / app/[locale] 下页面）** —— 这是开发/参考界面，bug 仍然要修，但**用户可见行为不应从这里验证**（用户用的是 Vue）。改 React UI 之前先确认 Vue 是否也有相同/类似代码要走类似修复路径。
3. **不要**因为 React 组件里发现 bug 就推断 "前端已经迁移走、这段死了" —— 它没死。

## 与 Vue 端的接口契约

- API 路径遵循 `apps/web/app/api/**/route.ts`。
- SSE 端点：`/api/agent/[id]/events`（被 Vue 用 `EventSource` 消费）。
- 401 走 `POST /api/auth/refresh` 自动续 token（Vue 端处理）。
- 所有 API 仍由服务端强制鉴权（middleware），前端隐藏不等于后端放行。

## 已知陷阱

- `useAgentSession` 的"挂载时加载会话" effect 依赖空数组 `[]`，仅在 `<ChatWindow>` 挂载跑一次。`<ChatWindow key={sessionKey}>` 依赖 `AppShell.tsx` 显式 bump `sessionKey` 来重建——漏 bump 会导致会话切换不刷新消息。修改任何会话切换回调时，确认它 bump 了 `sessionKey`。