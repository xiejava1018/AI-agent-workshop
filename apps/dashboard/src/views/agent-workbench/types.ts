/**
 * Agent 工作台共享类型
 *
 * 修订记录:
 * - v1.0: 初版(基于 docs/plans/2026-07-18-...-design.md §3)
 * - v1.1: 与 apps/dashboard/src/api/agent.ts 中 AgentSession 对齐
 * - v1.2: + SSE 事件白名单、RunningStateMap
 * - v1.3: SSE 事件名按 Track B 实测修正(下划线 message_start 而非点号)+ + STREAM_TIMEOUT_MS
 *         + + AgentMessage.streamStatus
 * - v1.4: + CwdInfo(apps/web 补 /api/agent/[id]/files 配套)
 * - v1.5: 合并 Track A / Track C 注释(行尾字段说明从其他分支同步)
 */

/**
 * v1.6: + AgentMessage.usage/entryId/prevAssistantEntryId/modelProvider/modelId
 *        (chrome v1 头部 + token footer 需要)
 *      + QueueItem(steer/followUp 队列)
 *      + SlashCommandInfo / ToolEntry / ThinkingLevel 枚举(slash palette + 状态条用)
 */

import type { AgentSession } from '@/api/agent'

// ============================================================================
// 会话
// ============================================================================

export type { AgentSession }

// ============================================================================
// 消息 / 工具调用 / 分支
// ============================================================================

export type AgentRole = 'user' | 'assistant' | 'system' | 'tool'

export type ToolCallStatus = 'pending' | 'running' | 'done' | 'error'

export interface ToolCall {
  id: string
  name: string
  status: ToolCallStatus
  args?: unknown
  result?: unknown
  startedAt?: string
  completedAt?: string
}

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'error' | 'cancelled'

/**
 * AgentMessage.usage —— SDK 在 message_start 上携带的 token 使用统计。
 * 字段镜像 apps/web/lib/types.ts AssistantMessage.usage,但 cost? 可选(v1 footer
 * 不展示 cost,见 A2-b 决策)。
 */
export interface AgentMessageUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}

export interface AgentMessage {
  id: string
  role: AgentRole
  content: string
  toolCalls?: ToolCall[]
  branchId?: string
  parentMessageId?: string
  createdAt: string
  /** 流中断时被 useAgentSession 标记为 true */
  partial?: boolean
  /** abort() 后被标记 */
  cancelled?: boolean
  /** Track B: 流状态机,用于 UI 区分 idle/streaming/done/error/cancelled */
  streamStatus?: StreamStatus
  // ↓ chrome v1 新增字段
  /** SDK 在 message_start 携带的 token 用量(仅 assistant 有);footer 渲染依据 */
  usage?: AgentMessageUsage
  /** SDK entryId(stable id,用于 fork / navigate) */
  entryId?: string
  /** 上一条 assistant 的 entryId(用于 Navigate Up 按钮) */
  prevAssistantEntryId?: string
  /** SDK 在 message_start 携带的模型来源(provider id) */
  modelProvider?: string
  /** SDK 在 message_start 携带的模型 id */
  modelId?: string
}

export interface Branch {
  id: string
  parentMessageId: string
  createdAt: string
  /** Track B: 分支标题(展示在 BranchNavigator) */
  title?: string
}

// ============================================================================
// SSE 事件窄白名单(参考 memory pi-sdk-event-narrow-whitelist-pitfall)
// 不在白名单的事件 console.warn 后丢弃,绝不放进 ref 防泛洪
// ============================================================================
//
// 命名约定: 下划线 (message_start),由 Track B 实测 apps/web 推送确认。
// 基线 v1.0-v1.2 用了点号(message.start),是错的,本版修正。

