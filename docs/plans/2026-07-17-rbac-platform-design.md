# 技术设计:RBAC 平台中台(用户/角色/权限码/菜单管理)

> 日期:2026-07-17
> 上游:OpenSpec change `m4-rbac-platform`(待开)
> 参考实现:`/Users/xiejava/AIproject/TF-TrailVerDev`(已落地的 RBAC 中台,经实战重构:删除 `users.role` 列、授权统一走权限码、菜单按权限过滤)
> 本文档是 open→design 阶段的合并设计稿。

---

## 0. 背景与动机

### 0.1 现状(已通过代码勘察确认)

| 能力 | 现状 | 评价 |
|------|------|------|
| 登录/改密/刷新 | `auth/login` → `/api/auth/user-login` + refresh(HttpOnly)+ 强制改密 | ✅ 端到端可用 |
| 团队 RBAC(OWNER/ADMIN/MEMBER) | `lib/team-auth.ts`、`assertIsAdmin`、`assertMemberOfTeam`、会话隐私分级 | ✅ 后端扎实 |
| `/api/admin/*` 鉴权 | `assertIsAdmin` = `getUserHighestRole` ∈ {OWNER, ADMIN} | ⚠️ **任何团队 OWNER/ADMIN 都进得去**,无独立平台管理员身份 |
| 前端 `store/modules/permission.ts` 菜单 | `getMenuByRole` 硬编码返回 4 角色静态菜单 | ⚠️ 不可管理 |
| 前端 `system/{menu,role,user,department,dict}` + `api/system/api.ts` | 调 `/api/v1/{menus,roles,users,departments}` | ❌ **后端无对应路由,全部 404** |
| `role-permission-dialog.vue`、`auth.vue` | 保存逻辑为 `TODO` + `ElMessage.success('权限保存成功')` 假成功 | ❌ 未接通 |
| Prisma 数据模型 | `User`/`Team`/`TeamMember`/enum `Role`/audit/invite/skill/mcp/session 等 | ✅ M3 主模型齐 |
| `Menu` / `Permission` / `Role` 实体(作为 RBAC 管理对象) | **缺失** | ❌ 无 RBAC 中台数据基础 |

### 0.2 UI 设计蓝图

`docs/ui-design/index.html` 的导航结构(13 屏):
- 工作区:工作空间 / Agent 工作台 / 多 Agent 编排
- 我的资源:数字员工 / 技能中心 / 我的设置
- 团队(OWNER):团队管理
- 平台管理(管理员):用户管理 / 模型配置 / MCP 精选库 / 技能精选库 / 数字员工模板 / 审计日志 / 监控大盘

**注意**:UI 设计的平台管理导航**没有**"菜单管理 / 角色管理 / 权限管理 / 部门管理 / 字典管理",但为了提供标准的中台能力(可配置菜单与角色),我们把这些作为**基础设施**建好,默认带一组种子(对用户不可见入口,管理员可用)。同时**删除** SoybeanAdmin 模板自带的 `department`/`dict`(与团队模型功能重叠,UI 设计未列)。

### 0.3 决策(已与用户确认)

| 决策 | 选择 |
|------|------|
| RBAC 范围 | **标准 RBAC 中台(加重)**——做实菜单/角色/权限 CRUD |
| 角色体系 | **正交双层**——全局 RBAC 角色(管导航+平台动作) + TeamMember(管数据范围) |
| SoybeanAdmin 模板 system 模块 | **保留并改造** `user/role/menu/audit-log`,**删除** `department/dict` |
| 新 change 归属 | 独立 `m4-rbac-platform`,**不并入 M3** |
| 与现有 `/api/admin/*` | **共存**——handler 复用,鉴权由 `assertIsAdmin` → `assertPlatformAdmin` |

### 0.4 借鉴 TF-TrailVerDev(以下称"参考项目")

参考项目已经过实战,2026-07-15 commit `ff81ae8` "删除 users.role 列,授权统一走权限码,菜单按权限过滤"。我们直接采纳其核心模式,避免重蹈"先建冗余列再删"的覆辙。

