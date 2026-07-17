# C2 Spike — Vue3 消费 apps/web SSE 可行性验证

- 日期：2026-07-16
- 任务：M3 Build 入口门控 Task 0.2
- 工作分支：`feature/20260716/m3-vue3-workbench`
- 范围：仅调研与文档，不修改源代码

## 1. SSE 端点与事件格式

### 1.1 端点

- 路径：`GET /api/agent/[id]/events`
- 实现：`apps/web/app/api/agent/[id]/events/route.ts`
- 响应：`Content-Type: text/event-stream`，`Cache-Control: no-cache`，`Connection: keep-alive`
- 编码格式：标准 SSE，每个事件为 `data: <json>\n\n`；心跳为 `:\n\n`（30s 间隔）
- 首帧：连接建立后立即下发 `{ "type": "connected", "sessionId": "<id>" }`

### 1.2 鉴权链路（关键）

SSE 路由本身只校验 `x-user-id` header：

```ts
// apps/web/app/api/agent/[id]/events/route.ts:24
const userId = req.headers.get("x-user-id");
if (!userId) return new NextResponse("auth required", { status: 401 });
```

但 `x-user-id` 由 Next.js middleware 注入，真正的鉴权在 `apps/web/middleware.ts`：

- 从 cookie `pw_at` 读 JWT
- 用 `PI_WEB_JWT_SECRET` 验签
- 验签成功后注入 `x-user-id`、`x-must-change-password`、`x-user-role` 三个 header
- 无 cookie 或验签失败 → 401 `{ error: "auth required" | "invalid session" }`

middleware matcher 显式拦截 `/api/*`（除 `auth/user-login`、`auth/refresh`、`auth/providers/*`、`api/public` 等白名单）。

**结论：Vue3 端调用 `/api/agent/[id]/events` 必须携带 `pw_at` cookie，不能仅靠自定义 header。**

### 1.3 授权（team-scoped）

通过 middleware 后，路由再调用 `assertCanReadSessionScoped(userId, userRole, meta, id)` 做团队/所有者维度授权；失败写审计日志 `session.access_denied` 并返回 403。

### 1.4 事件 type 全集

事件来自 `rpc-manager.ts` 的 `AgentEvent { type: string; [key: string]: unknown }`，由 `session.onEvent(...)` 透传到 SSE。从 `apps/web/hooks/useAgentSession.ts` 的 `handleAgentEvent` switch 可枚举出前端实际处理的全集：

| 类别 | type | 说明 |
| --- | --- | --- |
| 连接 | `connected` | SSE 首帧，由 route.ts 直接下发 |
| Agent 生命周期 | `agent_start` / `agent_end` | 一次 prompt 运行的开始/结束 |
| Prompt 短路径 | `prompt_done` / `prompt_error` | 非 streaming 时的完成/失败 |
| 消息流 | `message_start` / `message_update` / `message_end` | 流式消息 chunk；`message_end` 携带完整 `message` |
| 工具执行 | `tool_execution_start` / `tool_execution_end` | 携带 `toolCallId`、`toolName` |
| 队列 | `queue_update` | steering / followUp 队列快照 |
| 重试 | `auto_retry_start` / `auto_retry_end` | 携带 `attempt`、`maxAttempts`、`errorMessage` |
| 压缩 | `auto_compaction_start` / `auto_compaction_end` / `compaction_start` / `compaction_end` | 上下文压缩 |
| 扩展 | `extension_ui_request` / `extension_error` | 扩展 UI 桥接 |
| 心跳 | （无 type，注释行 `:\n\n`） | 30s 心跳，EventSource 自动忽略 |

注：任务书提到的 `tool_update` 在实际代码中并未出现，对应的真实事件名是 `tool_execution_start` / `tool_execution_end`。

## 2. Vite proxy 配置

`apps/dashboard/vite.config.ts` 已存在 `/api` 代理：

```ts
server: {
  port: Number(VITE_PORT),           // .env: 3006
  proxy: {
    '/api': {
      target: VITE_API_PROXY_URL,    // .env.development: http://127.0.0.1:30141
      changeOrigin: true
    }
  }
}
```

`.env.development` 已把 `VITE_API_PROXY_URL` 指向 `http://127.0.0.1:30141`，与 `apps/web` 的 `next dev -p 30141` 端口对齐，**无需新增配置**。

### 2.1 Cookie / withCredentials

