---
change: m4-rbac-platform
design-doc: docs/superpowers/specs/2026-07-17-m4-rbac-platform-design.md
base-ref: 3173614e0d309959ebe1ed1e14e9b9a552fbfbaa
---

# M4 RBAC 平台中台 — 清理 + 测试收尾计划（重写版）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** M4 RBAC 后端 + 核心前端已在前序 commit 落地（见下方快照）。本计划只聚焦**真正剩余**的收尾：删除纯死代码、解耦并清理 department/dict、补齐前端 v-auth 与动态路由的单元测试、全量验证。

**为何重写：** 初版计划基于"tasks.md 全未勾"假设，但 git 历史与代码核对证实后端 T1-T7 + 前端核心已全部完成。原计划大量 task 会重复劳动。本版按**已验证的实际状态**重写。

**Tech Stack:** Vue3 + Pinia + Element Plus（Art Design Pro 模板，用 `RouteRegistry` 而非 `buildRoutesFromMenu`、`directives/core/auth.ts` 而非 `business/auth.ts`）、Vitest（happy-dom）。

**参考文档:** `docs/superpowers/specs/2026-07-17-m4-rbac-platform-design.md`

---

## 已完成快照（本计划不再重做 — 仅记录，供 tasks.md 勾选）

| Task | 证据 commit |
|------|------------|
| T1 数据模型 6 表 + migration | `10d541d` |
| T2/T3 Permission/SysRole/SysMenu 种子 | `f61852f` |
| T4 鉴权 helper + 单测 | `1cdfd74` |
| T5 `/api/v1/*` 路由 + 47 集成测试 | `b2a957e` / `d2028f6` |
| T5.11 disabled user session blocking | `a94c372` |
| T6 store permissions/roles + fetchAndSetUserInfo | `4dcc754` |
| T7 `/api/admin/*` 鉴权切换 + OWNER→team_owner 平滑过渡 | `e9119c5` / `995254c` / `3173614` |
| T8 `v-auth` 指令 | `directives/core/auth.ts`（基于 `route.meta.authList`） |
| T8 动态路由 | `router/guards/beforeEach.ts` 用 `RouteRegistry.register()` |
| T9 system 页面接通 | 经 `api/system/api.ts` 调真实 `/api/v1/*` |

**设计文档勘误纠正：** design §8.5 要求删除 `api/system/api.ts`，但该文件是 system 页面（user/role/menu）访问 `/api/v1/*` 的活跃 API 层，**不能删**。本计划保留它。

---

## 阶段 0：基线门禁（必跑）

### Task B0: 基线构建 + 测试

锁定收尾前的可重现状态。

- [x] B0.1 `pnpm install` 通过
- [x] B0.2 `pnpm --filter @ai-agent-workshop/web build` 通过
- [x] B0.3 `pnpm --filter @ai-agent-workshop/dashboard build` 通过
- [x] B0.4 `pnpm --filter @ai-agent-workshop/web test`（后端 47+ 测试）全过
- [x] B0.5 `pnpm --filter @ai-agent-workshop/dashboard test`（现有 user.test.ts）全过

**验证命令：**
```bash
pnpm --filter @ai-agent-workshop/web test 2>&1 | tail -5
pnpm --filter @ai-agent-workshop/dashboard test 2>&1 | tail -5
```

**Commit:** `test(m4): baseline green before cleanup`

---

## 阶段 1：纯死代码删除（低风险，先做）

### Task T10-A: 删除 permission.ts 死函数

`getMenuByRole` / `isPlatformAdmin` / `isTeamAdmin` 在 `apps/dashboard/src/store/modules/permission.ts`，**已确认零外部引用**（grep 全 src 仅命中定义文件本身）。

