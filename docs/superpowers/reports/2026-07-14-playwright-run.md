# Playwright 测试执行报告 — Task 6.3 (M2.3)

> Language: zh-CN
> Branch: `feature/20260713/pi-web-m2-3-admin-user-management`
> Date: 2026-07-14
> Task: M2.3 OpenSpec Task 6.3 — 完整 Playwright E2E 套件执行

## 执行命令

```bash
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="是" pnpm exec playwright test
```

## 结果概览

| 维度 | 数量 |
|---|---|
| 总测试数 | 7 |
| 通过 | 5 |
| 失败 | 1 |
| 跳过 | 1 |
| 总耗时 | ~17.1s |

**结论**: 1 项失败 + 1 项跳过（设计上跳过）+ 5 项通过

## 测试列表与状态

| # | 测试名 | 状态 | 耗时 | 引入版本 |
|---|---|---|---|---|
| 1 | `API smoke: bootstrap → user-login → change-password → JWT access` | ✓ PASS | 1.1s | M1-4.3 |
| 2 | `mustChangePassword blocks POST /api/agent/new until password changed` | ✓ PASS | 2.3s | M2.2-5.2 |
| 3 | `sessions 3-way filter: root sees its own session` | ✘ FAIL | 413ms | M2.2-5.2 |
| 4 | `50 session cap: returns 503 + Retry-After when over cap` | - SKIP | n/a | M2.2-5.2（设计性跳过） |
| 5 | `change-password contract: fresh login → change-password → new password works` | ✓ PASS | 807ms | M2.2-5.2 |
| 6 | `admin creates user → new user login → force change password flow` | ✓ PASS | 1.0s | M2.3-3.6 |
| 7 | `per-user session cap: 6th POST /api/agent/new returns 503 + Retry-After` | ✓ PASS | 442ms | M2.3-4.5 |

## 失败详情

### Test 3: `sessions 3-way filter: root sees its own session`

**状态**: 失败

**错误信息**:
```
Error: expect(received).toContain(expected) // indexOf

Expected value: "019f5c3c-f21c-784e-baea-9907de2508bc"
Received array: []

  163 |       (s: { id: string }) => s.id
  164 |     );
> 165 |     expect(ids).toContain(createdSessionId);
      |                 ^
  166 |   }
```

**分类**: PRE-EXISTING（预先存在，非 M2.3 引入）

**证据**:

1. **测试代码在 M2.3 期间未被修改**：
   - M2.3 Task 3.6（commit `4a99825`）仅在文件末尾追加新测试，未触及 line 120-167 的 test 3
   - M2.3 Task 4.5（commit `f52d900`）仅在文件末尾追加新测试
   - M2.3 Task 5.1（commit `74ba9f2`）仅修改 `lib/client-fetch.ts`，未触及 `tests/e2e/login.spec.ts`

2. **生产代码无相关变更**：
   - `git diff 3c2221c..HEAD -- app/api/sessions/route.ts lib/session-meta.ts` 输出为空
   - 即 M2.2-verify 之后 HEAD 与 M2.2-verify 之间的 `/api/sessions/route.ts` 和 `lib/session-meta.ts` 无任何变更

3. **根本原因为 M2.2 已存在的设计缺陷**：
   - `lib/session-meta.ts::recordSessionMeta` 自 M1 起即为 stub，从未被 `startRpcSession` 调用
   - 测试通过 `POST /api/agent/new` 发送 `type: "ensure_session"`，仅创建 runtime 不发送 prompt，因此不会写入 `.jsonl` 文件
   - `rebuildFromJsonl` 仅扫描磁盘上已有的 `.jsonl` 文件，无法捕获新建的 session
   - `getSessionMeta(realSessionId)` 返回 `undefined`，`/api/sessions` 路由因 `if (!meta) continue;` 而过滤掉该 session
   - M2.2 verify 报告声称 S3 PASSED，但这是因为 disk 上碰巧残留有来自早期测试运行的 `.jsonl` 文件，本次 `db:reset` 后已清空，导致测试必定失败

4. **M2.2 verify 报告原文**（`docs/superpowers/reports/2026-07-13-pi-web-m2-2-ui-and-hardening-verify.md`）：
   > `pnpm exec playwright test tests/e2e/login.spec.ts` | 4 通过，1 跳过（50-cap，附 M2.3 TODO）
   > S3（会话 3 路并集过滤） | PASS | E2E 测试 3（root 看到自己的会话）；team-admin + shared 分支在代码审查中

   M2.2 verify 时测试通过属于偶然结果（残留 `.jsonl` 文件使 `rebuildFromJsonl` 能匹配），并非修复了根本缺陷。

## 跳过的测试

### Test 4: `50 session cap: returns 503 + Retry-After when over cap`

**状态**: SKIP（`test.skip`）

**原因**: 设计性跳过，注释中说明：
> The cap state lives in globalThis.__piSessionCounter on the dev server process
> (separate from the Playwright test process). Without a test-only endpoint to
> manipulate it, Playwright cannot drive the counter to 50 from outside the process.

M2.3 Task 4.5 已经新增 `Test 7`（per-user 5-slot cap E2E）替代此跳过用例，并实际通过测试（442ms）。

## 完整原始输出