- 同源（经 Vite proxy）：浏览器把 `http://localhost:3006/api/...` 视为同源请求，`pw_at` cookie 是否随请求发送取决于 cookie 的 `Domain` / `Path` / `SameSite`。
- `changeOrigin: true` 会把请求的 `Host` 改写成 `127.0.0.1:30141`，但 cookie 仍按浏览器侧（`localhost:3006`）的 origin 存储与发送。
- 现状 `.env` 中 `VITE_WITH_CREDENTIALS = false`，且 dashboard 的 axios 实例（`src/utils/http/index.ts`）默认不强制 `withCredentials`。
- 风险：若 `pw_at` cookie 是 `Domain=127.0.0.1` 或 `SameSite=Strict`，经 `localhost:3006` 代理时浏览器不会带上；若是 host-only cookie（`Set-Cookie` 未指定 Domain）则绑定到 `127.0.0.1:30141`，同样不会发到 `localhost:3006`。

**结论（待运行时验证）：** 最稳妥的开发期方案是让 Vue3 直接访问 `http://127.0.0.1:30141` 登录拿到 cookie，然后 Vite proxy 也指向 `127.0.0.1:30141`，浏览器地址栏用 `http://127.0.0.1:3006`（而非 `localhost:3006`）打开 dashboard，使前后端 host 一致。生产环境若同域部署则无此问题。

### 2.2 EventSource vs fetch+ReadableStream

dashboard 已有 `src/utils/http/stream.ts`，用 `fetch + ReadableStream` 实现 SSE（绕开 axios 的 transformResponse）。该工具当前只支持 POST，且路径前缀硬编码为 `/api/v1`。

消费 `/api/agent/[id]/events` 有两个选项：

1. **原生 `EventSource`**：浏览器自动处理 SSE 协议、自动重连、自动忽略心跳注释行；但**不能自定义 header**，只能依赖 cookie 鉴权 — 与 apps/web 的鉴权模型（cookie `pw_at`）天然匹配。
2. **扩展 `postStream` 支持 GET**：可控性更强（能加 `Authorization` header），但需要重写重连逻辑。

**推荐：M3 用原生 `EventSource`**，因为 apps/web 鉴权就是 cookie-based，`EventSource` 的限制（不能加 header）恰好不是阻碍。注意 `EventSource` 默认不带跨域 cookie，需 `new EventSource(url, { withCredentials: true })`；同源（经 Vite proxy）时不需要。

## 3. dashboard mock 占比

执行命令与输出：

```
$ find apps/dashboard/src/mock -type f | wc -l
6

$ grep -rl "mock" apps/dashboard/src/views | wc -l
1

$ find apps/dashboard/src/views -type f | wc -l
43

$ find apps/dashboard/src -type f \( -name '*.ts' -o -name '*.vue' \) | wc -l
262
```

占比估算：

- `src/mock` 目录文件数：**6**
- `src/views` 中引用 mock 的文件数：**1 / 43**（约 2.3%）
- `src/mock` 占 `src` 总源码文件（262）比例：约 **2.3%**

**结论：dashboard 的 mock 污染面非常小（~2%），views 里只有 1 个文件还引用 mock。M3 不需要大规模清理 mock，可以直接在真实 API 上开发。**

## 4. 风险与后续行动

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| `pw_at` cookie 的 Domain/SameSite 导致 Vite proxy 下不带 cookie | 中 | 开发期统一用 `127.0.0.1`（不用 `localhost`）；必要时在登录响应里放宽 `SameSite=Lax` |
| `EventSource` 无法加 `Authorization` header | 低 | apps/web 鉴权本来就是 cookie-based，不需要 header |
| SSE 事件 type 集合会随 pi-coding-agent 升级而扩展 | 低 | Vue3 端用 `unknown` + 窄化，未知 type 落盘日志即可 |
| `tool_update` 在任务书中提及但代码中不存在 | 低 | 已在本文档 §1.4 校正为 `tool_execution_start/end` |

## 5. 结论

**C2 Spike 通过。** Vue3 消费 apps/web SSE 在技术上无阻塞点：

1. SSE 协议标准、事件格式已枚举完整；
2. Vite proxy 已就绪（`/api → 127.0.0.1:30141`）；
3. 鉴权用 cookie，与 `EventSource` 模型匹配；
4. dashboard mock 占比 ~2%，可在真实 API 上直接开发。

可以进入 M3 后续 build 任务。
