# session-visibility-filter Specification

## Purpose
TBD - created by archiving change pi-web-m2-2-ui-and-hardening. Update Purpose after archive.
## Requirements
### Requirement: GET /api/sessions 返回当前用户可见的 session 列表

系统 SHALL 在 `GET /api/sessions` 中过滤 session 列表为三路并集：(1) 当前用户是 session owner（meta.userId === userId）；(2) 当前用户是 session owner 所在 team 的 OWNER/ADMIN；(3) M2.4 session_share placeholder（当前永远空）。

#### Scenario: 普通 member 仅看自己创建
- **WHEN** user A (MEMBER of Team T) GET /api/sessions
- **AND** session S1 是 user A 创建
- **AND** session S2 是 user B (MEMBER of Team T) 创建
- **THEN** 响应只包含 S1
- **AND** 不包含 S2

#### Scenario: OWNER 看全 Team session
- **WHEN** user O (OWNER of Team T) GET /api/sessions
- **AND** session S1 是 user A 创建
- **AND** session S2 是 user B 创建
- **AND** S1 + S2 都关联到 Team T 的某个 project
- **THEN** 响应包含 S1 + S2

#### Scenario: 多 Team user 跨 Team 不可见
- **WHEN** user X 是 Team T1 的 MEMBER 与 Team T2 的 MEMBER
- **AND** session S1 在 Team T1 关联 project 下
- **AND** session S2 在 Team T2 关联 project 下
- **THEN** 响应同时包含 S1 与 S2（user X 是两边 owner）

#### Scenario: 匿名 session 仅 admin 可见
- **WHEN** user A (MEMBER) GET /api/sessions
- **AND** session S_anon 的 meta.userId === null（server 重启残留）
- **THEN** 响应不包含 S_anon
- **AND** user O (OWNER) GET /api/sessions 同一时间
- **THEN** 响应包含 S_anon

### Requirement: 跨 Team admin 不应见其他 Team 的 session

系统 SHALL 验证 session 所在 project 的 teamId 必须等于当前用户是 OWNER/ADMIN 的某 team。

#### Scenario: Team T1 admin 看不到 Team T2 session
- **WHEN** user O1 是 Team T1 的 OWNER
- **AND** session S 是 Team T2 下某 project 关联
- **THEN** user O1 GET /api/sessions 不包含 S
- **AND** user O2 (OWNER of T2) GET /api/sessions 包含 S