export const ALLOWED_SSE_EVENTS = [
  'connected',
  'message_start',
  'message_delta',
  'message_end',
  'tool_start',
  'tool_delta',
  'tool_complete',
  'tool_update',
  'branch_created',
  'branch_switched',
  'file_changed',
  'session_pinned',
  'session_renamed',
  'prompt_done',
  'error',
  'done',
  // chrome v1:3 个新事件
  // - queue_update:后端推 { steer, followUp } 更新,直接覆盖 queuedMessages
  // - thinking_level_changed:模型 thinking 档位变化
  // - model_changed:模型切换(provider+modelId)
  'queue_update',
  'thinking_level_changed',
  'model_changed'
] as const

export type AllowedSseEvent = (typeof ALLOWED_SSE_EVENTS)[number]

/** 旧的 Set<string> 形式 — 保留给老调用方(兼容) */
export const ALLOWED_SSE_EVENTS_SET: ReadonlySet<string> = new Set(ALLOWED_SSE_EVENTS)

/** Track B: 流超时时间(毫秒):SSE 长时间无任何事件时自动标记 partial */
export const STREAM_TIMEOUT_MS = 90_000

/** 经过窄白名单过滤后的 SSE 事件 payload(Track B 风格) */
export type SSEEventPayload =
  | { type: 'connected' }
  | { type: 'message_start'; messageId: string; role: AgentRole }
  | { type: 'message_delta'; messageId: string; delta: string }
  | { type: 'message_end'; messageId: string }
  | { type: 'tool_start'; toolCallId: string; messageId: string; name: string; args?: unknown }
  | { type: 'tool_delta'; toolCallId: string; delta: string }
  | { type: 'tool_complete'; toolCallId: string; result: unknown }
  | { type: 'tool_update'; toolCallId: string; status: ToolCallStatus }
  | { type: 'branch_created'; branchId: string; parentMessageId: string }
  | { type: 'branch_switched'; messageId: string; branchId: string }
  | { type: 'file_changed'; path: string }
  | { type: 'session_pinned'; sessionId: string; pinned: boolean }
  | { type: 'session_renamed'; sessionId: string; name: string }
  | { type: 'prompt_done' }
  | { type: 'error'; message: string; code?: string }
  | { type: 'done' }
  // chrome v1 新增
  | { type: 'queue_update'; steer: QueueItem[]; followUp: QueueItem[] }
  | { type: 'thinking_level_changed'; level: ThinkingLevel }
  | { type: 'model_changed'; provider: string; modelId: string }

// ============================================================================
// Running SSE(全局,侧栏用 /api/agent/running/events)
// ============================================================================

export interface RunningFrame {
  type: 'running'
  runningSessionIds: string[]
}

export type RunningStateMap = ReadonlyMap<string, boolean>

// ============================================================================
// 文件浏览器(/api/agent/[id]/files 配套)
// ============================================================================

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
  size?: number
  modifiedAt?: string
}

/**
 * Session working directory info. Resolved from apps/web endpoint
 * GET /api/agent/[id]/files (cwd comes from wrapper.cwd or
 * SessionManager.listAll). `available: false` sessions have no cwd —
 * FileExplorer should render a "not browsable" hint rather than list
 * files.
 */
export interface CwdInfo {
  /** Absolute path to the session's working directory. '' = unknown / not browsable. */
  cwd: string
  /** True when cwd came from a live runtime wrapper (vs. persisted metadata). */
  fromRuntime: boolean
}

// ============================================================================
// Tab
// ============================================================================

export interface WorkbenchTab {
  id: string
  sessionId: string
  title: string
  /** 该 tab 是否就是当前 active tab */
  active?: boolean
  /** 该 tab 的 session 是否正在生成(running 状态) */
  running?: boolean
}

// ============================================================================
// 配置面板
// ============================================================================

export interface ModelConfig {
  id: string
  name: string
  provider: string
  enabled: boolean
  /** 当前是否选中 */
  selected?: boolean
  /** 模型上下文长度 */
  contextWindow?: number
}

export interface SkillConfig {
  id: string
  name: string
  description?: string
  enabled: boolean
  /** 文件路径或注册名 */
  source?: string
}

