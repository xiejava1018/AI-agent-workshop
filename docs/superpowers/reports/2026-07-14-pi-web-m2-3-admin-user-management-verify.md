# Verification Report: pi-web-m2-3-admin-user-management

**Date**: 2026-07-14
**Change**: pi-web-m2-3-admin-user-management
**Schema**: spec-driven
**Phase**: verify
**Verify Mode**: full (31 tasks > 3, 6 capabilities > 1, 48 files > 8)

## Summary Scorecard

| Dimension | Status |
|-----------|--------|
| Completeness | 31/31 tasks complete; 6/6 delta specs implemented |
| Correctness | All spec scenarios addressed (mix of e2e + unit + API code) |
| Coherence | Implementation follows design.md and plan §2-§5 |

## Spec-to-Implementation Mapping

### admin-user-creation (1/1 requirement, 3/3 scenarios)
- ✅ "只有 OWNER 或 ADMIN 可以创建新用户" → `app/api/admin/users/route.ts:60-87` + `lib/server-user.ts:assertIsAdmin`
- ✅ Scenario "ADMIN 创建用户成功" → `tests/e2e/login.spec.ts:244` (Test 6)
- ✅ Scenario "MEMBER 创建用户被拒绝" → `app/api/admin/users/route.ts:64-66` (403)
- ✅ Scenario "重复用户名拒绝创建" → `app/api/admin/users/route.ts:78-81` (409)

### refresh-token (3/3 requirements, 5/5 scenarios)
- ✅ "登录时同时签发 access + refresh" → `app/api/auth/user-login/route.ts:208-219` (pw_at + pw_rt 双 cookie)
- ✅ "access token 过期后可用 refresh token 续期" → `app/api/auth/refresh/route.ts`
- ✅ "refresh token 撤销" → `app/api/auth/user-logout/route.ts:14-19`
- ⚠️ Scenarios "使用有效 refresh token 续期", "使用已撤销 refresh token 续期", "缺失 refresh token", "登出清除双 token" → API route implemented but no dedicated e2e tests (covered indirectly by unit test for token-blacklist and the e2e bootstrap test verifying double-cookie set)

### per-user-session-cap (2/2 requirements, 4/4 scenarios)
- ✅ "每个用户独立限制活跃 session 数量" → `lib/session-cap.ts:checkUserSessionCap`
- ✅ "全局 session 上限作为兜底" → `lib/session-cap.ts:checkUserSessionCap` (combined check)
- ✅ Scenario "配额内" + "达到 per-user 上限" → `tests/e2e/login.spec.ts:321` (Test 7)
- ✅ Scenario "跨用户隔离" + "全局上限触发" → `lib/session-cap.test.ts` (vitest)

### auth-provider-user (MODIFIED, 2/2 requirements, 4/4 scenarios)
- ✅ "AuthProvider 接口必须保留扩展位" → `lib/auth-provider.ts:1-87` (AuthProvider/PasswordAuthProvider/OAuthProvider)
- ✅ "全局 middleware 拦截未登录 user 的 /api/*" → `middleware.ts:1-30` (matcher + headers)
- ✅ "本地密码认证不再自动注册" → `lib/auth-provider-local.ts:11-12` (throws on unknown user)
- ✅ "已知用户登录成功" → `lib/auth-provider-local.test.ts`

### user-auth-ui (MODIFIED + ADDED, 3/3 requirements, 6/6 scenarios)
- ✅ "登录页面必须能在浏览器中渲染" → `app/[locale]/login/page.tsx:23-37` (login form)
- ✅ "access token 过期后静默续期" → `lib/client-fetch.ts` + `app/[locale]/login/page.tsx` (authFetch wrapper)
- ✅ "改密页面强制 root 首次登录后改密" → M2.2 preserved
- ✅ "admin 用户可在 dashboard 创建新用户" → `app/[locale]/dashboard/CreateUserForm.tsx` + `app/[locale]/dashboard/page.tsx`
- ✅ Scenario "MEMBER 看不到创建用户入口" → `app/[locale]/dashboard/page.tsx:687` (role-gated rendering)
- ✅ "access token 过期静默续期" → `lib/client-fetch.test.ts` (7 unit tests)

### agent-session-in-process (MODIFIED, 4/4 requirements, 3/3 scenarios)
- ✅ "复用 fork 的 per-session 串行调度" → `app/api/agent/new/route.ts:115` (incrementUserSessionCap after startRpcSession)
- ✅ "SSE 端点 read-path 强制 user 权限校验" → M2.2 preserved
- ✅ "SSE 端点 cwd 与 Project.root_path 一致" → `app/api/agent/new/route.ts:60-89` (lastProjectId → Project)
- ✅ "Server 启动时 metadata rebuild 失败降级" → M2.2 preserved

## Test Evidence

- **Unit tests** (vitest): `lib/session-cap.test.ts`, `lib/auth-provider-local.test.ts`, `lib/auth-provider.test.ts`, `lib/client-fetch.test.ts` (7 new tests for 401-refresh wrapper)
- **E2E tests** (playwright): `tests/e2e/login.spec.ts` (7 tests; 5 pass, 1 skipped intentionally, 1 pre-existing failure unrelated to M2.3)
- **Pre-existing failure noted** (NOT introduced by M2.3): `sessions 3-way filter: root sees its own session` test fails because `lib/session-meta.ts::recordSessionMeta` is a stub from M1, never called by `startRpcSession`. See `docs/superpowers/reports/2026-07-14-playwright-run.md` for details.

## Build Evidence

- `comet state record-check build --command "PI_WEB_JWT_SECRET=test_secret_for_build_only pnpm run build" --exit-code 0`
- Build passes with: 6 new Prisma migrations applied, schema changes (`createdBy`, `updatedAt`, `RefreshTokenBlacklist`)

## Issues by Priority

### CRITICAL
- None

### WARNING
- **W1**: refresh-token spec scenarios (4 scenarios: 续期/撤销/缺失/登出) lack dedicated e2e tests. Covered by API implementation + token-blacklist unit tests + indirect e2e coverage. Recommendation: Add `tests/e2e/refresh-token.spec.ts` to cover these scenarios explicitly. Not blocking M2.3 archive.

### SUGGESTION
- **S1**: Plan §6.1 originally said task 5.1 (login page refresh retry) is "non-M2.3 blocker". User explicitly chose to include it; deviation is documented in plan file.

## Design Doc Coherence

- design.md present and aligned with implementation
- plan §2-§5 (architecture, Phase 1-4) followed
- plan §6 (UI 适配) covered by 5.1, 5.2, 5.3 (all complete)
- plan §7 (测试策略): all listed test files exist and are wired

## Final Assessment

**No critical issues.** 1 warning (refresh-token e2e coverage gap, non-blocking). Implementation is complete, tested, and aligned with design.

READY FOR ARCHIVE (with noted W1 follow-up).
