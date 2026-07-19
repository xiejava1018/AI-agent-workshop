# 验证报告:agent-workbench-session-bugs

> change: `agent-workbench-session-bugs`
> 类型: hotfix workflow
> 日期: 2026-07-19
> 验证模式: full(`comet state scale` → 18 changed files > 8 阈值)
> 语言: zh-CN

## Summary

| Dimension | Status |
|---|---|
| Completeness | 24/24 tasks ✓, 0 delta specs (仅 tasks+proposal+design) |
| Correctness | Bug 1 / Bug 3 实现对齐 design;Bug 2 端点与 design 描述不符(见 W-1) |
| Coherence | Design 内有一处 impl divergence;其余实现与项目模式一致 |

## 验证证据(本回合 fresh run)

| 检查 | 命令 | 结果 |
|------|------|------|
| dashboard build | `pnpm --filter @ai-agent-workshop/dashboard build` | exit 0,14.24s |
| dashboard vitest 完整套件 | `pnpm --filter @ai-agent-workshop/dashboard exec vitest run` | 14 files, **128 / 128 pass** |
| web build | `pnpm --filter @ai-agent-workshop/web build` | exit 0 |
| Regression-test red-green | `vitest run src/api/agent.test.ts`(本回合重跑) | 修改回旧 `res.data?.context` → **2/3 fail**;恢复修复 → **3/3 pass** |

`comet state record-check` 已记录 3 个 verify 命令的 exit=0。

## 维度 1: Completeness

- tasks.md 24/24 完成(T0–T6.5 全 `[x]`)。
- delta specs 目录为空(`specs/**/*.md` 0 existing)→ 跳过 spec coverage 校验。

## 维度 2: Correctness

**Bug 1(useSessionList 乐观 push 被覆盖)**
- 实现位置:`apps/dashboard/src/views/agent-workbench/composables/useSessionList.ts:144-191`
- design § 1 (Bug 1) 要求:`load()` 改用 Map-by-id 合并,保留 optimisticIds 中的本地项。
- 实现:`Map<id,AgentSession>` + `optimisticIds` 跟踪 → ✓ 与 design 一致。
- 测试覆盖:`useSessionList.test.ts` 用例 1–3 已加 ✓。

**Bug 3(刷新后丢失)**
- 实现位置:`useSessionList.ts:106-142` localStorage 持久化乐观项,`AppShell` 恢复 lastSessionId(见 `T3.1`)→ ✓ 与 design 一致。

**Bug 2(tab 切换历史)**
- 设计意图(`design.md` § 1 Bug 2;`proposal.md` § 3 Bug 2;`tasks.md` T2.1–T2.4):
  - 新建后端 `GET /api/agent/[id]/messages`
  - 前端 `fetchSessionMessages(sessionId)` 调 `${PREFIX}/${sessionId}/messages`
  - `useAgentSession.fetchHistory()` 触发顺序:resetSession → fetchHistory → prepend
- 实际实现(`apps/dashboard/src/api/agent.ts:191`):
  - `fetchSessionMessages` 实际 URL = `\`/api/sessions/${encodeURIComponent(sessionId)}?deferThinking=1&deferMedia=1\`` — **即调用 Next.js 已有的 `/api/sessions/[id]` 路由**,不是 design 里写的 `/api/agent/[id]/messages`。
- `apps/web/app/api/agent/[id]/messages/route.ts` 文件存在且功能正确(返回 `{code,data:{messages,hasMore,total}}`),但 **Vue 仪表盘前端没有调用它**。
- `useAgentSession.fetchHistory()` 的实现(`apps/dashboard/src/views/agent-workbench/composables/useAgentSession.ts:126-141`)与 design 一致(resetSession → fetchHistory → prepend,race 防护)。
- 实际结果(用户已在浏览器验收):Bug 2 表现修复,历史消息正确显示,故"调用错的端点但拿到正确数据"——因为 Next.js 的 `/api/sessions/[id]` 一直就是历史数据的源头(React 参考界面 `apps/web/hooks/useAgentSession.ts:448` 也用它)。

## 维度 3: Coherence

- 模式一致:`apps/dashboard/CLAUDE.md` 的已知陷阱段已加入"乐观合并"和"fetchHistory race"(T5.1)✓。
- 代码风格与 `apps/dashboard/src/api/*.ts` 文件族一致。
- 安全:无新增密钥、无新增 unsafe 操作;`enforceNotMustChange` 是新增的认证闸(无害)。

## Issues

### CRITICAL

无(用户已确认 Bug 1/2/3 在浏览器实际表现修复)。

### WARNING

**W-1(design vs impl drift — Bug 2 端点)**

- `design.md` § 1 Bug 2 与 `proposal.md` § 3 Bug 2 都把"新增后端 `GET /api/agent/[id]/messages`"列为修复方案,且 `tasks.md` T2.1 把"新增后端 `apps/web/app/api/agent/[id]/messages/route.ts`"作为交付任务。T2.1 标记 `[x]`,该 route.ts 文件也确实存在并能工作 —— 但 Vue 前端的 `fetchSessionMessages` **改用了 Next.js 已有的 `GET /api/sessions/[id]`**。
- 影响:
  1. 用户可见行为正确:历史消息按预期显示(已由用户在浏览器验收)。
  2. design 制品与实现不一致,影响 spec-driven 仓库"以 OpenSpec 为真实来源"的契约。
  3. `/api/agent/[id]/messages` 端点存在但**没有 Vue 消费者** —— 死代码风险。

### SUGGESTION

无。

## 决策点(暂停等待用户)

W-1 必须由用户在归档前决定。详见对话中的 AskUserQuestion。

---

## Final Assessment

- 验证证据:全绿(dashboard build ✓、128/128 ✓、web build ✓、Regression red-green ✓)。
- 用户现实验收:已确认(Bug 1/Bug 2/Bug 3 在浏览器全部按预期工作)。
- CRITICAL issues:0。
- WARNING issues:**1**(W-1 design-vs-impl 漂移)—— 待用户决策。
- SUGGESTION issues:0。
- 一旦 W-1 决策落地 → 推进 archive 阶段。
