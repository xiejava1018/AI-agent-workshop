# rbac-platform Specification

## Purpose
TBD - created by archiving change m4-rbac-platform. Update Purpose after archive.
## Requirements
### Requirement: 六张 RBAC 新表与种子

系统 SHALL 在数据库中提供 6 张新表,用于标准 RBAC 中台:

- `sys_roles`(全局角色,正交于 TeamMember.role)
- `user_roles`(用户 ↔ SysRole 多对多)
- `permissions`(权限码一等公民,`code` 字段 unique)
- `role_permissions`(SysRole ↔ Permission 多对多)
- `sys_menus`(菜单树,`meta.permissions` JSON 存所需权限码)
- `menu_auths`(页面内按钮/元素的权限码,`mark` 即权限码)

系统 SHALL 在 migration 阶段种入以下数据(幂等):

- 60+ 条 Permission,覆盖用户/角色/菜单/团队/数字员工/技能/MCP/会话/模型/凭据/审计/监控/平台准入
- 3 条 SysRole 预置角色:`platform_admin` / `team_owner` / `member`
- 三角色对应的 RolePermission 绑定矩阵(详见 design §5)
- 4 父菜单 + 13 子菜单 SysMenu,每子菜单的 `meta.permissions` 列出所需权限码(对齐 UI 设计 13 屏)

#### Scenario: 首次 migration 后种子全部存在

- **WHEN** 全新部署执行 `prisma migrate deploy` + seed
- **THEN** 数据库存在至少 60 条 Permission、3 条 SysRole、对应 RolePermission、4 父 + 13 子 SysMenu

#### Scenario: 种子脚本幂等

- **WHEN** 已存在种子数据的实例再次运行 seed
- **THEN** 无报错
- **AND** 数据条数不变(无重复)

#### Scenario: 不维护 RoleMenu 表

- **WHEN** 检查 `prisma/schema.prisma`
- **THEN** 不存在 `RoleMenu` / `role_menus` 表
- **AND** 菜单可见性由 `sys_menus.meta.permissions ∩ user.permissions` 决定

---

### Requirement: 平台管理员独立身份与 `/api/admin/*` 鉴权修复

系统 SHALL 通过 `UserRole → SysRole.code='platform_admin'` 判定"平台管理员"身份。系统 SHALL 新增 `assertPlatformAdmin(req)` 鉴权 helper,**校验 `platform:access` 权限码**,而非复用 `assertIsAdmin`(只查 TeamMember.OWNER/ADMIN)。

#### Scenario: platform_admin 调 /api/admin/* 成功

- **GIVEN** 用户 U 持有 `platform_admin` 全局角色(经 UserRole)
- **WHEN** U 调用任意 `/api/admin/*` 端点
- **THEN** 请求通过鉴权

#### Scenario: 团队 OWNER 调 /api/admin/* 被拒

- **GIVEN** 用户 U 仅在 TeamMember.role = OWNER(无 platform:access 权限码)
- **WHEN** U 调用 `/api/admin/users`
- **THEN** 系统返回 403 `{ "error": "forbidden" }`
- **AND** 审计日志记录 access_denied(沿用现有 audit-log 机制)

#### Scenario: x-user-role header 篡改无效

- **WHEN** 攻击者发起 `GET /api/admin/users`,手工设置 `x-user-role: OWNER` header
- **THEN** 鉴权仍以 DB 为准
- **AND** 不持有 `platform:access` 的用户收到 403

---

### Requirement: 用户菜单按权限过滤(服务端)

系统 SHALL 提供 `GET /api/v1/menus/user-menu`,从 `enabled=true` 的 SysMenu 全表出发,**服务端按 `set(SysMenu.meta.permissions) ∩ set(user.permissions)` 递归过滤**,返回当前用户可见的菜单树。

过滤算法 SHALL:

- 当节点 `meta.permissions` 为空时,视为公共菜单(放行)
- 当节点 `meta.permissions` 非空时,要求 `set(meta.permissions) ∩ user.permissions ≠ ∅`
- 目录菜单(type=directory)只看子菜单级联,父目录无可见子菜单则整段隐藏
- 叶子菜单无权限则整段隐藏

#### Scenario: 普通用户登录后侧边栏仅工作区 + 我的资源

- **GIVEN** 用户 U 绑 `member` 角色
- **AND** `member` 绑定的权限码集不含 `team:view` / `platform:access` / `user:view` / `audit:view` 等
- **WHEN** U 登录后调 `/api/v1/menus/user-menu`
- **THEN** 返回树仅含「工作空间 / Agent 工作台 / 多 Agent 编排 / 数字员工 / 技能中心 / 我的设置」6 项
- **AND** 不含「团队管理」和任何「平台管理」子菜单

#### Scenario: 团队 OWNER 登录后侧边栏增加团队管理

