# 验证报告：M4 RBAC 平台中台（m4-rbac-platform）

> 日期：2026-07-17
> 分支：feature/20260717/m4-rbac-platform
> verify_mode：full（50 任务 / 22 变更文件 / 1 capability）
> 验证依据：openspec/changes/m4-rbac-platform/specs/rbac-platform/spec.md（11 需求、~25 场景）

---

## Summary

| 维度 | 状态 |
|------|------|
| Completeness | tasks.md 0 未勾（done `[x]` + deferred/backlog 为说明性文字）；11 需求全部有实现 |
| Correctness | 核心 RBAC 流后端 47 集成测试 + dashboard 39 单测全过；**2 个场景缺口**（审计、E2E） |
| Coherence | **2 处 delta spec ↔ 实现偏离**（api/system/api.ts 保留、模板命名差异） |

**最终评估**：无 CRITICAL。4 个 WARNING + 2 个 SUGGESTION。核心 RBAC 能力（6 表 + 种子 + 鉴权修复 + 菜单过滤 + /me + CRUD + 前端动态菜单 + v-auth + 防锁死）已实现且测试覆盖。

**用户决策（2026-07-17）**：
- **W3/W4 spec 偏离** → 选项 A：design doc §15「Implementation Divergence」已记录（api/system/api.ts 保留 + 模板命名 + 整文件删除 permission.ts）。
- **W1 审计 + W2 E2E** → 接受为已知缺口，记入 tasks.md backlog（B7 E2E / B8 审计），M4 以现有测试过 verify。
- 结论：**Ready for archive**（含已记录的改进项）。

---

## 需求逐项核对（11 Requirement）

