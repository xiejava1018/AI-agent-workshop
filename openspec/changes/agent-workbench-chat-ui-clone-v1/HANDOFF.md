# Handoff Notes: agent-workbench-chat-ui-clone-v1

> Comet change: `agent-workbench-chat-ui-clone-v1`
> Phase: build (worktree active, T1 implementer running)
> Last updated: 2026-07-20

## 当前状态

- **分支**: `feat/agent-workbench-chat-ui-clone-v1` (worktree `.worktrees/chat-ui-clone-v1`)
- **base_ref**: `081c98b415d97826eacebfa87cbeade30c300d28` (last commit on main when worktree created)
- **change 目录**: `openspec/changes/agent-workbench-chat-ui-clone-v1/` (untracked, files: proposal.md / design.md / specs/×3 / tasks.md / .comet/ / .comet.yaml / .openspec.yaml)
- **T1 implementer 状态**: 进行中(已改 useEventStream.ts + types.ts,可能 T1.1+T1.2 部分完成)
- **baseline 测试**: 128/128 pass

## 制品路径(全部已在 worktree 中可读)

- `openspec/changes/agent-workbench-chat-ui-clone-v1/proposal.md` — why / what / 3 capabilities
- `openspec/changes/agent-workbench-chat-ui-clone-v1/design.md` — high-level 决策
- `openspec/changes/agent-workbench-chat-ui-clone-v1/specs/agent-message-chrome/spec.md` — A1+A2+A3
- `openspec/changes/agent-workbench-chat-ui-clone-v1/specs/chat-composer-controls/spec.md` — B4+B5+B6
- `openspec/changes/agent-workbench-chat-ui-clone-v1/specs/chat-streaming-queue/spec.md` — B7+B8
- `openspec/changes/agent-workbench-chat-ui-clone-v1/tasks.md` — 8 桶任务清单
- `openspec/changes/agent-workbench-chat-ui-clone-v1/.comet/handoff/brainstorm-summary.md` — checkpoint
- `openspec/changes/agent-workbench-chat-ui-clone-v1/.comet/handoff/design-context.{md,json}` — handoff
- `docs/superpowers/specs/2026-07-20-agent-workbench-chat-ui-clone-v1-design.md` — Technical Design Doc

## 已发送给 T1 implementer 的修正(关键决策)

1. **OQ-1 修正**: SDK **不** emit 独立 `message_usage` 事件。`usage` 字段在 `message_start` / `message_update` 事件的 `event.message.usage` 上。Vue 当前 `message_start` case **丢失了 `usage` 字段**,需要保留。

2. **T1.4 基础**: Vue 端**没有**通用 `sendAgentCommand(sid, body)` 抽象,T1.4 必须新建这个通用 RPC 包装,作为 6 个新方法(setModel / setThinkingLevel / setTools / getTools / getSlashCommands / cancelQueue)的基础。**重构 `sendMessage` 内部用新 sendAgentCommand**。

3. **ToolEntry + ToolPreset shape 修正** (来自 React `apps/web/lib/tool-presets.ts`):
   - `ToolEntry = { name, description, active }`
   - `PRESET_DEFAULT = ["read", "bash", "edit", "write"]`
   - `PRESET_FULL = ["bash", "read", "edit", "write", "grep", "find", "ls"]`
   - `ToolPreset = "none" | "default" | "full"` (**不是** design.md 写的 "off")

4. **SlashCommandInfo shape**: 完整字段已发,source = `"extension" | "prompt" | "skill"`,T5 builtin 需扩展加 `"builtin"`。

5. **OQ-2 已确定**: `cancel_queue` 后端**无**,降级为本地移除 + warning。

## T1 实施计划(已发给 implementer)

- T1.1 types.ts 扩展
- T1.2 useEventStream.ts SSE 处理(只加 3 类,`message_usage` 不加)
- T1.3 useAgentSession.ts 16+ 新 ref
- T1.4 api/agent.ts 6 新方法 + 通用 `sendAgentCommand`
- T1.5 单个 commit

## 下次会话如何接上

1. **重新 select 同一个 change**:
   ```bash
   cd /Users/xiejava/AIproject/AI-agent-workshop
   comet state select agent-workbench-chat-ui-clone-v1
   ```
2. **worktree 已存在**,直接 `cd .worktrees/chat-ui-clone-v1` 进入
3. 检查 T1 commit 是否落地:`git log --oneline -3` 应该看到 `feat(dashboard): extend chat types and SSE events for chrome v1`
4. 如果 T1 完整 commit + 测试 128+ 通过,继续 T2;如果 implementer 失败 / reviewer 未通过,按其报错修
5. **T2-T6 串行实施**(同 subagent 模式:每桶 1 implementer → 2 reviewers)

## 关键 design 决策(用户确认)

| 决策 | 内容 |
|---|---|
| 头像 | **不画**,文本标签 |
| token footer | `{n} in · {n} out · {n} cache`,**不显示 cost** |
| 路径 B(art-chat-window) | **不升级** |
| IME 保护 | `compositionstart/end` 事件 |
| 提交模式 | worktree 隔离(已完成) |
| 实施模式 | subagent 并行(每桶 implementer + 2 reviewer) |

## 风险清单

- 4 个 OQ 已通过实测代码确认,见 design.md §10
- OQ-2 `cancel_queue` 降级已确认
- 实施中可能发现新的 OQ(usage 填充时机 / model reconcile 等),届时按 Comet Spec Patch 流程回写
