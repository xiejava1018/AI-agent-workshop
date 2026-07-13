# M2.2 subagent-progress (comet-build coordinator checkpoint)

## Run config
- change: pi-web-m2-2-ui-and-hardening
- branch: feature/20260713/pi-web-m2-2-ui-and-hardening
- base_ref: 934f21aab2b6c2a4513398689bcd76592cee7da5 (M1 archive point)
- plan: docs/superpowers/plans/2026-07-13-pi-web-m2-2-ui-and-hardening.md
- design: docs/superpowers/specs/2026-07-13-pi-web-m2-2-ui-and-hardening-design.md
- build_mode: subagent-driven-development
- subagent_dispatch: confirmed
- tdd_mode: tdd
- review_mode: standard
- isolation: branch
- language: zh-CN

## Tasks (plan → openspec tasks.md mapping)
| plan Task | openspec tasks.md | current stage |
|---|---|---|
| Task 1  | 1.1 (lib/prisma.ts) | **done** (commit b08fe5e, no review needed, openspec checkoff next) |
| Task 2  | 1.2 (PrismaClient 重构) | **done** (commit 5ad97fc, no review needed, openspec checkoff next) |
| Task 3  | 1.3 (must-change-password helper) | **done** (commit 7372e6d, per-task review PASSED, openspec checkoff next) |
| Task 4  | 1.4 (server-user helper) | **done** (commit 2be4b2e, no review needed, openspec checkoff next) |
| Task 5  | 1.5 (middleware runtime + mustChangePwd 注入) | pending |
| Task 6  | 1.6 (i18n matcher 验证) | pending |
| Task 7  | 2.1 ([locale]/layout.tsx) | pending |
| Task 8  | 2.2 (lib/i18n.ts locale 解析) | pending |
| Task 9  | 2.3 (en.json 扩 key) | pending |
| Task 10 | 2.4 (zh.json 扩 key) | pending |
| Task 11 | 2.5 (middleware matcher i18n 例外) | pending |
| Task 12 | 3.1 (login/page.tsx) | pending |
| Task 13 | 3.2 (change-password/page.tsx) | pending |
| Task 14 | 3.3 (dashboard/page.tsx) | pending |
| Task 15 | 4.1 (6 个写路由加门) | pending |
| Task 16 | 4.2 (agent/new 改 lastProjectId) | pending |
| Task 17 | 4.3 (sessions 3-way 过滤) | pending |
| Task 18 | 4.4 (rebuildFromJsonl 真实现) | pending |
| Task 19 | 4.5 (session-cap.ts) | pending |
| Task 20 | 4.6 (agent/new 调 50 cap) | pending |
| Task 21 | 4.7 (Dockerfile migrate deploy) | pending |
| Task 22 | 5.1 (meta-test AST scan) | pending |
| Task 23 | 5.2 (E2E 4 use case 扩) | pending |
| Task 24 | 6.1 (tsc clean) | pending |
| Task 25 | 6.2 (vitest pass) | pending |
| Task 26 | 6.3 (playwright pass) | pending |
| Task 27 | 6.4 (build clean) | pending |
| Task 28 | 6.5 (browser manual smoke) | pending |

## Risk signals (cross-task)
- Task 1.5 (middleware runtime + mustChangePwd) — security-sensitive (auth boundary)
- Task 1.6 (i18n matcher) — known M1 path-to-regexp v8 issue
- Task 2.5 (middleware matcher i18n) — security-sensitive + same risk as 1.6
- Task 3.1/3.2/3.3 (UI pages) — public API contract (UI surface)
- Task 4.1 (6 个写路由加门) — security-sensitive, multi-file
- Task 4.2 (agent/new lastProjectId) — security-sensitive (path)
- Task 4.3 (sessions 3-way 过滤) — security-sensitive (read-path authz)
- Task 4.5 (session-cap) — concurrency (in-memory counter)
- Task 4.6 (agent/new 调 50 cap) — security + concurrency
- Task 4.4 (rebuildFromJsonl) — concurrency (lazy or startup race)
- Task 5.1 (meta-test) — test infra; per-task review triggered
- Task 5.2 (E2E 4 use case) — public API contract

## Stages vocabulary
implementing → task-review (only for risk-flagged) → checkoff → done
final-review (after all done, light reviewer) → final-fix (1 round max) → done

## Per-task checkpoint format (filled in as tasks run)
```
### Task N
- stage: ...
- implementer_agent_id: ...
- commit_sha: ...
- files_changed: ...
- red_evidence: ...
- green_evidence: ...
- risk_signals_hit: [list]
- review_decision: PASS|FAIL
- review_round: 0
- fix_agent_id: ...
- openspec_checkoff: pending|done
```
