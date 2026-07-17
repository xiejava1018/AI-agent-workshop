# 任务清单:M4 RBAC 平台中台 — 用户/角色/权限码/菜单管理

> change: m4-rbac-platform
> 日期:2026-07-17
> 状态:open(等待 brainstorming 确认设计稿完成 → 进 build 阶段)
> 配套:proposal.md / design.md / specs/rbac-platform/spec.md

---

## 0. 基线门禁(必跑)

- [x] B0.1 `pnpm install` 通过
- [x] B0.2 `pnpm --filter @ai-agent-workshop/web build` 通过
- [x] B0.3 `pnpm --filter @ai-agent-workshop/dashboard build` 通过
- [x] B0.4 M4 `/api/v1/*` 测试 47/47 全过 + dashboard 15/15 全过(M4 回归锚点,2026-07-17 于 feature/20260717/m4-rbac-platform)

> **已知预存在失败(out-of-scope,2026-07-17 核对):** web 完整套件有 26 个失败,**均与 M4 无关**:
> - 25 个 `must-change-password.meta.test.ts`:要求每个写操作 admin 路由调用 `enforceNotMustChange(req)`,实际 0/17 实现 —— 历史安全债,非 M4 引入(meta 测试在 main 也存在)。M4 鉴权切换从未移除该门禁(它本就不存在)。
> - 1 个 `prisma-models.test.ts`:M3 `agentSkillBinding` 模型 Prisma DB 层错误(环境/数据)。
> - **决策(用户 2026-07-17 确认):** 接受为 out-of-scope,must-change-password 缺口另开 change 修复。M4 以自身 47 v1 + 15 dashboard 测试为回归锚点。

---

## 1. 数据模型(T1,Prisma migration)

- [ ] T1.1 新增 6 个模型到 `apps/web/prisma/schema.prisma`:
  - `SysRole`(code unique / name / desc / enabled / sort)
  - `UserRole`(userId+roleId 复合主键,FK 到现有 User)
  - `Permission`(code unique / module / name / description / sort)
  - `RolePermission`(roleId+permissionId 复合主键)
  - `SysMenu`(parentId 自引用树 / type[directory|menu|button] / meta JSON / enabled / visible)
  - `MenuAuth`(menuId FK / mark 唯一 / sort)
- [ ] T1.2 `User` 模型不加新字段(平台管理员用 `UserRole → SysRole.code='platform_admin'` 判定)
- [ ] T1.3 编写 `prisma migrate dev --name add_rbac_platform` 生成迁移 SQL
- [ ] T1.4 验证:迁移在空库 + 已有数据两种情况下均可重放

---

## 2. 种子数据(T2,T3,幂等)

- [ ] T2.1 编写 `apps/web/prisma/seed/permissions.ts`(参考 `TF-TrailVerDev/backend/scripts/seed_permissions.py:126-149` 的 `existing → skip / else create` 模式)
- [ ] T2.2 seed 60+ 条 Permission(模块:用户/角色/菜单/团队/数字员工/技能/MCP/会话/模型/凭据/审计/监控/平台准入)
- [ ] T2.3 编写 `apps/web/prisma/seed/roles.ts`:upsert 3 条 SysRole(platform_admin / team_owner / member)+ 批量插入 RolePermission 绑定矩阵(详见 design §5)
- [ ] T2.4 单测:`seed_*.ts` 第二次运行 `created_count=0`、无报错
- [ ] T3.1 编写 `apps/web/prisma/seed/menus.ts`:upsert 4 父 + 13 子 SysMenu,每子菜单的 `meta.permissions` 列出所需权限码(对齐 UI 设计 13 屏)
- [ ] T3.2 seed 后立即人工核对:`member` 登录后 `/api/v1/menus/user-menu` 只含工作区 4 项(防止漏权限码)
- [ ] T3.3 防锁死迁移:`INITIAL_PLATFORM_ADMIN_USERNAME`(默认 `admin`)对应 User 自动绑 `platform_admin` 角色,若该用户不存在则跳过等首次登录

---

## 3. 鉴权 helper(T4,核心)

- [ ] T4.1 创建 `apps/web/lib/permissions.ts`,实现:
  - `assertPlatformAdmin(req): Promise<{ userId: string } | null>`(校验 `platform:access`)
  - `assertPermission(userId: string, code: string): Promise<boolean>`
  - `assertAnyPermission(userId: string, ...codes: string[]): Promise<boolean>`
  - `getUserPermissions(userId: string): Promise<string[]>`
- [ ] T4.2 安全注释:鉴权始终查 DB,**不信任 `x-user-role` header**(沿用 `assertIsAdmin` 安全注释)
- [ ] T4.3 单测(覆盖 ≥ 80%):
  - `assertPermission` 真阳性 / 假阳性 / 跨角色并集 / 用户不存在
  - `assertPlatformAdmin` 有权限码通过 / 无返回 null / 无 header 返回 null
  - `getUserPermissions` 多角色并集去重 / 空用户返空数组

