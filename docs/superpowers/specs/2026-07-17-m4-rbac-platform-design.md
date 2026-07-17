---
comet_change: m4-rbac-platform
role: technical-design
canonical_spec: openspec
---

# 技术设计：M4 RBAC 平台中台 — 用户/角色/权限码/菜单管理

> 日期：2026-07-17
> 上游：`openspec/changes/m4-rbac-platform/`（proposal / design / tasks / specs delta）
> 参考实现：`/Users/xiejava/AIproject/TF-TrailVerDev`（commit `ff81ae8` 实战重构）
> 本文档是 open 阶段 `design.md` 的结构化技术细化：实现方案、风险、测试策略、边界条件。

---

## 0. Build 入口门控（必须先做）

在进入任何实现前，以下四项必须通过：

| 门控 | 内容 | 产出 |
|------|------|------|
| B0.1 | `pnpm install` 通过 | 终端输出 |
| B0.2 | `pnpm --filter @ai-agent-workshop/web build` 通过 | 终端输出 |
| B0.3 | `pnpm --filter @ai-agent-workshop/dashboard build` 通过 | 终端输出 |
| B0.4 | 现有 30+ 个 `/api/admin/*` 集成测试基线通过 | 终端输出（锁定切换鉴权前的可重现状态） |

---

## 1. 总体架构与核心原则

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

**核心原则**：
- **菜单可见性 = `set(SysMenu.meta.permissions) ∩ set(user.permissions)`**，空集合 = 公共菜单。
- **角色 = 权限码的命名集合**，不直接绑菜单（`RoleMenu` 表不存在）。
- **`/api/admin/*` 鉴权**：从 `assertIsAdmin`（任意团队 OWNER/ADMIN）切换到 `assertPlatformAdmin`（校验 `platform:access` 权限码），**根除平台管理员隔离缺口**。
- **正交双层**：全局 RBAC 角色管导航+平台动作；TeamMember 管数据范围；两者互不覆盖。

---

## 2. 技术栈（本 change 新增/调整）

| 层 | 已有 | 本 change 新增/调整 |
|----|------|-------------------|
| 数据模型 | Prisma + PostgreSQL | 加 6 个模型；User 不新增字段（用 UserRole 判定 platform_admin） |
| 后端 | Next.js App Router | 新增 `/api/v1/*` 14+ 路由；`/api/admin/*` 鉴权 helper 替换（handler 复用） |
| 鉴权 | `apps/web/lib/server-user.ts`、`team-auth.ts` | 新增 `apps/web/lib/permissions.ts`；**`assertIsAdmin` 函数保留**（兼容未来 TeamMember 团队 OWNER/ADMIN 的其他场景），调用点全量替换为 `assertPlatformAdmin` |
| 前端 | Vue3 + Element Plus + Pinia | 新增 `store/modules/menu.ts`、`directives/business/auth.ts`；改造 `store/modules/user.ts`、`router/utils.ts`、`router/guards.ts` |
| 测试 | Vitest + Playwright | 单测覆盖 `assertPermission`、`_filter_tree`；E2E 三角色登录侧边栏截图比对 |

---

## 3. 数据模型（6 个新表）

### 3.1 SysRole

全局 RBAC 角色，**正交于** TeamMember.role（后者管团队数据范围）：

```prisma
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
```

### 3.2 UserRole（用户 ↔ SysRole 多对多）

```prisma
model UserRole {
  userId    String
  roleId    String
  createdAt DateTime @default(now())
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      SysRole @relation(fields: [roleId], references: [id], onDelete: Cascade)
  @@id([userId, roleId])
  @@index([roleId])
}
```

复用现有 `User.id`（不建 SysUser）。菜单权限取并集（多角色）。

### 3.3 Permission（权限码一等公民）

```prisma
model Permission {
  id          String   @id @default(cuid())
  code        String   @unique         // user:view / session:view / platform:access
  module      String                   // 用户管理 / 团队管理 / 平台准入
  name        String                   // 显示名
  description String   @default("")
  sort        Int      @default(0)
  createdAt   DateTime @default(now())
  rolePermissions RolePermission[]
  @@index([module, sort])
}
```

### 3.4 RolePermission（角色 ↔ 权限码 多对多）

```prisma
model RolePermission {
  roleId       String
  permissionId String
  createdAt    DateTime @default(now())
  role         SysRole     @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission  @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  @@id([roleId, permissionId])
  @@index([permissionId])
}
```