- [x] T10-A.1 `grep -rn "getMenuByRole\|isPlatformAdmin\|isTeamAdmin" apps/dashboard/src/` 再次确认无外部调用
- [x] T10-A.2 删除三个函数；若文件其余内容（`Role` 类型、`MenuItem` 接口）也无引用则整文件删除，否则保留类型定义
- [x] T10-A.3 `pnpm --filter @ai-agent-workshop/dashboard build` 通过（验证无断链）
- [x] T10-A.4 `pnpm --filter @ai-agent-workshop/dashboard test` 通过

**Commit:** `refactor(m4): T10 remove dead getMenuByRole/isPlatformAdmin/isTeamAdmin`

### Task T10-B: 删除 dict 死代码

dict 已注册路由（`asyncRoutes.ts:91`、`routesAlias.ts:20`、`store/modules/dict.ts`），但属 SoybeanAdmin 模板遗留，UI 设计未列。

- [x] T10-B.1 删除 `apps/dashboard/src/views/system/dict/`
- [x] T10-B.2 ~~删除 `apps/dashboard/src/store/modules/dict.ts`~~ — **保留**:useDictStore 被 App.vue + 3 个 asset 视图使用,非死代码(仅删 dict 管理页)
- [x] T10-B.3 移除 `router/routes/asyncRoutes.ts` 中 Dict 路由节点（含其子项）
- [x] T10-B.4 移除 `router/routesAlias.ts` 的 `Dict` 枚举
- [x] T10-B.5 `grep -rn "dict\|Dict" apps/dashboard/src/` 确认无残留引用（排除业务无关命中）
- [x] T10-B.6 build + test 通过

**Commit:** `refactor(m4): T10 remove dead dict module (template leftover)`

---

## 阶段 2：department 解耦清理（中风险，需重构 user 页面）

### Task T10-C: 从 user 页面移除部门字段

`apps/dashboard/src/views/system/user/index.vue` 把 `department_id` 作为**必填**表单字段（line 516 校验）、表格列、loader。design §3 明确部门管理 Out of Scope（与 TeamMember 重叠）。

**注意：** 这一步改变用户表单 UX（移除"部门"下拉）。若产品实际需要部门，**暂停在此处问用户**是否真要删。

- [x] T10-C.1 移除模板：`<ElFormItem label="部门">` 整块（line 91-100）
- [x] T10-C.2 移除 `formData.department_id`、`departmentList` ref、`loadDepartmentList`
- [x] T10-C.3 移除 `getDepartmentList` import（line 149）与 `Promise.all` 中的 `loadDepartmentList()`（line 593）
- [x] T10-C.4 移除表格列 `department_name`（line 351）与列配置 `department_id`（line 319）
- [x] T10-C.5 移除 `user-dialog.vue`（若存在）中 department 相关
- [x] T10-C.6 build 通过；手动核对 user 页面表单无"部门"项

**Commit:** `refactor(m4): T10-C remove department field from user page`

### Task T10-D: 删除 department 模块

user 页面解耦后，department 成为纯死代码。

- [x] T10-D.1 删除 `apps/dashboard/src/views/system/department/`
- [x] T10-D.2 ~~移除 Department 路由节点~~ — **N/A**:asyncRoutes 中本就无 Department 路由节点(仅 routesAlias 有别名,已删)
- [x] T10-D.3 移除 `router/routesAlias.ts` 的 `Department` 枚举
- [x] T10-D.4 移除 `api/system/api.ts` 中 department 相关函数（`getDepartmentList` 等，约 line 124-139）
- [x] T10-D.5 `grep -rn "department\|Department" apps/dashboard/src/` 确认无残留
- [x] T10-D.6 build + test 通过

**Commit:** `refactor(m4): T10-D remove dead department module`

**⚠️ 验证点：** 删除后 `api/system/api.ts` **保留**（user/role/menu 页面仍用它访问 `/api/v1/*`）。

---

## 阶段 3：前端测试补齐（TDD — 先写失败测试）

### Task T8-TEST: `v-auth` 指令单元测试

