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
  'done'
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
  cwd: string
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