**注意**：**不维护 `RoleMenu` 表**。菜单可见性由 `SysMenu.meta.permissions ∩ user.permissions` 决定。角色管理 UI 的"勾选菜单"行为在 UI 层翻译为"勾选权限码集合"（对齐参考项目 `backend/app/routers/system/menu.py:237 save_role_permissions`）。

### 3.5 SysMenu（菜单树）

```prisma
model SysMenu {
  id          String   @id @default(cuid())
  parentId    String?
  name        String                      // 唯一英文标识
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
```

### 3.6 MenuAuth（元素/按钮权限）

```prisma
model MenuAuth {
  id        String   @id @default(cuid())
  menuId    String
  title     String                       // "新增用户"
  mark      String                       // "system:user:add" — 一个权限码
  sort      Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  menu SysMenu @relation(fields: [menuId], references: [id], onDelete: Cascade)
  @@unique([menuId, mark])
  @@index([menuId])
}
```

---

## 4. 权限码种子（60+ 条，模块化）

```
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

种子脚本：`apps/web/prisma/seed/permissions.ts`（幂等 upsert，参考 `TF-TrailVerDev/backend/scripts/seed_permissions.py:126-149` 的 `existing → skip / else create` 模式）。

---

## 5. 三角色种子与权限码绑定

| 角色 `code` | 绑定的权限码（并集） |
|------------|-------------------|
| `platform_admin` | `platform:access` + `user:*` + `role:*` + `menu:*` + `team:view` + `agent:*` + `skill:*` + `mcp:*` + `session:view` + `model:*` + `apikey:view` + `audit:view` + `monitor:view` |
| `team_owner` | `team:view/edit/invite/add-member/remove-member/change-role` + `agent:view/create/edit/clone/bind-skill/bind-mcp` + `skill:view/install` + `mcp:view/bind` + `session:view` + `audit:view` |
| `member` | `agent:view/create/edit/clone`(personal) + `skill:view/install`(personal) + `mcp:view`(personal) + `session:view/create/edit/delete` + `apikey:view/edit` |

种子脚本：`apps/web/prisma/seed/roles.ts`（幂等 upsert 3 个 SysRole + 批量插入 RolePermission）。

---

## 6. 菜单 seed（UI 设计 13 屏 → SysMenu）

```
工作区（目录）
├── 工作空间             meta.permissions = []                          # 公共
├── Agent 工作台          meta.permissions = ["session:view"]
└── 多 Agent 编排        meta.permissions = ["session:view", "agent:view"]

我的资源（目录）
├── 数字员工             meta.permissions = ["agent:view"]
├── 技能中心             meta.permissions = ["skill:view"]
└── 我的设置             meta.permissions = []                          # 公共

团队（OWNER）
└── 团队管理             meta.permissions = ["team:view"]