`directives/core/auth.ts` 基于 `route.meta.authList` 控制 DOM。当前无测试。

- [x] T8-TEST.1 写失败测试 `apps/dashboard/src/directives/core/__tests__/auth.test.ts`：
  - 有匹配 authMark → 元素保留
  - 无匹配 authMark → 元素从 DOM 移除
  - authList 为空 → 元素移除
  - mounted + updated 生命周期
- [x] T8-TEST.2 跑测试确认 RED
- [x] T8-TEST.3 若实现已正确 → GREEN（预期直接过，测试是固化契约）；若有 bug → 修实现
- [x] T8-TEST.4 覆盖率：该文件 ≥ 80%

**Commit:** `test(m4): T8 v-auth directive unit tests`

### Task T8-ROUTE: 动态路由注册单元测试

`router/guards/beforeEach.ts` 的 `RouteRegistry.register()` / `MenuProcessor` 是动态菜单注入核心，无测试。因依赖较重，测可纯化的边界：

- [x] T8-ROUTE.1 评估可测性：若 `RouteRegistry` 可独立实例化 → 写 `router/core/__tests__/routeRegistry.test.ts`（addRoute/removeRoute/去重）；若耦合 router 单例过深 → 改测 `RoutePermissionValidator.validatePath`（纯函数，可测）
- [x] T8-ROUTE.2 写失败测试 → RED → 实现/修正 → GREEN
- [x] T8-ROUTE.3 覆盖率达标

**Commit:** `test(m4): T8 dynamic route permission validator tests`

---

## 阶段 4：全量验证（verify 阶段预备）

### Task V-FINAL: 验证清单

- [x] V1 `grep -rn "getMenuByRole\|isPlatformAdmin\|isTeamAdmin" apps/dashboard/src/` → 空
- [x] V2 `grep -rn "department\|Department" apps/dashboard/src/` → 空
- [x] V3 `grep -rn "system/dict\|'Dict'" apps/dashboard/src/` → 空
- [x] V4 后端 `/api/v1/*` 47+ 集成测试全过
- [x] V5 前端 vitest 全过（user + auth 指令 + 路由）
- [x] V6 dashboard build 通过
- [x] V7 web build 通过
- [x] V8 `api/system/api.ts` 仍存在且被 user/role/menu 页面使用（非死代码）
- [x] V9 三角色 RBAC 流（platform_admin / team_owner / member）后端集成测试覆盖（已在 T5.13）
- [x] V10 `/api/admin/*` 鉴权：team OWNER 无 `platform:access` → 403（已在 T7 测试）
- [x] V11 删除项 release notes 记录（department/dict/getMenuByRole 移除，属破坏性前端变更）

**注：** T9.9 三角色 E2E 截图比对若 Playwright 环境未就绪，在 verify 阶段评估是否纳入或记为已知限制。

---

## 依赖关系

```
B0 (baseline)
 ├─► T10-A (permission dead fns)        ─┐
 ├─► T10-B (dict)                       ├─ 可并行
 │                                       ┘
 ├─► T10-C (user 页面去 department) ──► T10-D (删 department)   ─ 串行
 └─► T8-TEST (v-auth) , T8-ROUTE (路由)                          ─ 可并行
                                          │
                                          ▼
                                      V-FINAL
```

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 删 department 后 user 表单缺必填字段导致提交失败 | **中** | T10-C 逐步移除 + build 校验；手动核对表单 |
| dict 路由删除遗漏导致 404 | 低 | T10-B.5 grep 全仓确认 |
| `v-auth` 测试因 router 单例 mock 困难 | 中 | 测 `RoutePermissionValidator` 纯函数替代 |
| department 实际是产品需要 | 中 | T10-C 前暂停问用户确认 |

## 执行交接

剩余真实工作量：~6 个 task（2 纯删 + 2 解耦删 + 2 测试）+ 验证。建议 `executing-plans` 主窗口执行（任务少、有串行依赖）。
