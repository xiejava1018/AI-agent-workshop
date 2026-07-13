# project-and-path-safety Specification

## Purpose
TBD - created by archiving change pi-web-generalized-m1-runnable. Update Purpose after archive.
## Requirements
### Requirement: assertWithinRoot —— 主动校验 user 路径必须落在 user 选定的 Project.root_path 内

fork 现有 `allowFileRoot(path)` 是"允许"语义（让 file router 通过）。**本 capability 新增主动校验**语义：用户请求 path → 校验是否在 user 选定的某个 `Project.root_path` 内。

系统 MUST 提供 `lib/path-safety.ts` 导出 `assertWithinRoot(absolutePath: string, rootPath: string): string`，**解析所有路径后调用，校验规范化后路径必须在 `rootPath` 之内**。返回规范化后的真实路径。

`assertWithinRoot` MUST 防御：
1. `..` 路径段（任何形式的 `../../../../etc/passwd`）
2. 符号链接指向 `rootPath` 之外
3. 绝对路径绕过
4. URL 编码 / Unicode 等价绕过（先 `path.resolve` 再 `fs.realpath`）

#### Scenario: ../ 路径被拦截
- **WHEN** 调用 `assertWithinRoot("/data/users/u1/projects/p1/../../../etc/passwd", "/data/users/u1/projects/p1")`
- **THEN** 抛出 `PathTraversalError`

#### Scenario: 符号链接指向 root 之外被拦截
- **WHEN** 调用 `assertWithinRoot("/data/users/u1/projects/p1/subdir/outside_link", ...)` 而 `subdir/outside_link` 指向 `/etc`
- **THEN** 抛出 `PathTraversalError`

#### Scenario: 合法路径返回规范化路径
- **WHEN** 调用 `assertWithinRoot("/data/users/u1/projects/p1/README.md", "/data/users/u1/projects/p1")`
- **THEN** 返回 `/data/users/u1/projects/p1/README.md`

### Requirement: Project 由 Admin 手工添加，并接入 fork 现有白名单

系统 MUST 提供 `POST /api/projects` 接收 `{ team_id, name, root_path }`。M1 MUST 仅允许 admin / owner 角色调用，Member 角色调用 MUST 返回 403。`root_path` MUST 是 server 进程可见的绝对路径；server 创建时调 fork 已有的 `lib/file-access.ts` 的 `allowFileRoot(root_path)` 将该 root 加入 fork 的 globalThis 缓存，**同时**调 `assertWithinRoot` 自验该 root 本身合法。Project 不允许在 UI 中改 `root_path`（一旦设定只能删除重建）。

#### Scenario: Admin 添加合法路径
- **WHEN** admin `A` 调 `POST /api/projects { team_id: "T1", name: "demo", root_path: "/tmp/demo" }` 且该路径可访问
- **THEN** 返回 201，projects 表新增一行；fork 的 `__piAdditionalAllowedRoots` 集合中加入 `/tmp/demo`；`A` 登录后 sidebar 可见该 Project

#### Scenario: Member 添加被拒
- **WHEN** member `M` 调 `POST /api/projects`
- **THEN** 返回 403，不创建记录；fork 白名单不变

### Requirement: cwd 注入沿用 fork 现有链

系统 MUST 新增 `POST /api/projects/[id]/bind`：该接口 MUST 调 fork 已有的 `/api/cwd/validate` 端点的等价逻辑（`statSync` + `allowFileRoot`），把 user 选定的 Project 写为 session 的 cwd。**必须不引入新 SessionBus** —— fork 的 `lib/rpc-manager.ts` 已经管多 session 生命周期。

#### Scenario: 用户切换 Project 不重启 server
- **WHEN** user `U` 已经登录，选 Project P1 (root_path=/tmp/p1) 后调 `POST /api/projects/[id]/bind`
- **THEN** `last_project_id` 写入 user 维度（内存或 DB）；后续 `POST /api/agent/new` 的 cwd 自动填入 `/tmp/p1`

