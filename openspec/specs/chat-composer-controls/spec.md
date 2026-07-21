# chat-composer-controls Specification

## Purpose
TBD - created by archiving change agent-workbench-chat-ui-clone-v1. Update Purpose after archive.
## Requirements
### Requirement: model 选择下拉

The system SHALL display the current model name on the left of the composer status bar, with a `▾` indicator. Clicking SHALL open a dropdown listing every entry in `modelList`, sorted by `Intl.Collator({numeric: true, sensitivity: 'base'})`. The current model SHALL be highlighted. Selecting an entry SHALL optimistically update the label and invoke `sendAgentCommand({type: 'set_model', provider, modelId})`; on failure, the label MUST roll back.

Composer 状态条左侧显示当前 model(初始为 `MiniMax-M3 ▾` 或 session metadata 中的 `model.provider+modelId`),点击展开下拉面板(按 `Intl.Collator({numeric: true, sensitivity: 'base'})` 排序)。

#### Scenario: 默认显示 session 模型名

- **WHEN** session 加载完成且 `modelNames[provider+modelId]` 有命中
- **THEN** 控件 label = `modelNames[provider+modelId]`
- **AND** 右侧 `▾` 三角表示可下拉

#### Scenario: 点击展开下拉

- **WHEN** 用户点击控件
- **THEN** 展开下拉面板,选项包含 `modelList` 全部条目(每个含 provider+modelId+name)
- **AND** 当前模型用 `is-active` class 高亮
- **AND** 点击面板外区域关闭面板(无副作用)

#### Scenario: 选中模型

- **WHEN** 用户在下拉中选中某项
- **THEN** 乐观更新 UI:label 立即变为新模型名
- **AND** 调用 `sendAgentCommand(sid, {type: 'set_model', provider, modelId})`
- **AND** 命令失败时回滚 label 到旧值 + ElNotification warning

#### Scenario: 空模型列表

- **WHEN** `modelList` 缺失或为空
- **THEN** 控件降级为纯文本 `no model` 不渲染下拉箭头,点击无反应

#### Scenario: 自动模式特殊显示

- **WHEN** `isAutoModelSelection === true`(用户未显式选)
- **THEN** label 显示 `auto` 而非具体模型名

### Requirement: thinking level 下拉

The system SHALL display the current thinking level (`auto / off / minimal / low / medium / high / xhigh / max`) in the middle of the status bar. When `modelThinkingLevels[provider+modelId]` is defined, the dropdown MUST only show levels supported by the current model. Selecting a level SHALL optimistically update the label and invoke `sendAgentCommand({type: 'set_thinking_level', level})`.

Composer 状态条中部显示 8 个 level 之一:`auto / off / minimal / low / medium / high / xhigh / max`。点击展开,选中调 `sendAgentCommand(sid, {type: 'set_thinking_level', level})`。

#### Scenario: 默认值

- **WHEN** session metadata 中 `thinkingLevel` 为 `'medium'`
- **THEN** 控件 label = `medium`

#### Scenario: 可用等级过滤

- **WHEN** `modelThinkingLevels[provider+modelId]` 存在(模型限定等级)
- **THEN** 下拉只显示该模型支持的等级
- **WHEN** `modelThinkingLevels` 缺失
- **THEN** 显示全部 8 个等级

#### Scenario: 选中等级

- **WHEN** 用户在面板中选中 `'high'`
- **THEN** 乐观更新 label 为 `high`
- **AND** 调 `sendAgentCommand(sid, {type: 'set_thinking_level', level: 'high'})`

### Requirement: tool preset 切换

The system SHALL display the current tool preset (`off / default / full`) on the right of the status bar. Selecting a preset MUST map it via `getToolNamesForPreset(preset, allTools)` to a `string[]` and invoke `sendAgentCommand({type: 'set_tools', toolNames})`. After the command, the system MUST call `sendAgentCommand({type: 'get_tools'})` to refresh the local tool list. On any failure, the label MUST roll back.

Composer 状态条右侧显示当前 preset:`off / default / full` 三选一。点击循环切换或展开三选项。

#### Scenario: 初始 preset

- **WHEN** session 首次进入,`toolPreset` 缺失
- **THEN** 控件 label = `default`(产品默认)

#### Scenario: 切换到 full

- **WHEN** 用户点击 `full`
- **THEN** 调用 `sendAgentCommand(sid, {type: 'set_tools', toolNames: FULL_TOOL_NAMES})`
- **AND** 调 `sendAgentCommand(sid, {type: 'get_tools'})` 拉新列表以同步 tool 展示
- **AND** label 立即更新为 `full`,命令失败时回滚

#### Scenario: tool preset 与 toolNames 映射

- **WHEN** 切换 preset
- **THEN** 映射规则: `off` → `[]`,`default` → 内置 4 个核心工具,`full` → 全部已注册工具
- **AND** 工具清单通过 `get_tools` 拉取的 union 决定(取该 provider+modelId 注册的工具全集)
- **AND** 映射表存于 `apps/dashboard/src/views/agent-workbench/composables/toolPresets.ts`(新增,导出 `getToolNamesForPreset(preset, allTools)`)

#### Scenario: 缺失 get_tools 响应

- **WHEN** `get_tools` 拉取失败
- **THEN** 不更新本地 tool 列表(保持上次成功值),UI 不显示错误

### Requirement: 状态条整体布局

The system SHALL arrange the three controls horizontally in the order model / thinking / preset with 8px spacing, font size 12px, color `--wb-text-dim`. The `▾` caret SHALL be rendered using the `CaretBottom` icon. When `isStreaming` is `true`, the system MUST disable all three controls. State changes MUST persist via the corresponding commands and be restored from session metadata on re-open.

#### Scenario: 状态条在 disabled 状态

- **WHEN** `isStreaming === true`
- **THEN** 三个控件全部禁用(灰色 + 不可点击),避免 streaming 中途切换状态导致 UI/后端不一致

#### Scenario: 状态条持久化

- **WHEN** 用户在某 session 切换 model / thinking / preset
- **THEN** 后端 session metadata 持久化(走 `set_model` / `set_thinking_level` / `set_tools` 命令,后端会写入 .jsonl 头部)
- **AND** 切走再切回,UI 状态从 session metadata 恢复