| 借鉴点 | 参考项目做法 | 我们采纳 |
|--------|-------------|---------|
| Permission 一等公民 | `Permission(code, module, name)` 独立表 | ✅ |
| 单一授权入口 | `require_permission("code")` 装饰器 | ✅,改 Next.js helper |
| 菜单按权限过滤 | `Menu.meta.permissions` JSON 列表,`/menu/user-menu` 服务端交集过滤 | ✅,核心机制 |
| `/me` 下发权限集 | `permissions: string[]` 进响应,前端 store 用 | ✅ |
| 按钮级权限 | `MenuAuth(menuId, mark)`,mark 即权限码 | ✅ |
| 不维护 RoleMenu | 角色不直接绑菜单,通过权限码间接决定 | ✅,原方案 `RoleMenu` 表删除 |
| 数据权限码化 | `data:all/dept/self` 作为权限码 + `apply_data_filter` | ❌ 不采纳——我们用 TeamMember 团队级数据范围 |
| 菜单 seed 模式 | `seed_menus.py` 幂等 upsert | ✅ |

---

## 1. 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│  前端 apps/dashboard (Vue3)                                  │
│                                                              │
│  /me → store.user.permissions (Set<string>)                  │
│         │                                                    │
│         ├─► 路由守卫(动态路由生成)                            │
│         ├─► v-auth="'user:create'" 指令(按钮级)              │
│         └─► getUserMenuTree() ────► /api/v1/menus/user-menu  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  后端 apps/web (Next.js App Router)                          │
│                                                              │
│  /api/v1/auth/me          ── permissions[] 下发              │
│  /api/v1/menus/user-menu  ── 按权限过滤的菜单树              │
│  /api/v1/{roles,users,menus,permissions} ── CRUD             │
│  /api/admin/*             ── handler 复用,鉴权 → platform:access │
│                                                              │
│  鉴权 helper(apps/web/lib/permissions.ts,新增):              │
│    assertPlatformAdmin(req)   // platform:access 校验        │
│    assertPermission(uid, code) // 单权限                     │
│    assertAnyPermission(uid,...codes) // OR                   │
│    getUserPermissions(uid)    // 拉权限码集                  │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  数据层(Prisma + PostgreSQL)                                │
│                                                              │
│  新增 6 个模型:SysRole / UserRole / Permission /             │
│                RolePermission / SysMenu / MenuAuth           │
│  复用:User / TeamMember / Role enum / AuditLog               │
└──────────────────────────────────────────────────────────────┘
```

**关键点**:
- **菜单可见性 = `set(SysMenu.meta.permissions) ∩ set(User.permissions)`,空集合 = 公共菜单**。
- **角色 = 权限码的命名集合**,不直接绑菜单。
- **`/api/admin/*` 鉴权**:以前是 `assertIsAdmin`(任意团队 OWNER/ADMIN),改为 `assertPlatformAdmin`(校验 `platform:access` 权限码)。**根除"任何团队 owner 都能调 /api/admin/*"的缺口**。

---

## 2. 数据模型

### 2.1 新增 Prisma 模型(6 个)

```prisma
/// 全局 RBAC 角色(正交于 TeamMember.role)
model SysRole {
  id        String   @id @default(cuid())
  code      String   @unique         // platform_admin | team_owner | member | <自定义>
  name      String                    // 显示名
  desc      String   @default("")
  enabled   Boolean  @default(true)
  sort      Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  userRoles       UserRole[]
  rolePermissions RolePermission[]

  @@index([enabled])
}

/// 用户 ↔ 全局角色(多对多,菜单权限取并集)
model UserRole {
  userId    String
  roleId    String
  createdAt DateTime @default(now())
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      SysRole @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@id([userId, roleId])
  @@index([roleId])
}

/// 权限码(模块:动作 命名,如 user:create)
model Permission {
  id          String   @id @default(cuid())
  code        String   @unique         // user:view / session:view / platform:access
  module      String                   // 用户管理 / 团队管理 / 平台准入
  name        String                   // 显示名,如 "创建用户"
  description String   @default("")
  sort        Int      @default(0)
  createdAt   DateTime @default(now())

  rolePermissions RolePermission[]

  @@index([module, sort])
}

/// 角色 ↔ 权限码(多对多)
model RolePermission {
  roleId       String
  permissionId String
  createdAt    DateTime @default(now())
  role         SysRole     @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission  @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  @@index([permissionId])
}

/// 菜单树(三层:directory | menu | button)
model SysMenu {
  id          String   @id @default(cuid())
  parentId    String?
  name        String                      // 唯一英文标识,如 "Workspace"
  title       String                      // 显示名
  path        String   @default("")       // 前端路由 path
  component   String   @default("")       // 前端组件路径
  icon        String   @default("")
  type        String   @default("menu")   // directory | menu | button
  authMark    String   @default("")       // button 类型的权限码
  sort        Int      @default(0)
  visible     Boolean  @default(true)     // is_hide
  enabled     Boolean  @default(true)     // is_enable
  meta        String   @default("{}")      // JSON: { permissions: ["user:view"], ... }
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  parent     SysMenu?   @relation("MenuTree", fields: [parentId], references: [id], onDelete: SetNull)
  children   SysMenu[]  @relation("MenuTree")
  menuAuths  MenuAuth[]

  @@unique([parentId, name])
  @@index([parentId])
  @@index([type, enabled])
}

/// 元素权限(页面内按钮/元素的显隐)
model MenuAuth {
  id        String   @id @default(cuid())
  menuId    String
  title     String                       // "新增用户"
  mark      String                       // "system:user:add"——一个权限码
  sort      Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  menu SysMenu @relation(fields: [menuId], references: [id], onDelete: Cascade)

  @@unique([menuId, mark])
  @@index([menuId])
}
```

### 2.2 关键变更:删除原计划的 `RoleMenu`

参考项目最终方案中,角色**不直接绑菜单**——菜单可见性完全由"菜单 `meta.permissions` ∩ 用户权限码"决定。
原方案中"勾选菜单保存"的 UI 行为,在 UI 层把"勾菜单树"翻译成"勾权限码集合"(参考 `backend/app/routers/system/menu.py:237 save_role_permissions`)。
因此**原计划的 `RoleMenu` 表删除**,前端 `system/role/auth.vue`、`role-permission-dialog.vue` 改造为勾权限码(以菜单树视觉呈现)。

### 2.3 既有模型微调

- `User` 不新增 `isPlatformAdmin` 字段——通过 `UserRole → SysRole.code='platform_admin'` 判定。
- `UserRole` 是新建表,**不**与 `TeamMember` 命名冲突——TeamMember(团队成员)+ UserRole(全局角色绑定),正交。
- `AuditLog` 不需调整,既有 action 命名足够(RBAC 操作复用 `user.create` / `role.update` 等)。

### 2.4 枚举扩展(可选)

不引入新 enum;`SysRole.code` 用字符串以便扩展。`Permission.code` 与 `Module` 也用字符串。

---

## 3. 权限码种子(60+ 条,模块化)

```text
用户管理    user:view / create / edit / delete / disable / reset-password / assign-role
角色管理    role:view / create / edit / delete / assign-permission
菜单管理    menu:view / create / edit / delete
团队管理    team:view / create / edit / invite / add-member / remove-member / change-role
数字员工    agent:view / create / edit / delete / clone / bind-skill / bind-mcp
技能管理    skill:view / install / create / edit / delete / scope
MCP 管理    mcp:view / create / edit / delete / bind / credential
会话管理    session:view / create / edit / delete / share
模型管理    model:view / create / edit / delete / default / set-fallback
凭据管理    apikey:view / edit
审计管理    audit:view
监控管理    monitor:view
平台准入    platform:access                # 把关 /api/admin/*
```

种子脚本:`apps/web/prisma/seed/permissions.ts`,幂等 upsert(参考 `seed_permissions.py:126-149` 的 `existing → skip / else create` 模式)。

---

## 4. 三角色种子与权限码绑定

| 角色 `code` | 绑定的权限码(并集) |
|------------|-------------------|
| `platform_admin` | `platform:access` + `user:*` + `role:*` + `menu:*` + `team:view` + `agent:*` + `skill:*` + `mcp:*` + `session:view` + `model:*` + `apikey:view` + `audit:view` + `monitor:view` |
| `team_owner` | `team:view/edit/invite/add-member/remove-member/change-role` + `agent:view/create/edit/clone/bind-skill/bind-mcp` + `skill:view/install` + `mcp:view/bind` + `session:view` + `audit:view` |
| `member` | `agent:view/create/edit/clone`(personal) + `skill:view/install`(personal) + `mcp:view`(personal) + `session:view/create/edit/delete` + `apikey:view/edit` |

种子脚本:`apps/web/prisma/seed/roles.ts` ——幂等 upsert SysRole 三条 + 批量插入 RolePermission。

---

## 5. 菜单 seed(UI 设计 13 屏 → SysMenu)

### 5.1 菜单树结构

```
工作区(目录)
├── 工作空间             meta.permissions = []                              # 公共
├── Agent 工作台          meta.permissions = ["session:view"]
└── 多 Agent 编排        meta.permissions = ["session:view", "agent:view"]

我的资源(目录)
├── 数字员工             meta.permissions = ["agent:view"]
├── 技能中心             meta.permissions = ["skill:view"]
└── 我的设置             meta.permissions = []                              # 公共

团队(OWNER)
└── 团队管理             meta.permissions = ["team:view"]

平台管理(管理员)
├── 用户管理             meta.permissions = ["user:view"]
├── 模型配置             meta.permissions = ["model:view"]
├── MCP 精选库           meta.permissions = ["mcp:view"]
├── 技能精选库           meta.permissions = ["skill:view"]
├── 数字员工模板         meta.permissions = ["agent:view"]
├── 审计日志             meta.permissions = ["audit:view"]
└── 监控大盘             meta.permissions = ["monitor:view"]
```

### 5.2 用户菜单过滤算法(参考 `backend/app/routers/system/menu.py:88-118`)

```
input: 全部 enabled=true 的 SysMenu + user.permissions(Set<string>)
output: 过滤后的菜单树

filter(node):
  if node.children:
    kept_children = filter each child
    if node.type == "directory":
      if kept_children: keep(node, kept_children)  # 目录级联
      else: drop(node)
    else:
      if hasAccess(node) and kept_children: keep(node, kept_children)
      elif hasAccess(node) and not kept_children: keep(node, [])
      else: drop(node)
  else:
    if hasAccess(node): keep(node)
    else: drop(node)

hasAccess(node):
  meta.permissions 为空 → true (公共菜单)
  meta.permissions 非空 → set(meta.permissions) ∩ user.permissions ≠ ∅
```

**重要**:父目录菜单若无 `meta.permissions` 不看权限,只看子菜单级联;父目录无可见子菜单则整段隐藏。

### 5.3 种子脚本

`apps/web/prisma/seed/menus.ts`,幂等 upsert(参考 `seed_menus.py:71-93` 的 `upsert_parent` 模式)。

---

## 6. API 契约

### 6.1 新增 `/api/v1/*`(放在 `apps/web/app/api/v1/`)

| 方法 | 路径 | 权限要求 | 说明 |
|------|------|---------|------|
| GET | `/api/v1/auth/me` | 已登录 | 现有路由,**响应增加** `permissions: string[]`、`roles: {code,name}[]` |
| GET | `/api/v1/permissions` | 已登录 | 权限码全表(只读,种子数据) |
| GET | `/api/v1/menus/tree` | `menu:view` | 完整菜单树(菜单管理页) |
| GET | `/api/v1/menus/user-menu` | 已登录 | 当前用户可见菜单树 |
| POST | `/api/v1/menus` | `menu:create` | 创建菜单 |
| PUT | `/api/v1/menus/:id` | `menu:edit` | 更新菜单 |
| DELETE | `/api/v1/menus/:id` | `menu:delete` | 删除菜单 |
| GET | `/api/v1/menus/role/:roleId` | `role:view` | 取角色绑定的权限码集合 |
| PUT | `/api/v1/menus/role/:roleId` | `role:assign-permission` | 保存角色绑定的权限码 |
| GET | `/api/v1/roles` | `role:view` | 角色列表(分页) |
| POST | `/api/v1/roles` | `role:create` | 创建角色 |
| PUT | `/api/v1/roles/:id` | `role:edit` | 更新角色 |
| DELETE | `/api/v1/roles/:id` | `role:delete` | 删除角色 |
| GET | `/api/v1/users` | `user:view` | 用户列表(分页) |
| POST | `/api/v1/users` | `user:create` | 创建用户(随机密码,必须改密) |
| PUT | `/api/v1/users/:id` | `user:edit` | 更新用户 |
| PUT | `/api/v1/users/:id/roles` | `user:assign-role` | 设置用户的全局角色 |
| PUT | `/api/v1/users/:id/disable` | `user:disable` | 启用/停用 |
| PUT | `/api/v1/users/:id/reset-password` | `user:reset-password` | 重置密码 |

### 6.2 现有路由调整(`/api/admin/*` 鉴权替换)

所有 `/api/admin/*` 路由(30+ 文件):
- 现有: `const admin = await assertIsAdmin(req)`(`x-user-role` 不可信,只查 DB)
- 改: `const admin = await assertPlatformAdmin(req)`(校验 `UserRole → SysRole.code='platform_admin'`)

**`apps/web/lib/permissions.ts`(新增)**:

```ts
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";

/** 校验当前请求者拥有指定权限码。req.headers.x-user-id 不可信时改为查 token。 */
export async function assertPlatformAdmin(
  req: NextRequest
): Promise<{ userId: string } | null> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return null;
  const ok = await assertPermission(userId, "platform:access");
  return ok ? { userId } : null;
}

