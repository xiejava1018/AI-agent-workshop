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