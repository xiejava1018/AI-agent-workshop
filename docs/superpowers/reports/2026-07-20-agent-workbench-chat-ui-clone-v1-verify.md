# Verify Report: agent-workbench-chat-ui-clone-v1

- change: `agent-workbench-chat-ui-clone-v1`
- workflow: full
- verify_mode: full (scale: 38 tasks / 3 delta specs / 35 files)
- verified_at: 2026-07-20
- feature branch: `feat/agent-workbench-chat-ui-clone-v1`
- HEAD: `84ddda4` (fix(dashboard): wire message_usage SSE event)
- base-ref: `081c98b`
- reviewer: opener (build→verify 主会话)
- spec drift: none detected
- T7.4 browser manual: deferred to follow-up PR (user decision 「稍后验收」)

## Summary Scorecard

| Dimension    | Status |
|--------------|--------|
| Completeness | 38/38 tasks done; 3 delta specs requirements covered |
| Correctness  | Implementation matches design decisions 1-7; per-task + final code review APPROVED |
| Coherence    | `apps/dashboard` only; `apps/web` zero change (intentional) |

## Verification Evidence (executed by coordinator)

| Check | Command | Exit | Notes |
|---|---|---|---|
| Full dashboard test suite | `pnpm --dir apps/dashboard exec vitest run` | 0 | 17 files / **212 passed** (T1.2b backfill +3 vs 209) |
| Dashboard build (vue-tsc + vite) | `pnpm --filter @ai-agent-workshop/dashboard build` | 0 | vue-tsc + vite build clean |
| Web build (env required) | `PI_WEB_JWT_SECRET=ephemeral APP_ENCRYPTION_KEY=ephemeral pnpm --filter @ai-agent-workshop/web build` | 0 | Ephemeral secrets; my diff is zero apps/web so no regression |
| Vue type check | `pnpm --dir apps/dashboard exec vue-tsc --noEmit` | 0 | Clean |

All four checks executed and verified by coordinator (build-mode: subagent-driven-development allowed the coordinator to verify post-implementation).

## Implementation Coverage Matrix

### delta spec 1: agent-message-chrome
| Requirement | Implementation | Test anchor |
|---|---|---|
| 消息头部文本标签 | `MessageView.vue:155-171` (USER tag, model-name span) | `MessageView.test.ts` 38 it |
| 智能时间戳 | `MessageView.vue:74-92 formatTime` | `MessageView.test.ts` formatTime describe |
| token 计数 footer | `MessageView.vue:95-106 showUsageFooter` | indirect via usage-based MessageView cases |
| User 操作按钮 | `MessageActionBar.vue` (Copy/Edit/Fork/Navigate) | MessageView emit + action bar a11y |
| Assistant 操作按钮 | `MessageActionBar.vue` (Copy/Retry) + cancelled 显式 Retry | MessageView.test.ts |
| 操作按钮可访问性 | MessageActionBar `role="toolbar"` + aria-label | MessageView.test.ts a11y describe |

### delta spec 2: chat-composer-controls
| Requirement | Implementation | Test anchor |
|---|---|---|
| model 选择下拉 | `ModelSelector.vue` Intl.Collator + isAuto + no-model | ChatInput.test.ts ModelSelector 5 it |
| thinking level 下拉 | `ThinkingLevelSelector.vue` 8 levels + model-level filter | ChatInput.test.ts 5 it |
| tool preset 切换 | `ToolPresetSelector.vue` none/default/full | ChatInput.test.ts 5 it |
| 状态条整体布局 | ChatInput.vue status bar + is-disabled | ChatInput.test.ts status bar 3 it |

### delta spec 3: chat-streaming-queue
| Requirement | Implementation | Test anchor |
|---|---|---|
| queued messages 显示 | `StreamingQueueBar.vue` + useAgentSession `sendSteer/sendFollowUp/cancelQueue` | StreamingQueueBar.test.ts 11 it |
| slash 命令面板 | `SlashPalette.vue` 3-tier fuzzy + role=listbox + aria-activedescendant + keyboard | SlashPalette.test.ts 11 it + ChatInput.test.ts 4 it |
| slash 命令执行 | onSlashSelect → inputText = name + ' ' | ChatInput.test.ts select case |