- **GIVEN** 用户 U 绑 `team_owner` 角色(含 `team:view` 权限码)
- **WHEN** U 调 `/api/v1/menus/user-menu`
- **THEN** 返回树在普通用户基础上额外含「团队管理」父菜单及其子菜单
- **AND** 不含「平台管理」

#### Scenario: 平台管理员登录后侧边栏看到全部

- **GIVEN** 用户 U 绑 `platform_admin` 角色(含全部权限码)
- **WHEN** U 调 `/api/v1/menus/user-menu`
- **THEN** 返回树含「工作区」「我的资源」「团队管理」「平台管理」(含用户管理/模型配置/MCP/技能/审计/监控等 7 项)

#### Scenario: 公共菜单对所有登录用户可见

- **GIVEN** 菜单 `工作空间` 的 `meta.permissions = []`
- **WHEN** 任意登录用户调 `/api/v1/menus/user-menu`
- **THEN** 该菜单被包含在返回树中

#### Scenario: 目录菜单级联隐藏

- **GIVEN** 父菜单 `平台管理` 的所有子菜单对当前用户都不可见
- **WHEN** U 调 `/api/v1/menus/user-menu`
- **THEN** 返回树不包含 `平台管理` 父菜单(整段隐藏)

---

### Requirement: `/api/v1/auth/me` 下发 permissions 与 roles

系统 SHALL 在 `GET /api/v1/auth/me` 响应中新增两个字段:

- `permissions: string[]` — 用户全部权限码(去重)
- `roles: { code: string; name: string }[]` — 用户绑定的全局角色列表

数据 SHALL 通过 `UserRole → SysRole → RolePermission → Permission` 链 join 得出。

#### Scenario: 登录成功后 /me 含权限码集

- **GIVEN** 用户 U 绑 `platform_admin` 全局角色
- **WHEN** U 登录后调 `GET /api/v1/auth/me`
- **THEN** 响应 `permissions` 数组包含 `platform:access` / `user:view` / `user:create` / ... 等 50+ 项
- **AND** 响应 `roles` 数组含 `{ code: "platform_admin", name: "平台管理员" }`

#### Scenario: member 角色 /me 权限码不含 platform:access

- **GIVEN** 用户 U 仅绑 `member` 角色
- **WHEN** U 调 `/api/v1/auth/me`
- **THEN** 响应 `permissions` 不包含 `platform:access`
- **AND** 不包含 `user:delete` / `role:create` 等管理员权限

#### Scenario: 多角色权限码并集去重

- **GIVEN** 用户 U 同时绑 `member` 和 `team_owner` 角色
- **WHEN** U 调 `/api/v1/auth/me`
- **THEN** 响应 `permissions` 是两个角色权限码的并集
- **AND** 重复的权限码(如 `agent:view`)只出现一次

---

### Requirement: `/api/v1/*` RBAC CRUD 路由

系统 SHALL 在 `/api/v1/*` 下提供 14+ 路由用于 RBAC CRUD 管理,具体鉴权按设计 §7.1 表格:

| 资源 | 路由 | 鉴权权限码 |
|------|------|----------|
| Permission | `GET /api/v1/permissions` | 已登录 |
| Menu | `GET /api/v1/menus/tree` + CRUD | `menu:*` |
| Menu 角色绑定 | `GET/PUT /api/v1/menus/role/:roleId` | `role:view/assign-permission` |
| Role | `GET /api/v1/roles` + CRUD | `role:*` |
| User | `GET /api/v1/users` + CRUD + `roles` + `disable` + `reset-password` | `user:*` |

#### Scenario: 创建角色并绑定权限码

- **GIVEN** U 拥有 `platform_admin`(含 `role:create`、`role:assign-permission`)
- **WHEN** U 调用 `POST /api/v1/roles { name: "测试角色" }` 拿到 roleId
- **AND** U 调用 `PUT /api/v1/menus/role/{roleId} { permissionCodes: ["user:view", "role:view"] }`
- **THEN** 数据库 RolePermission 表插入对应两条
- **AND** 后续绑该角色的用户 `/me.permissions` 含 `user:view`、`role:view`

#### Scenario: 无权限码时 CRUD 被拒

- **GIVEN** U 仅绑 `member`(无 `role:create`)
- **WHEN** U 调用 `POST /api/v1/roles`
- **THEN** 系统返回 403 `{ "error": "forbidden" }`

---

### Requirement: 前端动态菜单 + `v-auth` 指令

系统 SHALL 在 `apps/dashboard` 前端提供:

