# PR: feat(m4): RBAC 平台中台 — 用户/角色/权限码/菜单管理 + 收尾清理

**创建链接**：https://github.com/xiejava1018/AI-agent-workshop/pull/new/feature/20260717/m4-rbac-platform
**Base**: `main` ← **Head**: `feature/20260717/m4-rbac-platform`

---

## Title

```
feat(m4): RBAC 平台中台 — 用户/角色/权限码/菜单管理 + 收尾清理
```

## Summary

M4 RBAC 平台中台落地：全局 RBAC（用户/角色/权限码/菜单），把 `/api/admin/*` 鉴权从「任意团队 OWNER/ADMIN」收敛到 `platform:access` 权限码，修复平台管理员隔离缺口；前端动态菜单 + `v-auth` 按钮级权限。

**架构**：正交双层 RBAC —— 全局 `SysRole`（platform_admin / team_owner / member）管导航与平台动作；`TeamMember.role` 管数据范围。菜单可见性 = `set(SysMenu.meta.permissions) ∩ set(user.permissions)`。

**后端（前序 commit 已落地）**：
- 6 张新表（SysRole/UserRole/Permission/RolePermission/SysMenu/MenuAuth）+ migration
- 60+ 权限码 seed + 3 预置角色 + 4 父 13 子菜单 seed
- `lib/permissions.ts`（assertPlatformAdmin / assertPermission / getUserPermissions + 防锁死 ensureTeamOwnerRoleForExistingOwners）
- `/api/v1/*` 14+ RBAC CRUD 路由 + `/api/v1/auth/me` 下发 permissions/roles
- `/api/admin/*` 鉴权机械化替换 assertIsAdmin → assertPlatformAdmin（handler 不动）

**本次 build 收尾（15 commits）**：
- T10 死代码清理：删 `store/modules/permission.ts`（getMenuByRole 等硬编码）、dict 管理页、department 模块（含 user 页面部门字段解耦 + 类型 + 独立 api）。保留活跃的 `api/system/api.ts` 与 `useDictStore`
- T8 前端单测补齐：v-auth 指令（6 测，100% 覆盖）+ RoutePermissionValidator（22 测，94% 覆盖）+ userStore 权限 helper 抽取到 `utils/permissions.ts`
- design doc §15 Implementation Divergence 记录 spec 偏离

## ⚠️ 破坏性变化

1. **团队 OWNER 调 `/api/admin/*` 由 200 → 403**：现要求 `platform:access`。历史 OWNER 登录自动绑 `team_owner`。需平台管理权限请绑 `platform_admin` 角色。
2. 前端移除 department/dict 管理页 + user 表单「部门」字段。

## Test Plan

- [x] 后端 `/api/v1/*` 集成测试 47/47
- [x] 前端 dashboard 测试 39/39
- [x] web build + dashboard build 双绿
- [x] code review（无 Critical）
- [ ] 三角色 E2E（已知缺口，backlog B7）
- [ ] RBAC 路由审计（已知缺口 R11，backlog B8）

## 已知缺口（verify 已确认接受）

- B7：m4 三角色 Playwright E2E spec
- B8：RBAC 路由审计落地
- B6：must-change-password 门禁（25 个预存在失败，另开 change）

详见 `docs/superpowers/reports/2026-07-17-m4-rbac-platform-verify.md`。

> 注：本分支从 `feature/20260716/m3-vue3-workbench` 切出，含 M3 提交。如需 M3 独立验收可先处理 M3 分支。