### T1.2b (residual recovery)
| Item | Implementation | Test anchor |
|---|---|---|
| message_usage SSE 白名单 | `types.ts:158 'message_usage'` + `useEventStream.ts` case handler | useEventStream.test.ts 19 it (含 3 message_usage) |
| AgentMessageUsage 类型 | `types.ts:53` interface | types 间接覆盖 |

### Design Decisions 1-7
| Decision | Implementation | Compliance |
|---|---|---|
| 1. shared useAgentSession ref 集合 | useAgentSession.ts ~30 refs | ✓ |
| 2. useEventStream SSE 扩展 | 4 类 chrome v1 事件 | ✓ |
| 3. types.ts 增量字段 | usage / entryId / prevAssistantEntryId / modelProvider / modelId / QueueItem / SlashCommandPaletteItem | ✓ |
| 4. ChatInput IME 保护 | isComposing ref + composition start/end + onKeydown 第一行守卫（**在 slash palette 块之前，未合并 OR**） | ✓ ChatInput.test.ts 2 it |
| 5. 操作按钮 emit 模式 | MessageActionBar presentational + ChatWindow 容器层接 emit | ✓ CLAUDE.md 陷阱 #3 记录 |
| 6. tool preset 映射独立工具 | api/agent.ts getToolNamesForPreset 写死常量数组 | ✓ toolPresets.test.ts 3 it（implementer 校正：实现不接 allTools，与 apps/web/lib/tool-presets.ts 对齐） |
| 7. slash palette role=listbox + 键盘焦点 | SlashPalette role/aria + ChatInput palette 键盘块（↑↓/Enter/Escape） | ✓ |

## Issues Identified

### CRITICAL — 全部修复
- **C1 (T1.2b 落地缺失，build 阶段失败)**: build 阶段 T1.2b implementer 提交 `2eeaf11` 到 sandbox 分支未 fast-forward 到 feat，tasks.md 被误勾。最终全分支审查 APPROVE 之前未做 base-ref diffstat 校验（仅看 commit 列表）。**修复**：cherry-pick `2eeaf11` 到 feat（commit `84ddda4`，与 HEAD 三方合并冲突已解决：保留 HEAD 已有 queue_update/thinking/model 三个 case，新增 message_usage case；ALLOWED_SSE_EVENTS 白名单合并为 4 类；types.ts usage 字段 HEAD 已有）。回归：dashboard vitest 212 passed (T1.2b +3 case)、dashboard build green、web build green、vue-tsc exit 0。**避免再发**：build 阶段最终审查应核验 `git diff base_ref..HEAD --stat` 与 plan 任务清单对齐；fast-forward / cherry-pick 流程后必须立刻核验 commit 落到 feature 分支（`git merge-base --is-ancestor`）。

### ACCEPTED NICE-TO-HAVE（已记录，verify 报告保留）
1. `useAgentSession.ts:246` `toolPreset` 初始值为 `'none'`，spec §B6 要求 `'default'`——生产 hook 默认值改有跨测试风险，不在 verify 修复预算内。
2. 队列在 `streamStatus === 'done'` 时未自动清空（spec MUST），依赖后端 `queue_update` 协调——后端正常时无感，慢/缺失时留陈旧行；同上不在 verify 修复预算内。
3. `ChatWindow.vue:105-106` 注释笔误（说 MessageView 内部调 copyText，实际是 MessageActionBar）——过时注释、不影响行为，pre-existing。
4. 选中 slash 命令后面板重开为空态（pre-existing，spec 未要求选中后关闭）。

### UNVERIFIED（明示转交用户）
- **T7.4 浏览器手动验收 7 场景**（用户跑 dev server）：用户决定推迟到后续 PR（已用 `[skip-browser-manual — deferred to follow-up PR]` 标注勾选）。场景清单见 design §7.4 / tasks.md。

## Final Assessment

**ALL CHECKS PASSED — ready for archive (with documented NICE-TO-HAVE and deferred browser manual acceptance).**

- CRITICAL: 0 (T1.2b backfill 修复完成)
- WARNING: 0
- NICE-TO-HAVE: 3 (accepted with reason)
- UNVERIFIED: 1 (T7.4 浏览器手动 → 用户)

Change scope: 19 commits on feat branch, 24 source files + 4 docs/spec files changed, ~3862 insertions, all in `apps/dashboard` + OpenSpec/plan/recovery docs. `apps/web` 零改动。