- `store/modules/menu.ts` 调 `/api/v1/menus/user-menu` 加载菜单树
- `router/utils.ts` 的 `buildRoutesFromMenu(menuTree)` 把菜单树转 Vue Router 配置
- `router/guards.ts` 登录后 `loadMenuTree() + addRoute(...)` 动态注入路由
- `directives/business/auth.ts` 实现 `v-auth="'<permission-code>'"` 指令,无权限时从 DOM 移除
- `store/modules/user.ts` 扩展 `permissions: Set<string>` + `hasPermission(code)` / `hasAnyPermission(...codes)`

系统 SHALL **删除** `store/modules/permission.ts` 中的 `getMenuByRole` 硬编码、`api/system/api.ts`、`views/system/{department,dict}/` 全部文件。

#### Scenario: 登录后侧边栏由服务端菜单树渲染

- **GIVEN** U 登录成功
- **AND** `/api/v1/auth/me` 返回含 `permissions` 字段
- **WHEN** 路由守卫触发 `loadMenuTree()` → `addRoute(...)`
- **THEN** 侧边栏显示的菜单项与 `/api/v1/menus/user-menu` 返回树一致
- **AND** 不显示硬编码菜单(原 `getMenuByRole` 已删除)

#### Scenario: v-auth 指令移除无权限按钮

- **GIVEN** U 仅绑 `member`(无 `user:create`)
- **WHEN** U 进入 `/system/user` 页面
- **THEN** 「新增用户」按钮(标 `v-auth="'user:create'"`)从 DOM 移除
- **AND** 其他无需 `user:create` 的按钮(如搜索框)正常显示

#### Scenario: 角色切换后侧边栏随之更新

- **GIVEN** U 原绑 `member`
- **AND** 管理员把 U 改为绑 `platform_admin`
- **WHEN** U 重新登录
- **THEN** `/api/v1/auth/me` 返回新 permissions 集(含 `platform:access` 等)
- **AND** `/api/v1/menus/user-menu` 返回完整菜单树(含平台管理)
- **AND** 侧边栏显示全部 13 屏

---

### Requirement: 防锁死 migration 与平滑过渡

系统 SHALL 提供防锁死机制:

1. 在 seed 阶段,从 env `INITIAL_PLATFORM_ADMIN_USERNAME`(默认 `admin`)读取目标用户名,若对应 User 存在,自动创建 `UserRole(userId, SysRole.code='platform_admin')`
2. 在登录 helper 中(M5+),若用户的 `UserRole` 为空但 `TeamMember.role == 'OWNER'`,自动绑 `team_owner` 全局角色

#### Scenario: 首位用户自动获得 platform_admin

- **GIVEN** env `INITIAL_PLATFORM_ADMIN_USERNAME=admin`
- **AND** 数据库存在 User(username='admin')
- **WHEN** 执行 seed
- **THEN** 数据库自动插入 UserRole(userId=admin.id, roleId=platform_admin.id)
- **AND** 该用户登录后 `/me.permissions` 含 `platform:access`

#### Scenario: 历史团队 OWNER 自动绑 team_owner

- **GIVEN** User U 有 TeamMember(role='OWNER')但 `UserRole` 为空
- **WHEN** U 登录
- **THEN** helper 自动创建 UserRole(U, team_owner)
- **AND** U 后续 `/me.permissions` 含 team_owner 权限码集
- **AND** U 不会被 403(因 team_owner 含 `team:view` 等)

---

### Requirement: 现有 `/api/admin/*` 鉴权机械化替换

系统 SHALL 在 30+ 个 `/api/admin/*` 路由文件中,机械替换鉴权 helper:

- `import { assertIsAdmin } from "@/lib/server-user";` → `import { assertPlatformAdmin } from "@/lib/permissions";`
- `const admin = await assertIsAdmin(req);` → `const admin = await assertPlatformAdmin(req);`

**handler body 不动**。`assertIsAdmin` 函数本身**保留**(为兼容未来 TeamMember 团队 OWNER/ADMIN 的其他场景),仅调用点替换。

#### Scenario: /api/admin/users 鉴权切换后 30+ 路由全部继续通过集成测试

- **GIVEN** 原 `/api/admin/users`、`/api/admin/teams`、`/api/admin/mcp`、`/api/admin/models`、`/api/admin/audit` 等集成测试已通过
- **WHEN** 完成 T6 鉴权 helper 全量替换
- **THEN** 所有这些集成测试**继续通过**(handler 未动,仅鉴权方式变)
- **AND** platform_admin 测试用例继续 200
- **AND** 新增"team_owner 调 /api/admin/users"测试用例返回 403

---

### Requirement: system 模块页面接通 `/api/v1/*`

系统 SHALL 改造 `apps/dashboard/src/views/system/` 下三个页面:

- `system/user/index.vue` — 列表/搜索/CRUD 接 `/api/v1/users`,表格行操作加 `v-auth`
- `system/role/index.vue` + `role-permission-dialog.vue` — 接 `/api/v1/roles` + `/api/v1/menus/role/:roleId`(保存 `permissionCodes`)
- `system/menu/index.vue` + `menu-dialog.vue` — 接 `/api/v1/menus/tree` + CRUD;`meta.permissions` 多选编辑(从 `/api/v1/permissions` 拉列表)
- `system/audit-log/index.vue` — 加 `v-auth="'audit:view'"`

系统 SHALL **删除** `system/department/` 与 `system/dict/` 全部文件(视图、路由、类型、mock)。

#### Scenario: 用户管理页面 CRUD 真实可用

- **GIVEN** U 拥有 `platform_admin`
- **WHEN** U 进入 `/system/user` 并点击「新增用户」
- **THEN** 弹窗 POST `/api/v1/users` 创建用户,弹窗关闭
- **AND** 列表自动刷新,新用户出现

#### Scenario: 角色权限分配弹窗保存权限码集合

- **GIVEN** U 拥有 `platform_admin`
- **WHEN** U 在角色管理页点击「分配权限」并勾选「工作空间」「用户管理」等菜单项
- **THEN** 前端把勾选的菜单树翻译为 `permissionCodes` 集合(由菜单的 `meta.permissions` 反查)
- **AND** PUT `/api/v1/menus/role/{roleId} { permissionCodes: [...] }` 提交
- **AND** 成功后 RolePermission 表新增对应绑定
- **AND** 后续绑该角色的用户 `/menus/user-menu` 包含被勾的菜单

---

### Requirement: 菜单 seed 对齐 UI 设计 13 屏

系统 SHALL seed 的 SysMenu 树 SHALL **严格对齐** `docs/ui-design/index.html` 导航结构:

- 4 个父菜单:工作区 / 我的资源 / 团队(OWNER) / 平台管理(管理员)
- 13 个子菜单:工作空间 / Agent 工作台 / 多 Agent 编排 / 数字员工 / 技能中心 / 我的设置 / 团队管理 / 用户管理 / 模型配置 / MCP 精选库 / 技能精选库 / 数字员工模板 / 审计日志 / 监控大盘

每个子菜单的 `meta.permissions` SHALL 列出该菜单所需权限码(空数组 = 公共)。

#### Scenario: 三角色 E2E 截图与 UI 设计一致

- **WHEN** 三种角色登录后执行 `playwright` 截图
- **THEN** member 角色截图侧边栏与 `docs/ui-design/index.html` 中"普通用户"视角一致(只含工作区 + 我的资源)
- **AND** team_owner 截图与"团队 OWNER"视角一致
- **AND** platform_admin 截图与"平台管理员"视角一致

---

### Requirement: 审计与安全基线

系统 SHALL 保留并沿用现有 `apps/web/lib/audit-log.ts`,在以下 RBAC 操作时记录审计:

- `user.create` / `user.disable` / `user.reset-password` / `user.assign-role`
- `role.create` / `role.update` / `role.delete` / `role.assign-permission`
- `menu.create` / `menu.update` / `menu.delete`

#### Scenario: 角色创建写审计日志

- **GIVEN** U 拥有 `platform_admin`
- **WHEN** U 调用 `POST /api/v1/roles { name: "新角色" }`
- **THEN** AuditLog 表新增一行:userId=U.id, action='role.create', resourceType='role', resourceId=newRoleId
- **AND** `metadata` 字段含 `{ after: { name: "新角色", ... } }`

#### Scenario: 无 token 访问受保护路由 401

- **WHEN** 任意 `/api/v1/*` 路由收到无 `x-user-id` header 的请求
- **THEN** 返回 401(沿用现有未鉴权响应模式)

---

### Requirement: 测试覆盖与回归

系统 SHALL 为本 change 提供:

- **单测**:`assertPermission`、`assertPlatformAdmin`、`getUserPermissions`、`_filter_tree` 四个核心函数,行覆盖 ≥ 80%
- **集成测试**:RBAC 流端到端 8+ 场景(详见 design §10.2)
- **前端单测**:`hasPermission` / `hasAnyPermission` / `v-auth` 指令 / `buildRoutesFromMenu`
- **E2E**:三角色登录侧边栏截图比对(`docs/ui-design/index.html`)
- **迁移回归**:30+ 现有 `/api/admin/*` 集成测试继续通过

#### Scenario: 单测覆盖率达标

- **WHEN** 运行 `pnpm test --coverage` 仅针对本 change 新增文件
- **THEN** `assertPermission`、`assertPlatformAdmin`、`getUserPermissions`、`_filter_tree` 四个文件行覆盖 ≥ 80%

#### Scenario: 三角色 E2E 全部通过

- **WHEN** 运行 Playwright 三角色登录侧边栏截图比对
- **THEN** member / team_owner / platform_admin 三种场景全部通过
- **AND** 截图与 UI 设计对照一致

---