export async function assertPermission(
  userId: string,
  code: string
): Promise<boolean> {
  const row = await prisma.permission.findFirst({
    where: {
      code,
      rolePermissions: {
        some: { role: { userRoles: { some: { userId } } } },
      },
    },
    select: { id: true },
  });
  return row !== null;
}

export async function assertAnyPermission(
  userId: string,
  ...codes: string[]
): Promise<boolean> {
  for (const c of codes) if (await assertPermission(userId, c)) return true;
  return false;
}

export async function getUserPermissions(userId: string): Promise<string[]> {
  const rows = await prisma.permission.findMany({
    where: {
      rolePermissions: {
        some: { role: { userRoles: { some: { userId } } } },
      },
    },
    select: { code: true },
  });
  return rows.map((r) => r.code);
}
```

### 6.3 `/api/v1/auth/me` 响应(扩展)

```jsonc
{
  "id": "user_xxx",
  "username": "alice",
  "mustChangePassword": false,
  "roles": [
    { "code": "platform_admin", "name": "平台管理员" }
  ],
  "permissions": [
    "platform:access",
    "user:view", "user:create", "user:edit",
    "role:view", "role:create", "role:edit", "role:delete", "role:assign-permission",
    "menu:view", "menu:create", "menu:edit", "menu:delete",
    "team:view", "team:edit", "team:invite", "team:add-member", "team:remove-member", "team:change-role",
    "agent:view", "agent:create", "agent:edit", "agent:delete", "agent:clone", "agent:bind-skill", "agent:bind-mcp",
    "skill:view", "skill:install", "skill:create", "skill:edit", "skill:delete", "skill:scope",
    "mcp:view", "mcp:create", "mcp:edit", "mcp:delete", "mcp:bind", "mcp:credential",
    "session:view", "session:create", "session:edit", "session:delete", "session:share",
    "model:view", "model:create", "model:edit", "model:delete", "model:default", "model:set-fallback",
    "apikey:view", "apikey:edit",
    "audit:view",
    "monitor:view"
  ]
}
```

---

## 7. 前端改造

### 7.1 状态管理

`apps/dashboard/src/store/modules/user.ts` 扩展:
```ts
state: {
  userInfo: Api.Auth.UserInfo | null
  permissions: Set<string>
  roles: { code: string; name: string }[]
}
getters: {
  hasPermission: (code: string) => boolean
  hasAnyPermission: (...codes: string[]) => boolean
}
actions: {
  fetchAndSetUserInfo(): Promise<void>  // 调 /api/v1/auth/me 写 permissions/roles
}
```

登录后或刷新时调 `fetchAndSetUserInfo`;401 自动刷新 token 后重试一次(已有机制)。

### 7.2 动态菜单

`apps/dashboard/src/store/modules/menu.ts`(新建):
```ts
state: { menuTree: MenuNode[]; loaded: boolean }
actions: {
  async loadMenuTree() {
    const tree = await getUserMenuTree()  // /api/v1/menus/user-menu
    this.menuTree = tree
    this.loaded = true
  }
}
```

`apps/dashboard/src/router/utils.ts`:
```ts
export function buildRoutesFromMenu(menuTree): RouteRecordRaw[] { ... }
// 菜单节点 path + component → 路由项;无 component 的目录菜单跳过路由
```

`apps/dashboard/src/router/guards.ts` 登录后:
```ts
await userStore.fetchAndSetUserInfo()
await menuStore.loadMenuTree()
const dynamic = buildRoutesFromMenu(menuStore.menuTree)
router.addRoute(...)  // 动态注入
next(to)
```

**注意**:`store/modules/permission.ts` 的 `getMenuByRole` 硬编码**整段删除**;`Role` 类型保留(只用于 `hasPermission` 判断时的 role 校验,不再用于菜单生成)。

### 7.3 `v-auth` 指令

`apps/dashboard/src/directives/business/auth.ts`:
```ts
import type { Directive } from "vue"
import { useUserStore } from "@/store/modules/user"