平台管理（管理员）
├── 用户管理             meta.permissions = ["user:view"]
├── 模型配置             meta.permissions = ["model:view"]
├── MCP 精选库           meta.permissions = ["mcp:view"]
├── 技能精选库           meta.permissions = ["skill:view"]
├── 数字员工模板         meta.permissions = ["agent:view"]
├── 审计日志             meta.permissions = ["audit:view"]
└── 监控大盘             meta.permissions = ["monitor:view"]
```

**用户菜单过滤算法**（参考 `backend/app/routers/system/menu.py:88-118`）：

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

**重要**：父目录菜单若无 `meta.permissions` 不看权限，只看子菜单级联；父目录无可见子菜单则整段隐藏。

种子脚本：`apps/web/prisma/seed/menus.ts`（幂等 upsert，参考 `seed_menus.py:71-93` 的 `upsert_parent` 模式）。

---

## 7. API 契约

### 7.1 新增 `/api/v1/*`

| 方法 | 路径 | 权限要求 |
|------|------|---------|
| GET | `/api/v1/auth/me` | 已登录（**响应扩展** permissions[]、roles[]） |
| GET | `/api/v1/permissions` | 已登录 |
| GET | `/api/v1/menus/tree` | `menu:view` |
| GET | `/api/v1/menus/user-menu` | 已登录 |
| POST/PUT/DELETE | `/api/v1/menus[/:id]` | `menu:create/edit/delete` |
| GET | `/api/v1/menus/role/:roleId` | `role:view` |
| PUT | `/api/v1/menus/role/:roleId` | `role:assign-permission` |
| GET | `/api/v1/roles` | `role:view` |
| POST/PUT/DELETE | `/api/v1/roles[/:id]` | `role:create/edit/delete` |
| GET | `/api/v1/users` | `user:view` |
| POST | `/api/v1/users` | `user:create` |
| PUT | `/api/v1/users/:id` | `user:edit` |
| PUT | `/api/v1/users/:id/roles` | `user:assign-role` |
| PUT | `/api/v1/users/:id/disable` | `user:disable` |
| PUT | `/api/v1/users/:id/reset-password` | `user:reset-password` |

### 7.2 `/api/admin/*` 鉴权替换（handler 复用）

```ts
// 现有（将被替换）:
import { assertIsAdmin } from "@/lib/server-user";
const admin = await assertIsAdmin(req);

// 本 change 替换为:
import { assertPlatformAdmin } from "@/lib/permissions";
const admin = await assertPlatformAdmin(req);
```

涉及 30+ 个 `/api/admin/*` 路由文件，全部机械化替换。**handler body 不动**，仅鉴权 helper 替换。

### 7.3 新增鉴权 helper（`apps/web/lib/permissions.ts`）

```ts
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";

/** 校验当前请求者拥有 platform:access（把 /api/admin/* 入口）。 */
export async function assertPlatformAdmin(req: NextRequest) {
  const userId = req.headers.get("x-user-id");
  if (!userId) return null;
  return (await assertPermission(userId, "platform:access"))
    ? { userId }
    : null;
}

