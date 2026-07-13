## ADDED Requirements

### Requirement: 服务端必须有 50 session 全局硬上限

系统 SHALL 维护一个 server-side in-memory 计数器，统计当前活跃的 agent session 数。当 `POST /api/agent/new` 收到请求时，先检查计数 ≥ 50 → 返回 503；否则允许创建并在成功创建后 +1。

#### Scenario: 正常路径 50 session 内
- **WHEN** 已有 49 个活跃 session 时 POST `/api/agent/new`
- **THEN** 创建成功（200 + sessionId）
- **AND** 计数器 +1（= 50）

#### Scenario: 第 51 个请求被拒
- **WHEN** 已有 50 个活跃 session 时 POST `/api/agent/new`
- **THEN** 返回 503 `{ error: "session cap reached (50 active sessions)" }`
- **AND** 不创建新 session
- **AND** 计数器不变

#### Scenario: session 关闭释放配额
- **WHEN** 一个活跃 session 关闭（`SessionManager.close`）
- **THEN** 计数器 -1
- **AND** 后续 `POST /api/agent/new` 可正常创建直到再次达到 50

#### Scenario: 重启后计数归零
- **WHEN** server 重启
- **THEN** 计数器重置为 0
- **AND** 行为降级：可创建超过 50（直到真实 50 个活跃）；文档中标记 M2.3+ 升级到 Prisma 持久化

### Requirement: 计数器只对 POST /api/agent/new 生效

系统 SHALL 仅在创建 session 的入口（`POST /api/agent/new`）检查与递增 50 session cap。其他 agent 相关路由（`GET /api/agent/[id]`、`POST /api/agent/[id]`、`GET /api/agent/[id]/events`）不受 cap 影响。

#### Scenario: 读路由不消耗配额
- **WHEN** 已有 50 个活跃 session 时 `GET /api/agent/S1/state`
- **THEN** 200（只要 S1 是用户的）
- **AND** 计数器不变