---

## 4. `/api/v1/*` 路由(T5)

- [ ] T5.1 `GET /api/v1/permissions`(只读全表,已登录即可)
- [ ] T5.2 `GET /api/v1/menus/tree`(`menu:view`,完整菜单树给菜单管理页)
- [ ] T5.3 `GET /api/v1/menus/user-menu`(已登录,按权限过滤,核心递归算法)
- [ ] T5.4 `POST/PUT/DELETE /api/v1/menus[/:id]`(`menu:create/edit/delete`)
- [ ] T5.5 `GET /api/v1/menus/role/:roleId`(`role:view`,返回绑定的权限码集合)
- [ ] T5.6 `PUT /api/v1/menus/role/:roleId`(`role:assign-permission`,保存权限码集合)
- [ ] T5.7 `GET /api/v1/roles` 分页 + `POST/PUT/DELETE /api/v1/roles[/:id]`(各需对应权限码)
- [ ] T5.8 `GET /api/v1/users` 分页 + `POST /api/v1/users`(`user:create`,沿用现有 admin/users 的初始密码 + 强制改密机制)
- [ ] T5.9 `PUT /api/v1/users/:id`(`user:edit`)
- [ ] T5.10 `PUT /api/v1/users/:id/roles`(`user:assign-role`,设置用户全局角色)
- [ ] T5.11 `PUT /api/v1/users/:id/disable`(`user:disable`)
- [ ] T5.12 `PUT /api/v1/users/:id/reset-password`(`user:reset-password`)
- [ ] T5.13 集成测试覆盖(8+ 场景,详见 design §10.2):三角色端到端 RBAC 流、菜单过滤、admin 鉴权修复、header 篡改无效等

---

## 5. `/api/v1/auth/me` 响应扩展 + 前端 store(T6)

- [ ] T6.1 后端 `GET /api/v1/auth/me` 响应增加 `permissions: string[]` 与 `roles: { code, name }[]`(通过 `getUserPermissions` 与 UserRole→SysRole join 得出)
- [ ] T6.2 `apps/dashboard/src/types/api/auth.d.ts` 扩展 `Api.Auth.UserInfo` 类型
- [ ] T6.3 `apps/dashboard/src/store/modules/user.ts` 增加 `permissions: Set<string>` + `roles[]` state;`hasPermission(code)` / `hasAnyPermission(...codes)` getter;`fetchAndSetUserInfo()` action
- [ ] T6.4 userStore 持久化 permissions 到 sessionStorage(防首屏时序竞争)
- [ ] T6.5 单测:`hasPermission` / `hasAnyPermission`(覆盖 code 不存在、permissions 未加载态)

---

## 6. 鉴权切换(T7,关键 + 风险)

- [ ] T7.1 **机械化替换**:在 30+ 个 `/api/admin/*` 路由文件中:
  - `import { assertIsAdmin } from "@/lib/server-user";` → `import { assertPlatformAdmin } from "@/lib/permissions";`
  - `const admin = await assertIsAdmin(req);` → `const admin = await assertPlatformAdmin(req);`
- [ ] T7.2 **`assertIsAdmin` 函数本身保留**(兼容未来 TeamMember 团队 OWNER/ADMIN 的其他场景),仅替换调用点
- [ ] T7.3 平滑过渡 helper(在 T6 store 改造中一起做):登录时若 `User.userRoles` 为空且 `TeamMember.role == 'OWNER'`,自动绑 `team_owner` 全局角色
- [ ] T7.4 集成测试回归:30+ 现有 `/api/admin/*` 测试**全部继续通过**;新增"team_owner 调 /api/admin/users"用例 → 403
- [ ] T7.5 E2E:`platform_admin` 进 `/platform/*` 全功能可用;`team_owner` 进 → 跳 403 页

---

## 7. 前端动态菜单 + `v-auth` + system 模块接通(T8,T9)

