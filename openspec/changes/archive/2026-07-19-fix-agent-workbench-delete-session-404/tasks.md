## 1. 复现 + 根因定位

- [x] 1.1 通过用户提供的浏览器 devtools Network 截图获取 DELETE /api/sessions/cmroybtik0005zhejfq1mxwa8 的 method/URL/headers/body（axios stack trace + `code: 'ERR_BAD_REQUEST'` + status 404），证明请求真实落到 Next 路由并被 4xx。
- [x] 1.2 用 curl 对 dev server 跑 cookie-less DELETE，确认路由对未授权返 401 JSON `{"error":"auth required"}` —— 排除"路由未注册"假设。
- [x] 1.3 Read `apps/dashboard/src/utils/http/index.ts`、`vite.config.ts` 确认 baseURL 为空 + proxy → 30141 + DELETE method 显式设置；前端调用形态正确。

## 2. TDD RED（先写失败测试）

- [x] 2.1 在 `apps/web/tests/integration/` 新增 `list-sessions-zombie-filter.test.ts`：模拟"DB 有 session row 但磁盘 .jsonl 不存在"的僵尸场景，断言 platform_admin GET /api/agent/sessions 不返它；RED 验证：buggy 实现返 zombie，断言失败。文件路径：apps/web/tests/integration/list-sessions-zombie-filter.test.ts
- [x] 2.2 根因路径选定后，原计划的"前端 URL/method 断言"被替代为"后端 listSessions 行为断言"——前端 axios 调用形态已通过 1.3 Read 静态确认无需单测覆盖。

## 3. GREEN + 验证

- [x] 3.1 改单文件：`apps/web/app/api/agent/sessions/route.ts` 在 list loop 里加 `resolveSessionPath(s.id) → null → continue`，跳过 zombie session（platform_admin bypass 下也生效）。修改：+9 行 + 1 import。
- [x] 3.2 GREEN 跑通：`pnpm vitest run tests/integration/list-sessions-zombie-filter.test.ts` 1 passed (1)。`pnpm tsc --noEmit` 0 errors。完整 `pnpm vitest run` 的 40 文件 × PostgresError 42704 baseline 失败与本次 fix 无关（DB schema migration 未跑），未引入新失败。
- [x] 3.3 手动浏览器验证：用户刷新 dashboard，3 个 zombie session（Test Session for Admin/Member、Session With Secret Path）从侧栏消失，删除按钮可点。
- [x] 3.4 根因消除检查：design.md Open Questions 段记录 H1 + falsification + 验证后的根因（DB 与磁盘双源不一致 + platform_admin bypass）；修改后的 `apps/web/app/api/agent/sessions/route.ts` 是单点 source-of-truth 修复。
- [x] 3.5 build → verify guard 通过后更新 `.comet.yaml` 字段。