export interface PluginConfig {
  id: string
  name: string
  version?: string
  enabled: boolean
  /** 权限 / 配置描述 */
  description?: string
}

export type ConfigPanelKey = 'none' | 'files' | 'models' | 'skills' | 'plugins'

// ============================================================================
// chrome v1(v1.6 新增):streaming 队列 / thinking 档 / tool preset / slash 命令
// ============================================================================

/**
 * Streaming-time queue 中的单条消息。
 * - kind='steer':当前轮内插入,会抢断当前 assistant
 * - kind='followUp':当前轮结束后追加
 */
export interface QueueItem {
  id: string
  kind: 'steer' | 'followUp'
  text: string
  createdAt: string
}

/** Thinking 档位枚举(对齐 apps/web/lib/types 提供的 8 档)。 */
export type ThinkingLevel =
  | 'auto'
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

/** Tool preset(对齐 apps/web/lib/tool-presets.ts ToolPreset —— 用 "none" 而非 "off") */
export type ToolPreset = 'none' | 'default' | 'full'

/**
 * 单条 tool 注册项(对齐 apps/web/lib/tool-presets.ts ToolEntry)。
 * 浅拷贝避免跨应用类型依赖,apps/dashboard 自包含。
 *
 * chrome v1 修订:description / active 在 React 参考实现里都是 required;
 * Vue 端保留兼容(可选),现有 /api/agent get_tools 响应里可能没有
 * description / active,我们也允许省略。
 */
export interface ToolEntry {
  name: string
  description?: string
  /** 是否在当前 preset 中启用 */
  active?: boolean
}

/**
 * 单条 slash 命令(对齐 apps/web/hooks/useAgentSession.ts SlashCommandInfo)。
 *
 * source:
 *   - "extension": 来自 extension 注册
 *   - "prompt":    prompt template
 *   - "skill":     skill:xxx 形式
 *   - "builtin":   Vue 端内置(/compact /branch /model /fork),由 T5 添加
 */
export interface SlashCommandInfo {
  name: string
  description?: string
  source: 'extension' | 'prompt' | 'skill' | 'builtin'
  sourceInfo?: {
    path: string
    source: string
    scope: 'user' | 'project' | 'temporary'
    origin: 'package' | 'top-level'
    baseDir?: string
  }
}

/**
 * Slash palette 单项(对齐 B8 spec:slash 命令面板):
 * - name: 命令主名(如 "/compact")
 * - aliases: 别名数组(中文 / 简短别名,如 "/压缩")
 * - description: 单行描述
 * - source: 同 SlashCommandInfo.source 的子集(palette 仅展示内置 / 扩展 / prompt / skill)
 */
export interface SlashCommandPaletteItem {
  name: string
  aliases: string[]
  description: string
  source: 'builtin' | 'extension' | 'prompt' | 'skill'
}

/**
 * get_commands 响应(由 apps/web/lib/rpc-manager.ts `case 'get_commands'` 实测
 * 确认):服务端返回 `{ commands?: SlashCommandInfo[] }`,commands 是可选数组
 * (apps/web/hooks/useAgentSession.ts:139 把它定义为可选)。
 */
export interface SlashCommandsResponse {
  commands?: SlashCommandInfo[]
}

// ============================================================================
// 安全工具
// ============================================================================

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** 仅放行 http/https/mailto 协议 */
export function safeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url, window.location.href)
    if (SAFE_URL_PROTOCOLS.has(parsed.protocol)) return parsed.toString()
  } catch {
    /* not a valid URL */
  }
  return undefined
}

/** 文件路径防穿越:禁止 ../ 与绝对路径(除非 rootPath 前缀) */
export function safeFilePath(p: string, rootPath?: string): string | undefined {
  if (!p || p.includes('..')) return undefined
  if (rootPath) {
    if (!p.startsWith(rootPath)) return undefined
    return p
  }
  // 无 rootPath 时禁止绝对路径
  if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) return undefined
  return p
}