```
Running 7 tests using 1 worker

[WebServer] ⚠ Warning: Next.js inferred your workspace root, but it may not be correct.
[WebServer]  We detected multiple lockfiles and selected the directory of /Users/xiejava/pnpm-lock.yaml as the root directory.
[WebServer]  To silence this warning, set `turbopack.root` in your Next.js config, or consider removing one of the lockfiles if it's not needed.
[WebServer]  Detected additional lockfiles: 
[WebServer]    * /Users/xiejava/AIproject/AI-agent-workshop/.worktrees/feature/20260713/pi-web-m2-3-admin-user-management/pnpm-lock.yaml
[WebServer]    * /Users/xiejava/AIproject/AI-agent-workshop/pnpm-lock.yaml
[WebServer] 
[WebServer] ⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.

> @agegr/pi-web@0.7.11 db:reset /Users/.../pi-web-m2-3-admin-user-management
> prisma migrate reset --force

Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "dev.db" at "file:./data/dev.db"

Applying migration `20260713003857_init`
Applying migration `20260713112116_add_refresh_token_blacklist`
Applying migration `20260713114005_add_user_created_by_and_updated_at`

Database reset successful

Running generate... (Use --skip-generate to skip the generators)
Running generate... - Prisma Client
✔ Generated Prisma Client (v6.19.3) to ./node_modules/.pnpm/@prisma+client@6.19
.3_prisma@6.19.3_typescript@5.9.3__typescript@5.9.3/node_modules/@prisma/client 
in 106ms


  ✓  1 tests/e2e/login.spec.ts:14:5 › API smoke: bootstrap → user-login → change-password → JWT access (1.1s)
[BOOTSTRAP] root username=root password=<redacted>
  ✓  2 tests/e2e/login.spec.ts:76:5 › mustChangePassword blocks POST /api/agent/new until password changed (2.3s)
  ✘  3 tests/e2e/login.spec.ts:120:5 › sessions 3-way filter: root sees its own session (413ms)
  -  4 tests/e2e/login.spec.ts:177:6 › 50 session cap: returns 503 + Retry-After when over cap

> @agegr/pi-web@0.7.11 db:reset /Users/.../pi-web-m2-3-admin-user-management
> prisma migrate reset --force

Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "dev.db" at "file:./data/dev.db"

Applying migration `20260713003857_init`
Applying migration `20260713112116_add_refresh_token_blacklist`
Applying migration `20260713114005_add_user_created_by_and_updated_at`

Database reset successful

Running generate... - Prisma Client
✔ Generated Prisma Client (v6.19.3) to ./node_modules/.pnpm/@prisma+client@6.19
.3_prisma@6.19.3_typescript@5.9.3__typescript@5.9.3/node_modules/@prisma/client 
in 92ms


  ✓  5 tests/e2e/login.spec.ts:193:5 › change-password contract: fresh login → change-password → new password works (807ms)
  ✓  6 tests/e2e/login.spec.ts:244:5 › admin creates user → new user login → force change password flow (1.0s)
  ✓  7 tests/e2e/login.spec.ts:347:5 › per-user session cap: 6th POST /api/agent/new returns 503 + Retry-After (442ms)


  1) tests/e2e/login.spec.ts:120:5 › sessions 3-way filter: root sees its own session ──────────────

    Error: expect(received).toContain(expected) // indexOf

    Expected value: "019f5c36-8895-74fb-a352-6697303819dc"
    Received array: []

      163 |       (s: { id: string }) => s.id
      164 |     );
  > 165 |     expect(ids).toContain(createdSessionId);
        |                 ^
      166 |   }
      167 | });

    Error Context: test-results/login-sessions-3-way-filter-root-sees-its-own-session/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/login-sessions-3-way-filter-root-sees-its-own-session/trace.zip

  1 failed
    tests/e2e/login.spec.ts:120:5 › sessions 3-way filter: root sees its own session ───────────────
  1 skipped
  5 passed (17.1s)
```

## 分类汇总

| 类别 | 数量 | 测试 |
|---|---|---|
| PASS | 5 | Tests 1, 2, 5, 6, 7 |
| PRE-EXISTING FAIL | 1 | Test 3 (M2.2 引入的 session-meta stub 未接线问题) |
| DESIGN-SKIP | 1 | Test 4 (50 session cap, M2.2 已用 test 7 替代) |
| NEW FAIL（M2.3 引入） | 0 | — |

## M2.3 增量工作验证

| 任务 | 验证测试 | 状态 |
|---|---|---|
| Task 3.6 (admin create user) | Test 6 | ✓ PASS |
| Task 4.5 (per-user session cap) | Test 7 | ✓ PASS |
| Task 5.1 (401-refresh wrapper) | lib/client-fetch.test.ts (vitest unit) | 不在 Playwright 范围 |

M2.3 自身引入的所有能力均通过 E2E 验证。

## 建议（不在本任务范围）

PRE-EXISTING 失败的修复需要在 M2.3+ 中进行：
1. 在 `lib/rpc-manager.ts::startRpcSession` 中创建 session 后调用 `recordSessionMeta(realSessionId, userId, projectId)`
2. 或修改 `/api/sessions` 路由，对 `meta === undefined` 的 session 通过 `cacheSessionPath` 查询补充 userId 信息
3. 或在 `POST /api/agent/new` 中 `recordSessionMeta` 调用

当前 Task 6.3 范围仅要求"记录测试执行证据"，不在此任务中修复源码。

## 结论

**状态**: DONE_WITH_CONCERNS

Task 6.3 完成 — Playwright 套件已执行并记录证据。M2.3 自身工作（Tasks 3.6, 4.5）100% 通过 E2E。1 项 PRE-EXISTING 失败已在 M2.2 引入，建议在后续 sprint 中修复但不阻塞 M2.3 验收。