| # | Requirement | 实现 | 测试 |
|---|-------------|------|------|
| R1 | 六张新表 + 种子 | ✅ schema 6 表(commit 10d541d)+ seed(commit f61852d)；**无 RoleMenu 表**(grep 0 命中) | seed 幂等单测 **缺**(T2.4 deferred) |
| R2 | 平台管理员独立身份 + /api/admin/* 鉴权修复 | ✅ assertPlatformAdmin(platform:access) | ✅ admin/users 403 断言（MEMBER/OWNER 伪造/无 platform:access） |
| R3 | 用户菜单按权限过滤 | ✅ user-menu route + filterTree | ⚠️ 仅 route.test.ts 集成；三角色侧边栏 **E2E 缺** |
| R4 | /api/v1/auth/me 下发 permissions/roles | ✅ | ✅ v1 47 测覆盖（多角色并集去重、member 无 platform:access） |
| R5 | /api/v1/* RBAC CRUD 14+ 路由 | ✅ | ✅ v1 47 测（创建角色+绑权限、无权限 403） |
| R6 | 前端动态菜单 + v-auth | ✅ menu store / RouteRegistry / guards / v-auth(core/auth.ts) / userStore | ✅ v-auth 6 测 + RoutePermissionValidator 22 测；**spec 偏离见下** |
| R7 | 防锁死 + 平滑过渡 | ✅ INITIAL_PLATFORM_ADMIN_USERNAME + ensureTeamOwnerRoleForExistingOwners | ✅ permissions.test.ts 覆盖 |
| R8 | /api/admin/* 鉴权机械化替换 | ✅ assertIsAdmin→assertPlatformAdmin，handler 不动，assertIsAdmin 保留 | ✅ 13 admin 测试继续通过 |
| R9 | system 模块接通 /api/v1/* | ✅ user/role/menu/audit 经 api/system/api.ts；department/dict 已删 | ⚠️ 页面级 **E2E 缺** |
| R10 | 菜单 seed 对齐 UI 13 屏 | ✅ 4 父 + 13 子 | ⚠️ 三角色 **E2E 截图缺** |
| R11 | 审计与安全基线 | ⚠️ audit-log.ts 保留，**但 RBAC 路由未调用 auditLog()** | ❌ role.create 等不写审计 |
| R12 | 测试覆盖与回归 | ✅ permissions.ts 单测 + v1 47 集成 + 前端单测 | ⚠️ filterTree 无独立单测；E2E 缺 |

---

## CRITICAL（无）

无。核心能力实现 + 后端/前端测试全绿，无构建/测试失败、无主动安全漏洞。

---

## WARNING（4 项，需决策）

### W1. R11 审计未在 RBAC 路由落地

- **现状**：`auditLog()` 函数存在（lib/audit-log.ts:89），但仅在 `api/agent/*`、`api/sessions/*` 调用。`/api/v1/roles`、`/api/v1/users`、`/api/v1/menus`、`/api/admin/*` **均未调用** auditLog()。
- **影响场景**：R11「角色创建写审计日志」未满足（POST /api/v1/roles 不写 AuditLog）。
- **定级**：WARNING（安全/合规观测性缺口，非主动漏洞；系统功能不受影响）。
- **建议**：在 v1 路由的 create/update/delete 处补 `void auditLog({...})`（沿用 agent 路由的 fire-and-forget 模式）。

### W2. E2E 三角色场景未自动化（R3/R10/R12 scenarios）

- **现状**：仅有 m3-workbench.spec.ts + login.spec.ts，无 m4 三角色 E2E。
- **影响场景**：member/team_owner/platform_admin 侧边栏渲染、v-auth 按钮真实移除、角色切换侧边栏更新、UI 设计 13 屏对照——均无自动化覆盖。
- **定级**：WARNING（后端集成测试已覆盖 RBAC 逻辑，但前端端到端无自动验证）。
- **建议**：新增 `apps/web/tests/e2e/m4-rbac.spec.ts`（三角色登录 + 侧边栏截图）。

### W3. delta spec 偏离：api/system/api.ts（spec 说删，实现保留）

- **现状**：spec R6(line 189)/R9 要求「删除 api/system/api.ts」。实现**保留**它——它是 system 页面(user/role/menu)访问 `/api/v1/*` 的活跃 API 层（被 6 个文件 import）。设计文档原假设它「无用」有误。
- **定级**：WARNING（delta spec ↔ 实现矛盾）。
- **决策点**（verify Step 2b）：A/B/C，见下。

### W4. delta spec 命名偏离：buildRoutesFromMenu / business/auth.ts

- **现状**：spec R6/R12 引用 `router/utils.ts buildRoutesFromMenu`、`directives/business/auth.ts`。实现用模板自带的 `RouteRegistry.register()`、`directives/core/auth.ts`（功能等价）。
- **定级**：WARNING（命名/路径偏离，功能等价）。
- **决策点**：随 W3 一起处理（A：文档记录偏差）。

---

## SUGGESTION（2 项，可选）

### S1. 两份并行 api.d.ts（types/api/api.d.ts + typings/api.d.ts）
手维护的重复类型文件，本次 department 清理需双改。建议未来合并或一个 re-export 另一个。

### S2. seed 幂等单测（T2.4）
未补；靠 upsert 语义保证幂等。需 DB 环境的单测留 backlog。

---

## 验证证据（fresh，2026-07-17）

| 检查 | 命令 | 结果 |
|------|------|------|
| 后端 v1 测试 | `pnpm --filter @ai-agent-workshop/web test app/api/v1` | 47/47 pass |
| 前端测试 | `npx vitest run`（dashboard） | 39/39 pass |
| web build | `pnpm --filter @ai-agent-workshop/web build` | exit 0 |
| dashboard build | `pnpm --filter @ai-agent-workshop/dashboard build` | exit 0 |
| RoleMenu 表 | `grep -c "model RoleMenu" schema.prisma` | 0 |
| 前端死代码 grep | getMenuByRole/department/dict-route | 全空 |
| code review | superpowers:code-reviewer（3173614..HEAD） | 无 Critical，Important #1 + Minor 已修 |

---

## 已知 out-of-scope（用户 2026-07-17 已确认接受）

- 25 个 `must-change-password.meta.test.ts` 预存在失败（0/17 admin 路由实现强制改密门禁，非 M4 引入）→ 另开 change。
- 1 个 prisma-models M3 测试 DB 环境失败。