/** 校验用户是否拥有指定权限码（经 UserRole→SysRole→RolePermission→Permission 链）。 */
export async function assertPermission(userId: string, code: string) {
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

export async function assertAnyPermission(userId: string, ...codes: string[]) {
  for (const c of codes) if (await assertPermission(userId, c)) return true;
  return false;
}

/** 取用户全部权限码（用于 /me 下发）。 */
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

**安全注释**：鉴权始终查 DB，**不信任 `x-user-role` header**（沿用现有 `assertIsAdmin` 安全注释）。

### 7.4 `/api/v1/auth/me` 响应扩展

```jsonc
{
  "id": "user_xxx",
  "username": "alice",
  "mustChangePassword": false,
  "roles": [
    { "code": "platform_admin", "name": "平台管理员" }
  ],
  "permissions": [
    "platform:access", "user:view", "user:create", /* ... */
  ]
}
```

---

## 8. 前端改造

### 8.1 状态管理

`apps/dashboard/src/store/modules/user.ts` 扩展：
```ts
state: {
  userInfo: Api.Auth.UserInfo | null,
  permissions: Set<string>,
  roles: { code: string; name: string }[],
}
getters: {
  hasPermission(code: string): boolean
  hasAnyPermission(...codes: string[]): boolean
}
actions: {
  fetchAndSetUserInfo(): Promise<void>  // 调 /api/v1/auth/me
}
```

登录后或刷新页面时调 `fetchAndSetUserInfo`；permissions 持久化到 sessionStorage，首屏先读缓存再校正。

### 8.2 动态菜单（替换硬编码 `getMenuByRole`）

`apps/dashboard/src/store/modules/menu.ts`（新建）：
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

`apps/dashboard/src/router/utils.ts`：
```ts
export function buildRoutesFromMenu(menuTree): RouteRecordRaw[] { ... }
```

`apps/dashboard/src/router/guards.ts` 登录后：
```ts
await userStore.fetchAndSetUserInfo()
await menuStore.loadMenuTree()
const dynamic = buildRoutesFromMenu(menuStore.menuTree)
router.addRoute(...)  // 动态注入
next(to)
```

### 8.3 `v-auth` 指令

`apps/dashboard/src/directives/business/auth.ts`：
```ts
export const auth: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    if (!useUserStore().hasPermission(binding.value)) {
      el.parentNode?.removeChild(el);
    }
  },
  updated(el, binding) {
    if (!useUserStore().hasPermission(binding.value)) {
      el.parentNode?.removeChild(el);
    }
  },
};
```

用法：`<el-button v-auth="'user:create'">新增用户</el-button>`。

### 8.4 system 模块对接

| 页面 | 改造内容 |
|------|---------|
| `system/user/index.vue` | 改用 `api/v1/users`；表格行操作加 `v-auth`；停用/启用改 PUT `/users/:id/disable`；重置密码弹窗已存在 |
| `system/user/modules/user-dialog.vue` | 表单提交用 `/api/v1/users` POST/PUT；新增"分配角色"复选（SysRole 三种子） |
| `system/role/index.vue` | 改用 `api/v1/roles`；表格行操作加 `v-auth` |
| `system/role/modules/role-permission-dialog.vue` | **核心改造**：用 `api/v1/menus/role/:roleId` 拉权限码集合，以菜单树视觉呈现，但保存的是 `permissionCodes: string[]`；提交 PUT `/api/v1/menus/role/:roleId` |
| `system/menu/index.vue` | 改用 `api/v1/menus/tree`；CRUD 用 `/api/v1/menus` |
| `system/menu/modules/menu-dialog.vue` | `meta.permissions` 多选编辑（从 `/api/v1/permissions` 拉列表） |
| `system/audit-log/index.vue` | 现有路由，加 `v-auth="'audit:view'"` |

### 8.5 删除（详见 tasks T10）

- `system/department/`、`system/dict/` 全部删除
- `store/modules/permission.ts` 中 `getMenuByRole`、`isPlatformAdmin`、`isTeamAdmin`（若不再用）
- `api/system/api.ts`（无用，前端不再调 `/api/v1/*` 走这里）

---

## 9. Migration 顺序与防锁死（关键）

**核心风险**：`assertIsAdmin` → `assertPlatformAdmin` 切换后，**原本隐式拥有平台管理权限的团队 OWNER/ADMIN 都会失去 `/api/admin/*` 访问**。若无人持有 `platform:access` 权限码 → 全员 403 锁死。

### 9.1 严格顺序

1. **M1**：加 6 个新模型 + Permission seed + SysRole seed + RolePermission 绑定 + SysMenu seed
2. **M2**：防锁死——env `INITIAL_PLATFORM_ADMIN_USERNAME`（默认 `admin`）对应 User 自动绑 `platform_admin`；若该用户不存在则跳过，等首次登录时绑定
3. **M3**：helper 实现 + 单测
4. **M4**：`/api/v1/*` 全套路由 + 集成测试
5. **M5**：`/api/v1/auth/me` 响应扩展 + 前端 store
6. **M6**：**统一切换鉴权** + 集成测试回归
7. **M7**：前端动态菜单 + `v-auth` + system 模块接通
8. **M8**：删除死代码
9. **M9**：全量回归

### 9.2 平滑过渡（在 M5 后的 helper 做）

登录时若 `User.userRoles` 为空且 `TeamMember.role == 'OWNER'`，自动绑 `team_owner` 全局角色。**避免历史团队 owner 立刻 403**。

---

## 10. 测试策略

### 10.1 后端单元（覆盖率 ≥ 80%）

| 范围 | 关键断言 |
|------|---------|
| `assertPermission(userId, code)` | 真阳性 / 假阳性 / 跨角色并集去重 / 用户不存在 |
| `assertPlatformAdmin(req)` | 有 `platform:access` → 通过 / 无 → null / 无 header → null |
| `getUserPermissions(userId)` | 多角色并集 / 重复权限码去重 / 空用户返空数组 |
| `_filter_tree` | 空 permissions 公共放行 / 有 permissions 交集判断 / 目录级联隐藏 / 叶子单权限被剥父隐藏 |
| `seed_*.ts` | 幂等：第二次运行 `created_count=0`、无报错 |

### 10.2 后端集成（RBAC 流端到端）

- 建用户 → 绑 `member` → 登录 → `/me.permissions` ⊇ member 权限码 / ⊉ platform:access / ⊉ user:delete
- 同用户改绑 `platform_admin` → `/me.permissions` 增加平台权限码
- `platform_admin` 调 `/api/admin/users` 200
- `team_owner`（无 platform:access）调 `/api/admin/users` 403（修复缺口）
- `member` 调 `/api/v1/roles`（需 role:view）403
- `team_owner` 调 `/api/v1/menus/user-menu` 只看到工作区 + 团队管理
- `platform_admin` 调 `/api/v1/menus/user-menu` 看到全部
- `platform_admin` 创建角色 → 勾权限码 → 保存 → 用户绑该角色 → `/me.permissions` 含新码
- 删除 SysMenu → 该菜单从所有 user-menu 中消失
- `x-user-role: OWNER` header 篡改无效（沿用现有 assertIsAdmin 安全注释）

### 10.3 前端单元

- `hasPermission` / `hasAnyPermission`（覆盖 code 不存在、permissions 未加载态）
- `v-auth` 指令 mount/update/unbind 生命周期
- `buildRoutesFromMenu`：父目录无 component 不入路由；叶子有 component 入路由；空 children 保留叶子

### 10.4 前端 E2E（Playwright）

- 三角色登录侧边栏截图比对（对照 `docs/ui-design/index.html`）
- platform_admin 进 `/system/user` 可见操作按钮；member 进 → 按钮被 `v-auth` 移除 / 路由 403
- 切换 platform_admin → member 后（改绑角色再登录）→ 侧边栏回到精简状态

### 10.5 迁移回归

- 现有 admin/teams / admin/users / admin/mcp / admin/models / admin/audit 集成测试**全部继续通过**（handler 复用，鉴权替换）
- TeamMember 行为不变，团队级数据范围继续由 `assertMemberOfTeam` 控制
- **预期行为变化**：团队 OWNER 调 `/api/admin/*` 由 200 变 403——release notes 必须明示

---

## 11. 与 M3 的衔接

- 本 change **不动** M3 的数字员工/技能/MCP/编排代码。
- M3 涉及导航/菜单边界保持 `getMenuByRole` 占位（已存在），M4 T8 接管完整动态菜单方案。
- M3 的 `auth/me` 响应暂不加 `permissions` 字段，M4 一起加（避免两次改前端类型）。
- M3 已有的 30+ `/api/admin/*` 集成测试在 M4 T6 切换鉴权后必须继续通过——作为回归保障。

---

## 12. 风险与缓解（摘要）

| 风险 | 等级 | 缓解 |
|------|------|------|
| 平台管理员鉴权切换锁死 | **高** | 防锁死 migration + 登录自动绑 `team_owner`；verify e2e |
| 三角色种子与 UI 不匹配（侧边栏空白） | 中 | T2+T3 seed 后人工核对；E2E 三角色截图 |
| 动态菜单路由与静态路由冲突 | 中 | 守卫先 removeRoute 再 addRoute；旧 `getMenuByRole` 保留到 T10 |
| `v-auth` 异步加载 permissions 时序竞争 | 中 | sessionStorage 持久化 + 首屏读缓存校正 |
| Reference 栈差异（SQLAlchemy vs Prisma） | 中 | 模式直接借鉴，实现细节按本项目栈重写 |
| M3 与 M4 并行回归风险 | 中 | M3 导航边界加 adapter；M4 T8 切换前先 E2E 回归 |
| 删除 `department/`/`dict/` 后模板升级遗漏 | 低 | 模板升级 review 检查清单加一行 |

---

## 13. 验证清单（verify 阶段）

- [ ] 三角色登录 E2E 截图与 UI 设计 `index.html` 一致
- [ ] `/me.permissions` 与 SysRole→RolePermission→Permission join 链路一致
- [ ] 30+ `/api/admin/*` 集成测试全部通过（原断言保持 + 新增 `platform:access` 校验）
- [ ] `v-auth` 覆盖 system 模块所有按钮
- [ ] 迁移回归：历史 admin 用户登录后能进 `/platform/*`
- [ ] 审计：`role.update`、`user.assign-role`、`menu.delete` 等敏感操作写 `AuditLog`（沿用现有 `lib/audit-log.ts`）
- [ ] 性能：`/menus/user-menu` < 50ms（简单 join + 递归过滤）
- [ ] 安全：`x-user-role` header 篡改无效；无 token 401；token 过期 401（沿用现有机制）
- [ ] 删除到位：grep 全仓无 `getMenuByRole`、`department/`、`dict/`、`api/system/api.ts` 引用

---

## 14. 参考

- OpenSpec 设计：`openspec/changes/m4-rbac-platform/design.md`
- 完整设计：`docs/plans/2026-07-17-rbac-platform-design.md`（690 行，13 章节）
- 参考实现：`/Users/xiejava/AIproject/TF-TrailVerDev`
- UI 设计：`docs/ui-design/index.html`
- 既有 RBAC：`apps/web/lib/team-auth.ts`、`apps/web/lib/server-user.ts`
- M3 提案：`openspec/changes/m3-vue3-workbench/proposal.md`