- [ ] T8.1 `apps/dashboard/src/store/modules/menu.ts`(新建):`menuTree` state + `loadMenuTree()` action(调 `/api/v1/menus/user-menu`)
- [ ] T8.2 `apps/dashboard/src/router/utils.ts` 的 `buildRoutesFromMenu(menuTree)` 把菜单树转 Vue Router 配置(父目录无 component 不入路由)
- [ ] T8.3 `apps/dashboard/src/router/guards.ts` 登录后:`fetchAndSetUserInfo()` + `loadMenuTree()` + `buildRoutesFromMenu()` + `router.addRoute(...)` 动态注入
- [ ] T8.4 `apps/dashboard/src/directives/business/auth.ts` 实现 `v-auth="'<permission-code>'"` 指令(mount/update 生命周期)
- [ ] T8.5 单测:`buildRoutesFromMenu`(父目录无 component 不入路由 / 叶子有 component 入路由 / 空 children 保留叶子)+ `v-auth` 指令
- [ ] T9.1 `apps/dashboard/src/views/system/user/index.vue` 改用 `api/v1/users`;表格行操作加 `v-auth`;停用/启用改 PUT `/users/:id/disable`;重置密码弹窗已存在
- [ ] T9.2 `apps/dashboard/src/views/system/user/modules/user-dialog.vue` 新增"分配角色"复选(SysRole 三种子)
- [ ] T9.3 `apps/dashboard/src/views/system/role/index.vue` 改用 `api/v1/roles`;表格行操作加 `v-auth`
- [ ] T9.4 `apps/dashboard/src/views/system/role/modules/role-permission-dialog.vue` **核心改造**:用 `api/v1/menus/role/:roleId` 拉权限码集合,以菜单树视觉呈现,但保存的是 `permissionCodes: string[]`;提交 PUT `/api/v1/menus/role/:roleId`
- [ ] T9.5 `apps/dashboard/src/views/system/role/modules/role-edit-dialog.vue` 表单 name/desc/enabled/sort
- [ ] T9.6 `apps/dashboard/src/views/system/menu/index.vue` 改用 `api/v1/menus/tree`;CRUD 用 `/api/v1/menus`;`menu-dialog.vue` 补 `meta.permissions` 多选编辑(从 `/api/v1/permissions` 拉列表)
- [ ] T9.7 `apps/dashboard/src/views/system/menu/modal/authInfo.vue` MenuAuth 列表编辑(可选,button 级用)
- [ ] T9.8 `apps/dashboard/src/views/system/audit-log/index.vue` 加 `v-auth="'audit:view'"`
- [ ] T9.9 E2E:三角色登录侧边栏截图比对(`docs/ui-design/index.html`)

---

## 8. 删除死代码(T10,清理)

- [ ] T10.1 删除 `apps/dashboard/src/views/system/department/` 全部文件(视图 + 路由 + 类型 + mock)
- [ ] T10.2 删除 `apps/dashboard/src/views/system/dict/` 全部文件
- [ ] T10.3 删除 `apps/dashboard/src/store/modules/permission.ts` 中的 `getMenuByRole`、`isPlatformAdmin`、`isTeamAdmin`(若不再用),`Role` 类型仅用于 `hasPermission` 判断时保留
- [ ] T10.4 删除 `apps/dashboard/src/api/system/api.ts`
- [ ] T10.5 grep 全仓无 `getMenuByRole` / `department` / `dict` / `api/system/api` 引用残留
- [ ] T10.6 全量回归:`pnpm test` + `pnpm --filter @ai-agent-workshop/web build` + `pnpm --filter @ai-agent-workshop/dashboard build` + E2E 全通过
- [ ] T10.7 release notes:明示"团队 OWNER 调 /api/admin/* 由 200 变 403(请使用 platform_admin 角色)"这一行为变化

---

## 9. 验收对照(specs 落地)

- [ ] V1 六张新表 + 60+ Permission + 3 SysRole + RolePermission 绑定 + 4 父 + 13 子 SysMenu 全部存在 + 幂等(seed § 1.1)
- [ ] V2 platform_admin / team_owner / member 三角色端到端流(me + user-menu + /api/admin/*)符合 spec § 2/3/4
- [ ] V3 `/api/v1/auth/me` 下发 permissions/roles 字段正确(me § 4.1-4.3)
- [ ] V4 `/api/v1/*` CRUD 鉴权按权限码生效(roles § 5.1-5.2)
- [ ] V5 前端动态菜单 + v-auth + 角色切换随之更新(front § 6.1-6.3)
- [ ] V6 防锁死 migration:首位用户自动 platform_admin;TeamMember OWNER 自动 team_owner(lock § 7.1-7.2)
- [ ] V7 30+ `/api/admin/*` 集成测试继续通过(switch § 8.1)
- [ ] V8 system 模块三个页面接通 + 角色权限分配弹窗保存权限码(system § 9.1-9.2)
- [ ] V9 三角色 E2E 截图与 UI 设计 `index.html` 一致(menu § 10.1)
- [ ] V10 审计日志记录 RBAC 敏感操作(audit § 11.1)
- [ ] V11 单测覆盖率 ≥ 80%(test § 12.1)+ E2E 三角色全通过(§ 12.2)

---

## 10. 后续(本 change 不做,记入 backlog)

- [ ] B1 部门管理(Department 表)重建——若产品后续需要跨团队组织视图
- [ ] B2 数据权限码化(`data:all/dept/self`)——目前 TeamMember 团队级隔离已够用
- [ ] B3 SSO / OIDC 集成
- [ ] B4 多租户 Tenant 模型(扩 Tenant 时 RBAC 角色作用域改 `(tenantId, code)` 复合唯一)
- [ ] B5 SoybeanAdmin 模板升级 review 检查清单加一行(防止 department/dict 重新被引入)