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
| 删除 `department/`/`dict/` 后,SoybeanAdmin 模板升级需手动剔除 | 低 | 模板升级 review 检查清单加一行 |
| 大量 helper 测试覆盖不足 | 中 | T4 单测覆盖 `assertPermission` 真假阳性 + 跨角色并集;T5 集成测试覆盖 user-menu 过滤递归 |

## 7. 里程碑衔接

- 本 change 即 M4(标准 RBAC 中台),在 M3(Vue3 工作台+数字员工+编排)之后独立推进。
- 不动 M3 的数字员工/技能/MCP/编排代码。
- `assertIsAdmin` 当前在 `/api/admin/*` 30+ 处使用,本 change 替换为 `assertPlatformAdmin`,但函数本身**保留**(为兼容 TeamMember 团队 OWNER/ADMIN 的未来其他场景,如内部仪表盘)。改名而非删除。
- 参考项目 `TF-TrailVerDev` 已落地的 RBAC 模式,本 change 直接借鉴并适配本项目栈(Prisma + Next.js + Vue3)。
- M5(生产加固:Tool Guard 审批流、监控完善、KMS/Vault 迁移 `APP_ENCRYPTION_KEY`、Postgres RLS)留后续。

---

## 8. 参考

- 设计文档:`docs/plans/2026-07-17-rbac-platform-design.md`(690 行,13 章节)
- 参考实现:`/Users/xiejava/AIproject/TF-TrailVerDev`(commit `ff81ae8` "refactor(rbac): 删除 users.role 列,授权统一走权限码,菜单按权限过滤")
- UI 设计:`docs/ui-design/index.html`(13 屏导航)
- M3 提案:`openspec/changes/m3-vue3-workbench/proposal.md`
- 既有 RBAC 相关:`apps/web/lib/team-auth.ts`、`apps/web/lib/server-user.ts`、`apps/web/lib/user-role.ts`(已存在的 team-level RBAC,与本 change 正交)