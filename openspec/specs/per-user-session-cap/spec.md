# per-user-session-cap Specification

## Purpose
TBD - created by archiving change pi-web-m2-3-admin-user-management. Update Purpose after archive.
## Requirements
### Requirement: 每个用户独立限制活跃 session 数量

系统 SHALL 为每个用户维护独立的活跃 session 计数，默认上限为 5；当用户尝试创建第 6 个 session 时，返回 503。

#### Scenario: 用户创建 session 在配额内
- **WHEN** 用户 A 当前活跃 session 数为 4
- **AND** 用户 A 调用 `POST /api/agent/new`
- **THEN** 系统创建成功，用户 A 计数变为 5

#### Scenario: 用户达到 per-user 上限
- **WHEN** 用户 A 当前活跃 session 数已为 5
- **AND** 用户 A 调用 `POST /api/agent/new`
- **THEN** 系统返回 503 `{ error: "per-user session cap reached (5)" }`
- **AND** 不创建 session

#### Scenario: 不同用户配额互不影响
- **WHEN** 用户 A 已达到 5 个活跃 session
- **AND** 用户 B 当前活跃 session 数为 0
- **THEN** 用户 B 调用 `POST /api/agent/new` 成功
- **AND** 用户 A 的调用继续返回 503

### Requirement: 全局 session 上限作为兜底

系统 SHALL 保留全局 50 session 上限作为兜底，当任意用户创建 session 导致全局总数达到 50 时，返回 503。

#### Scenario: 全局上限触发
- **WHEN** 所有用户活跃 session 总数达到 50
- **AND** 任意用户调用 `POST /api/agent/new`
- **THEN** 系统返回 503 `{ error: "global session cap reached (50)" }`

