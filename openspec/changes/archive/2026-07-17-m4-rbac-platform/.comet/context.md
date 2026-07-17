# Comet Design Handoff

- Change: m4-rbac-platform
- Phase: design
- Mode: compact
- Context hash: 711b469cf5382a553e10d0b57bbe0b72a9c56590371a71d0593abb1888edec56

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/m4-rbac-platform/proposal.md

- Source: openspec/changes/m4-rbac-platform/proposal.md
- Lines: 1-99
- SHA256: aa192a4084dfc1c8bf0b420594ba6d965ebc474d90dde33f23b36141f2bb31cc

[TRUNCATED]

```md
# 提案:M4 RBAC 平台中台 — 用户/角色/权限码/菜单管理

> change: m4-rbac-platform
> 类型:full workflow(brainstorming 必经,已完)
> 日期:2026-07-17
> 依据:docs/plans/2026-07-17-rbac-platform-design.md、docs/ui-design/index.html、参考实现 `/Users/xiejava/AIproject/TF-TrailVerDev`(已实战重构的同类项目)

---

## 1. 为什么做

AI Agent Workshop 已完成 M1/M2.2/M2.3/M3(多用户认证、团队/项目隔离、admin 用户管理、Vue3 工作台+数字员工+编排),但标准 RBAC 中台能力缺失:

- **平台管理员隔离缺口**:`/api/admin/*` 鉴权用 `assertIsAdmin`,实际只校验 `TeamMember.role ∈ {OWNER, ADMIN}`——任何团队的 OWNER/ADMIN 都能调平台管理 API,没有独立的"平台管理员"身份。
- **前端菜单硬编码**:`store/modules/permission.ts` 的 `getMenuByRole` 返回硬编码数组,菜单不可被"管理"。
- **SoybeanAdmin system 模块是死壳**:`api/system/api.ts` 调 `/api/v1/{menus,roles,users,departments}`——后端无对应路由,全部 404。
- **数据模型缺 RBAC 实体**:Prisma 里没有 `Menu` / `Permission` / `Role` 管理对象;`role-permission-dialog.vue` 保存逻辑全是 TODO,只弹假成功。
- **UI 设计蓝图与现状不符**:`docs/ui-design/index.html` 描绘了按 RBAC 渲染的 13 屏导航,但目前 dynamic menu 走硬编码路径,加新菜单项需要改前端代码 + 重发版。

参考实现 `TF-TrailVerDev` 已经过实战:commit `ff81ae8` "删除 users.role 列,授权统一走权限码,菜单按权限过滤"。我们直接采纳其核心模式,避免重蹈"先建冗余列再删"的覆辙。

## 2. 做什么(In Scope)

按 design doc §1-§7 交付,共 10 个 task:

1. **数据模型(6 个新表)**:SysRole / UserRole / Permission / RolePermission / SysMenu / MenuAuth。复用现有 `User` 表,TeamMember 原封不动(正交双层模型)。
2. **权限码一等公民**:60+ 条 `Permission` 种子,涵盖用户/角色/菜单/团队/数字员工/技能/MCP/会话/模型/凭据/审计/监控/平台准入(`platform:access`)。菜单可见性 = `set(SysMenu.meta.permissions) ∩ set(user.permissions)`,空集合 = 公共菜单。
3. **三角色种子 + 绑定矩阵**:`platform_admin`(平台管理员)/ `team_owner`(团队 OWNER)/ `member`(普通用户),对应 UI 设计三层模型。
4. **菜单 seed**:4 父菜单 + 13 子菜单,每子菜单的 `meta.permissions` 列出所需权限码,直接对应 UI 设计导航。
5. **鉴权 helper 新增**:`apps/web/lib/permissions.ts` 实现 `assertPlatformAdmin(req)`(校验 `platform:access`)、`assertPermission(uid, code)`、`assertAnyPermission`、`getUserPermissions(uid)`。
6. **`/api/v1/*` 全套 CRUD**:用户/角色/菜单/权限的列表+创建+更新+删除+绑权限/绑角色等 14+ 路由。
7. **`/api/v1/menus/user-menu`**:服务端按 `meta.permissions ∩ user.permissions` 递归过滤(目录级联隐藏)。
8. **`/api/v1/auth/me` 响应扩展**:增加 `permissions: string[]` + `roles: {code,name}[]`,前端 store 用。
9. **`/api/admin/*` 鉴权全量替换**:`assertIsAdmin` → `assertPlatformAdmin`,修复平台管理员隔离缺口(handler 复用)。
10. **前端动态菜单 + `v-auth` 指令 + system 模块接通**:删 `getMenuByRole` 硬编码、删 `department/dict` 死壳、改 `user/role/menu` 三个页面接通 `/api/v1/*`、改造 `role-permission-dialog.vue` 为勾权限码(以菜单树视觉呈现)。

## 3. 不做什么(Out of Scope)

- **MateClaw 全套**(工作流 DSL、触发器、知识库、多模态、多渠道 IM、企业级 RBAC、信创)——留后续 change。
- **数据权限码化**(参考项目 `data:all/dept/self`)——本项目用 TeamMember 团队级隔离,已够用。
- **SSO/OIDC 集成**——后续 change。
- **多租户 Tenant 模型**——当前单租户够用,扩 Tenant 时 RBAC 角色作用域改 `(tenantId, code)` 复合唯一。
- **部门管理**——UI 设计未列,与 TeamMember 功能重叠,删。
- **字典管理**——SoybeanAdmin 模板遗留,删。
- **M3 已包含的"动态菜单"局部改动**——M4 接管完整方案,M3 占位不动。

## 4. 关键口径(已拍板 2026-07-17)

- **R1 正交双层**:全局 RBAC 角色(管导航+平台动作)与 TeamMember(管数据范围)正交,两者不互相覆盖。
- **R2 权限码一等公民**:角色只是权限码的命名集合,菜单可见性完全由 `meta.permissions ∩ user.permissions` 决定,**不维护 RoleMenu 表**。
- **R3 三个预置角色**:`platform_admin` / `team_owner` / `member`,名称与 UI 设计三层一致。
- **R4 平台管理员独立身份**:`platform_admin` 通过 `UserRole → SysRole.code='platform_admin'` 判定;`/api/admin/*` 鉴权改用 `assertPlatformAdmin`,不再放给任意团队 OWNER/ADMIN。
- **R5 共存策略**:新 `/api/v1/*` 与现有 `/api/admin/*` 并存,handler 复用,仅鉴权 helper 替换。
- **R6 防锁死 migration**:env `INITIAL_PLATFORM_ADMIN_USERNAME`(默认 `admin`)对应用户自动绑 `platform_admin` 角色;登录时 `TeamMember.role='OWNER'` 自动绑 `team_owner` 全局角色。
- **R7 与 M3 解耦**:作为独立 change `m4-rbac-platform`,**不并入 M3**;M3 涉及导航边界保持 `getMenuByRole` 占位,M4 接管。
- **R8 模板清理**:删 `system/department/`、`system/dict/`、`store/modules/permission.ts` 中的 `getMenuByRole`/`isPlatformAdmin`/`isTeamAdmin`、`api/system/api.ts`。

## 5. 成功标准(Definition of Done)

1. **三角色 RBAC 流端到端**:建用户 → 绑 `member` → 登录 → `/me.permissions` 包含 member 权限码集 → `/menus/user-menu` 只含工作台 4 项。
2. **平台管理员隔离修复**:`platform_admin` 调 `/api/admin/users` 200;`team_owner`(无 `platform:access`)调 → 403。
3. **动态菜单**:登录后侧边栏由 `/api/v1/menus/user-menu` 服务端过滤后生成,改绑角色立即生效(重新登录后)。
4. **`v-auth` 指令**:`<el-button v-auth="'user:create'">` 无权限时从 DOM 移除,system 模块所有 CRUD 按钮覆盖。
5. **system 模块接通**:`/system/user`、`/system/role`、`/system/menu` 三个页面接通 `/api/v1/*`,CRUD 真实可用;`role-permission-dialog.vue` 保存的是权限码集合(以菜单树视觉呈现)。
6. **菜单 seed 对齐 UI 设计**:`docs/ui-design/index.html` 的 13 屏导航 ↔ SysMenu 4 父 + 13 子,逐屏截图对比一致。
7. **迁移回归**:30+ 个现有 `/api/admin/*` 集成测试全部继续通过(仅鉴权 helper 替换,handler 不动);历史 admin 用户登录后能进 `/platform/*`。
8. **安全基线**:`x-user-role` header 篡改无效(沿用现有 `assertIsAdmin` 安全注释);`platform:access` 缺位全员 403;`audit:view` 等敏感权限码操作写 `AuditLog`。
9. **测试覆盖**:单测覆盖 `assertPermission` / `_filter_tree` / `seed_*.ts` 幂等;E2E 三角色截图比对;`assertIsAdmin → assertPlatformAdmin` 切换前后回归通过。
10. **删除到位**:`getMenuByRole`、`department/`、`dict/`、`api/system/api.ts` 全删,grep 全仓无引用。

## 6. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| `/api/admin/*` 鉴权切换后历史团队 OWNER 锁死 | **高** | 防锁死 migration + 登录自动绑 `team_owner`;verify 阶段 e2e 覆盖 |
| 三角色种子与 UI 设计菜单不匹配(漏权限码 → 侧边栏空白) | 中 | T2+T3 seed 后立即人工核对(`member` 登录看侧边栏,应只有 4 项);E2E 三角色对比截图 |
| 动态菜单路由注入与现有静态路由冲突 | 中 | 路由守卫先 `removeRoute` 再 `addRoute`;灰度切换,旧 `getMenuByRole` 保留到 T10 删除 |
| 前端 `v-auth` 对异步加载 permissions 时序竞争 | 中 | `userStore` 持久化 permissions 到 sessionStorage,首屏先读缓存再 `fetchAndSetUserInfo` 校正 |
| Reference 项目栈差异(SQLAlchemy + FastAPI vs Prisma + Next.js) | 中 | 模式(权限码 / meta.permissions / user-menu 过滤)直接借鉴,实现细节按本项目栈重写 |
| M3 与 M4 并行时,M3 用 `getMenuByRole` 占位 → M4 切换时回归风险 | 中 | M3 涉及导航边界处加 adapter;M4 T8 切换前先 E2E 回归 |

```

Full source: openspec/changes/m4-rbac-platform/proposal.md

## openspec/changes/m4-rbac-platform/design.md

- Source: openspec/changes/m4-rbac-platform/design.md
- Lines: 1-581
- SHA256: 571a9eb9107d15557e59235481aff67f03c5c53d3e2d517b0288a96dd4f9b829

[TRUNCATED]

```md
# 设计:M4 RBAC 平台中台 — 用户/角色/权限码/菜单管理

> change: m4-rbac-platform
> 日期:2026-07-17
> 配套:proposal.md、docs/plans/2026-07-17-rbac-platform-design.md(完整设计,690 行)
> 参考实现:`/Users/xiejava/AIproject/TF-TrailVerDev`(commit `ff81ae8` 实战重构)

---

## 1. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│  apps/dashboard (Vue3) — 用户主界面 + 管理后台                │
│                                                              │
│  /me → store.user.permissions (Set<string>)                 │
│         │                                                    │
│         ├─► 路由守卫(buildRoutesFromMenu, 动态路由)           │
│         ├─► v-auth="'user:create'" 指令(按钮级)             │
│         └─► getUserMenuTree() ───► /api/v1/menus/user-menu   │
│                                                              │
└──────────────────────────┬───────────────────────────────────┘
                           │  /api  (REST)
┌──────────────────────────▼───────────────────────────────────┐
│  apps/web (Next.js App Router) — 后端 API                    │
│                                                              │
│  /api/v1/auth/me           ── permissions[] / roles[] 下发   │
│  /api/v1/menus/user-menu   ── 按权限过滤的菜单树             │
│  /api/v1/{roles,users,menus,permissions} ── CRUD             │
│  /api/admin/*              ── handler 复用,鉴权→platform:access│
│                                                              │
│  鉴权 helper(apps/web/lib/permissions.ts, 新增):             │
│    assertPlatformAdmin(req)        // platform:access 校验   │
│    assertPermission(uid, code)      // 单权限                 │
│    assertAnyPermission(uid, ...codes) // OR                  │
│    getUserPermissions(uid)         // 拉权限码集             │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│  数据层(Prisma + PostgreSQL)                                │
│                                                              │
│  新增 6 个模型:                                              │
│    SysRole / UserRole / Permission /                         │
│    RolePermission / SysMenu / MenuAuth                       │
│  复用:                                                       │
│    User / TeamMember / enum Role / AuditLog                  │
└──────────────────────────────────────────────────────────────┘
```

**核心原则**:
- **菜单可见性 = `set(SysMenu.meta.permissions) ∩ set(user.permissions)`**,空集合 = 公共菜单。
- **角色 = 权限码的命名集合**,不直接绑菜单(`RoleMenu` 表不存在)。
- **`/api/admin/*` 鉴权**:从 `assertIsAdmin`(任意团队 OWNER/ADMIN)切换到 `assertPlatformAdmin`(校验 `platform:access` 权限码),**根除平台管理员隔离缺口**。
- **正交双层**:全局 RBAC 角色管导航+平台动作;TeamMember 管数据范围;两者互不覆盖。

---

## 2. 技术栈(本 change 新增/调整)

| 层 | 已有 | 本 change 新增/调整 |
|----|------|-------------------|
| 数据模型 | Prisma + PostgreSQL | 加 6 个模型;User 不新增字段(用 UserRole 判定 platform_admin) |
| 后端 | Next.js App Router | 新增 `/api/v1/*` 14+ 路由;`/api/admin/*` 鉴权 helper 替换(handler 复用) |
| 鉴权 | `apps/web/lib/server-user.ts`、`team-auth.ts` | 新增 `apps/web/lib/permissions.ts`;**`assertIsAdmin` 函数保留**(兼容未来 TeamMember 团队 OWNER/ADMIN 的其他场景),调用点全量替换为 `assertPlatformAdmin` |
| 前端 | Vue3 + Element Plus + Pinia | 新增 `store/modules/menu.ts`、`directives/business/auth.ts`;改造 `store/modules/user.ts`、`router/utils.ts`、`router/guards.ts` |
| 测试 | Vitest + Playwright | 单测覆盖 `assertPermission`、`_filter_tree`;E2E 三角色登录侧边栏截图比对 |

---

## 3. 数据模型(6 个新表)

### 3.1 SysRole

全局 RBAC 角色,**正交于** TeamMember.role(后者管团队数据范围):

```prisma
model SysRole {
  id        String   @id @default(cuid())
  code      String   @unique         // platform_admin | team_owner | member | <自定义>
  name      String                    // 显示名

```

Full source: openspec/changes/m4-rbac-platform/design.md

## openspec/changes/m4-rbac-platform/tasks.md

- Source: openspec/changes/m4-rbac-platform/tasks.md
- Lines: 1-153
- SHA256: 1e2b66ca9c88272a4408335fea7ec4b695ab7e46a593580f10dbbee00523de12

[TRUNCATED]

```md
# 任务清单:M4 RBAC 平台中台 — 用户/角色/权限码/菜单管理

> change: m4-rbac-platform
> 日期:2026-07-17
> 状态:open(等待 brainstorming 确认设计稿完成 → 进 build 阶段)
> 配套:proposal.md / design.md / specs/rbac-platform/spec.md

---

## 0. 基线门禁(必跑)

- [ ] B0.1 `pnpm install` 通过
- [ ] B0.2 `pnpm --filter @ai-agent-workshop/web build` 通过
- [ ] B0.3 `pnpm --filter @ai-agent-workshop/dashboard build` 通过
- [ ] B0.4 现有 30+ 个 `/api/admin/*` 集成测试基线通过(锁定切换鉴权前的可重现状态)

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


```

Full source: openspec/changes/m4-rbac-platform/tasks.md

## openspec/changes/m4-rbac-platform/specs/rbac-platform/spec.md

- Source: openspec/changes/m4-rbac-platform/specs/rbac-platform/spec.md
- Lines: 1-368
- SHA256: 435b22a293557f57215d12e656d8cfb5ec304acb23b2d9b3f6867b351d1c0b2d

[TRUNCATED]

```md
# Delta Spec:M4 RBAC 平台中台 — 用户/角色/权限码/菜单管理

> Change: m4-rbac-platform
> Date: 2026-07-17
> 基于 proposal.md / design.md / tasks.md,并补齐 brainstorming 中发现的验收场景缺口。

---

## ADDED Requirements

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

```

Full source: openspec/changes/m4-rbac-platform/specs/rbac-platform/spec.md
