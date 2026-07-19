## Why

`apps/dashboard` Vue 端 Agent 工作台在「工作区 / Agent 工作台」删除会话时返回 HTTP 404，前端弹"操作失败 Request failed with status code 404"，用户无法删除任何会话。后端路由文件 `apps/web/app/api/sessions/[id]/route.ts` 确认存在 `DELETE` handler；前端调用 `apps/dashboard/src/api/agent.ts:113-117` 的 `deleteSession(sessionId)` 形如 `httpClient.del("/api/sessions/${id}")`。问题定位区间必然在前端 httpClient 的 URL/方法形态、或后端中间件层（鉴权、proxy、路由匹配）。该 bug 让会话列表不断累积，破坏 Agent 工作台的核心交互。

## What Changes

- 修复「Vue dashboard 删除会话」请求使后端返回 2xx 且会话从列表中消失。
- 不新增 capability、不改 API 契约、不改 schema、不引入新依赖；**不**算 **BREAKING**。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无（不修改 spec 级 REQUIREMENT，仅修复运行时行为，未触动任何 `openspec/specs/<name>/spec.md` 的验收场景）。

## Impact

- 受影响代码（待修复时收敛到 ≤ 3 个文件，命中即升级 full）：
  - `apps/dashboard/src/api/agent.ts`（前端 `deleteSession` 调用形态）
  - `apps/web/app/api/sessions/[id]/route.ts` 或中间件（后端 DELETE handler / 鉴权）
  - 必要时 `apps/dashboard/src/views/agent-workbench/composables/useSessionList.ts` 错误展示
- 受影响 API：`DELETE /api/sessions/:id`（契约不变，仅修复运行时）。
- 受影响测试：需新增 integration 测试覆盖 2xx 路径与错误回滚路径。
- 不影响鉴权/Prisma schema、不影响事件流、不影响 React `apps/web` 引用层（CLAUDE.md 角色说明 React UI 仅供开发参考，用户入口是 Vue）。