export const auth: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    const code = binding.value
    const ok = useUserStore().hasPermission(code)
    if (!ok) el.parentNode?.removeChild(el)
  },
  updated(el, binding) {
    // permissions 变化时重新判断(用户切换角色后)
    const code = binding.value
    const ok = useUserStore().hasPermission(code)
    if (!ok) el.parentNode?.removeChild(el)
  },
}
```

用法:`<el-button v-auth="'user:create'">新增用户</el-button>`。

### 7.4 system 模块对接

| 页面 | 改造内容 |
|------|---------|
| `system/user/index.vue` | 改用 `api/v1/users`;表格行操作加 `v-auth`;停用/启用改 PUT `/users/:id/disable`;重置密码弹窗已存在 |
| `system/user/modules/user-dialog.vue` | 表单提交用 `/api/v1/users` POST/PUT;新增"分配角色"复选(SysRole 三种子) |
| `system/role/index.vue` | 改用 `api/v1/roles`;表格行操作加 `v-auth` |
| `system/role/modules/role-permission-dialog.vue` | **核心改造**:用 `api/v1/menus/role/:roleId` 拉权限码集合,以菜单树视觉呈现,但保存的是 `permissionCodes: string[]`;提交 PUT `/api/v1/menus/role/:roleId` |
| `system/role/modules/role-edit-dialog.vue` | 表单 name/desc/enabled/sort |
| `system/menu/index.vue` | 改用 `api/v1/menus/tree`;CRUD 用 `/api/v1/menus`;menu-dialog.vue 已存在,需补 `meta.permissions` 编辑 |
| `system/menu/modules/menu-dialog.vue` | `meta.permissions` 多选编辑(从 `/api/v1/permissions` 拉列表) |
| `system/menu/modal/authInfo.vue` | MenuAuth 列表编辑(可选,button 级用) |
| `system/audit-log/index.vue` | 现有路由,加 `v-auth="'audit:view'"` |

### 7.5 删除

- `system/department/`、`system/dict/` 全部删除(`views/`、`router/`、`types/` 对应引用清掉)。
- `store/modules/permission.ts` 中 `getMenuByRole`、`Role` 类型(若不再用)、`isPlatformAdmin`/`isTeamAdmin` 工具函数(若不再用)。
- `api/system/api.ts`(无用,前端不再调 `/api/v1/*` 走这里)。

---

## 8. Migration 顺序与防锁死

**关键风险**:`assertIsAdmin` → `assertPlatformAdmin` 切换后,**原本隐式拥有平台管理权限的团队 OWNER/ADMIN 都会失去 `/api/admin/*` 访问**,若无人持有 `platform:access` 权限码 → 全员 403 锁死。

### 8.1 Migration 顺序

1. **M1**:加 6 个新模型 + Permission seed(60+ 条,幂等)+ SysRole seed(3 条)+ RolePermission seed(三角色绑定矩阵)+ SysMenu seed(4 父 + 13 子)
2. **M2**:防锁死——把 env 变量 `INITIAL_PLATFORM_ADMIN_USERNAME`(默认 `admin`)对应的 User 自动绑 `platform_admin` 角色;若该用户不存在则跳过,等首次登录时绑定
3. **M3**:加 helper(`assertPermission`、`assertPlatformAdmin`、`getUserPermissions`、`assertAnyPermission`)+ 单元测试
4. **M4**:加 `/api/v1/*` 全套路由 + 集成测试
5. **M5**:扩展 `/api/v1/auth/me` 响应 + 前端 store
6. **M6**:**统一切换鉴权**(`assertIsAdmin` → `assertPlatformAdmin` 在 `/api/admin/*` 全量替换)+ E2E
7. **M7**:前端动态菜单 + `v-auth` + system 模块接通
8. **M8**:删除死代码(`department`、`dict`、`getMenuByRole`、`api/system/api.ts`)
9. **M9**:全量回归(已有 admin/* 集成测试必须继续通过)

### 8.2 平滑过渡(可选优化)

登录时若 `User.userRoles` 为空且 `TeamMember.role == 'OWNER'`,自动绑 `team_owner` 全局角色。**这个在 M5 之后的 helper 里做**,不需要 migration——避免历史团队 owner 立刻 403。

---

## 9. 测试策略

### 9.1 后端单元测试(覆盖率 ≥ 80%)

| 范围 | 关键断言 |
|------|---------|
| `assertPermission(userId, code)` | 真阳性(用户有该权限码)/ 假阳性(无)/ 跨角色并集去重 / 用户不存在 |
| `assertPlatformAdmin(req)` | 有 `platform:access` → 通过 / 无 → null / 无 header → null |
| `getUserPermissions(userId)` | 多角色并集 / 重复权限码去重 / 空用户返空数组 |
| `_filter_tree` | 空 permissions 公共放行 / 有 permissions 交集判断 / 目录级联隐藏 / 叶子单权限被剥父隐藏 |
| `seed_*.ts` | 幂等:第二次运行 `created_count=0`、无报错 |

### 9.2 后端集成测试(端到端 RBAC 流)

| 场景 | 预期 |
|------|------|
| 建用户 → 绑 `member` → 登录 → `/me.permissions` ⊇ member 权限码 / ⊉ platform:access / ⊉ user:delete | ✅ |
| 同用户改绑 `platform_admin` → `/me.permissions` 增加平台权限码 | ✅ |
| `platform_admin` 调 `/api/admin/users` | 200 |
| `team_owner`(无 platform:access)调 `/api/admin/users` | 403(修复缺口) |
| `member` 调 `/api/v1/roles`(需 role:view) | 403 |
| `team_owner` 调 `/api/v1/menus/user-menu` | 只看到工作区 + 团队管理 |
| `platform_admin` 调 `/api/v1/menus/user-menu` | 看到全部(工作区 + 我的资源 + 团队 + 平台管理) |
| `platform_admin` 创建角色 → 勾权限码 → 保存 → 用户绑该角色 → `/me.permissions` 含新码 | ✅ |
| 删除 SysMenu → 该菜单从所有 user-menu 中消失 | ✅ |
| `x-user-role: OWNER` header 篡改 | 无效,仍以 DB 为准(沿用现有 assertIsAdmin 安全注释) |

### 9.3 前端单元测试

| 范围 | 断言 |
|------|------|
| `hasPermission` | 存在权限码 → true / 不存在 → false / permissions 未加载态(空)→ false |
| `hasAnyPermission` | 多码 OR 语义 |
| `v-auth` 指令 | mount/update/unbind 生命周期;无权限节点从 DOM 移除 |
| `buildRoutesFromMenu` | 父目录无 component 不入路由;叶子有 component 入路由;空 children 保留叶子 |
| `filterTree` | 对照后端逻辑,空 meta.permissions 公共放行 |

### 9.4 前端 E2E(Playwright)

| 场景 | 预期 |
|------|------|
| member 登录 → 侧边栏只有"工作区 + 我的资源"4 项 | ✅ |
| team_owner 登录 → 侧边栏多"团队管理" | ✅ |
| platform_admin 登录 → 侧边栏多"平台管理"7 项 | ✅ |
| platform_admin 进 `/system/user` 可见操作按钮;member 进 → 按钮被 `v-auth` 移除 / 路由 403 | ✅ |
| 切换 platform_admin → member 后(改绑角色再登录)→ 侧边栏回到精简状态 | ✅ |

### 9.5 迁移回归

- 现有 admin/teams / admin/users / admin/mcp / admin/models / admin/audit 集成测试**全部继续通过**(handler 复用,鉴权替换)。
- TeamMember 行为不变,团队级数据范围(RBAC 之外)继续由 `assertMemberOfTeam` 控制。
- **预期行为变化**:团队 OWNER 调 `/api/admin/*` 由 200 变 403——release notes 必须明示。

---

## 10. OpenSpec / Comet 拆分

**新 change 名**:`m4-rbac-platform`
**目录**:`openspec/changes/m4-rbac-platform/{proposal.md,design.md,tasks.md,specs/}`
**Phase 流程**:open → design → build → verify → archive,走 Comet 流程(完整 `comet-guard` + `comet-state` 校验)。

### 10.1 tasks 拆分(10 个 task)

| ID | 标题 | 关键产物 |
|----|------|---------|
| T1 | Prisma migration + 6 个新模型 + enums | `prisma/schema.prisma` + migration SQL |
| T2 | Permission 种子脚本(60+ 条)+ 三角色种子 + 权限码绑定矩阵 | `prisma/seed/permissions.ts` + `roles.ts` + 单测 |
| T3 | SysMenu 种子(4 父 + 13 子)+ `meta.permissions` 配齐 + MenuAuth | `prisma/seed/menus.ts` + 单测 |
| T4 | `assertPlatformAdmin` + `assertPermission` + `assertAnyPermission` + `getUserPermissions` 实现 + 单测 | `apps/web/lib/permissions.ts` + 单元测试 |
| T5 | `/api/v1/*` 全套 CRUD(roles/permissions/users/menus)+ `/menus/user-menu` 过滤算法 + 集成测试 | `apps/web/app/api/v1/` 14 个路由文件 |
| T6 | `/api/v1/auth/me` 扩展响应(permissions/roles)+ 前端 store 改造 | 后端路由响应 + `apps/dashboard/src/store/modules/user.ts` |
| T7 | **`assertIsAdmin` → `assertPlatformAdmin` 全量替换** + 防锁死 migration | 全 `/api/admin/*` 路由 + M2 防锁死逻辑 + 集成测试回归 |
| T8 | 前端动态菜单(`getUserMenuTree` + `buildRoutesFromMenu` + 路由守卫)+ `v-auth` 指令 + E2E | `store/modules/menu.ts` + `router/utils.ts` + `router/guards.ts` + `directives/business/auth.ts` |
| T9 | system/{user,role,menu} 三个页面接通 + role-permission-dialog 改造 | `views/system/{user,role,menu}/` 改造 |
| T10 | 删除死代码(`department/`、`dict/`、`getMenuByRole`、`api/system/api.ts`)+ 全量回归 | 删文件 + 路由清理 + 单测/E2E |

### 10.2 与 M3 关系

- M3 原计划含"动态菜单"局部改动,因范围小被视作占位。M4 接管完整动态菜单,M3 涉及导航的边界留 `getMenuByRole` 占位(已存在),M4 替换。
- M3 的数字员工/技能/MCP 不受 M4 影响。
- M3 的 `auth/me` 响应暂不加 `permissions` 字段,M4 一起加(避免两次改前端类型)。

### 10.3 与既有 change 关系

`docs/review-clarifications.md` 已记录"凭证隔离铁律"等约束;本 change 不冲突。
`docs/superpowers/specs/2026-07-13-pi-web-m2-3-admin-user-management-design.md` 是 M2.3 的 admin user 管理,本 change 接管并升级为 RBAC 中台(向后兼容——`/api/admin/users` handler 复用)。

---

## 11. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| `/api/admin/*` 鉴权切换后历史团队 OWNER 锁死 | **高** | M2 防锁死 migration;M5 helper 登录自动绑 `team_owner` |
| 三角色种子与 UI 设计菜单不匹配(漏权限码导致侧边栏空白) | 中 | T2+T3 seed 后立即人工核对(`member` 登录看侧边栏,应只有 4 项);E2E 三角色对比截图 |
| 动态菜单路由注入与现有静态路由冲突 | 中 | 路由守卫先 `removeRoute` 再 `addRoute`;灰度切换,旧 `getMenuByRole` 保留到 T10 删除 |
| 前端 `v-auth` 指令对异步加载的 permissions 时序竞争 | 中 | `userStore` 持久化 permissions 到 sessionStorage,首屏先读缓存再 `fetchAndSetUserInfo` 校正 |
| Reference 项目与本项目数据访问模式差异(参考用 SQLAlchemy + FastAPI,我们用 Prisma + Next.js) | 中 | 模式(权限码 / meta.permissions / user-menu 过滤)直接借鉴,实现细节按本项目栈重写 |
| M3 与 M4 并行时,M3 用 `getMenuByRole` 占位 → M4 切换时回归风险 | 中 | M3 涉及导航边界处加 adapter,便于 M4 替换 |
| 删除 `department/`/`dict/` 后,SoybeanAdmin 模板升级需手动剔除 | 低 | 模板升级 review 检查清单加一行 |

---

## 12. 验证清单(verify 阶段)

- [ ] 三角色登录 E2E 截图与 UI 设计 `index.html` 一致
- [ ] `/me.permissions` 与 SysRole→RolePermission→Permission join 链路一致
- [ ] 30+ 个 `/api/admin/*` 集成测试全部通过(原断言保持 + 新增 `platform:access` 校验)
- [ ] `v-auth` 覆盖 system 模块所有按钮
- [ ] 迁移回归:历史用户(尤其 admin 用户)登录后能进 `/platform/*`
- [ ] 审计:`role.update`、`user.assign-role`、`menu.delete` 等敏感操作写 `AuditLog`(沿用现有 `lib/audit-log.ts`)
- [ ] 性能:`/menus/user-menu` < 50ms(简单 join + 递归过滤)
- [ ] 安全:`x-user-role` header 篡改无效;无 token 401;token 过期 401(沿用现有机制)

---

## 13. 后续可选(本 change 不做,记入 backlog)

- 部门管理 → 已删除,但若产品后续需要跨团队组织视图,可重建 Department + 与 Team 双轨。
- 数据权限码化(参考项目 `data:all/dept/self`)——目前 TeamMember 团队级隔离足够。
- SSO / OIDC 集成——M4 之后单独 change。
- 多租户支持——目前单租户够用,扩 Tenant 模型时 RBAC 角色作用域要改成 `(tenantId, code)` 复合唯一。

---

**Status**: 设计稿完成,等待用户确认后:
1. 落 `openspec/changes/m4-rbac-platform/proposal.md`(按 OpenSpec 模板)
2. 起 Comet change `m4-rbac-platform`(走 `/comet-open`)
3. 按 T1-T10 推进 build 阶段