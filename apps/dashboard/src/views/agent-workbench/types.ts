/**
 * Agent 工作台共享类型
 *
 * 这是 apps/web Agent 界面在 Vue 端的类型镜像,所有 Track 必须从这里 import。
 * 修改前请先确认 3 个 Track 都不依赖即将删除的字段。
 *
 * 修订记录:
 * - v1.0: 初版(基于 docs/plans/2026-07-18-...-design.md §3)
 * - v1.1: 与 apps/dashboard/src/api/agent.ts 中 AgentSession 对齐(pinned/available 字段已存在)
 * - v1.2: + SSE 事件白名单类型、+ RunningStateMap 类型(running/events 用)
 */

import type { AgentSession } from '@/api/agent'

// ============================================================================
// 会话侧栏
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
}

export interface Branch {
  id: string
  parentMessageId: string
  createdAt: string
}

// ============================================================================
// 文件浏览器
// ============================================================================

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
  size?: number
  modifiedAt?: string
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
// 流状态
// ============================================================================

export type StreamStatus = 'idle' | 'streaming' | 'error' | 'cancelled'

// ============================================================================
// SSE 事件窄白名单(参考 memory pi-sdk-event-narrow-whitelist-pitfall)
// 不在白名单的事件 console.warn 后丢弃,绝不放进 ref 防泛洪
// ============================================================================

export const ALLOWED_SSE_EVENTS = new Set<string>([
  // 消息流
  'message.start',
  'message.delta',
  'message.complete',
  // 工具调用
  'tool.start',
  'tool.delta',
  'tool.complete',
  'tool.error',
  // 分支
  'branch.created',
  'branch.switched',
  // 文件 / 工作区
  'file.changed',
  // 会话元数据
  'session.pinned',
  'session.renamed',
  // 流控制
  'error',
  'done',
  // 心跳(忽略,仅用于 keep-alive)
  'ping',
  'heartbeat'
])

/** 经过窄白名单过滤后的 SSE 事件 payload */
export type SSEEventPayload =
  | { type: 'message.start'; messageId: string; role: AgentRole }
  | { type: 'message.delta'; messageId: string; delta: string }
  | { type: 'message.complete'; messageId: string; content: string }
  | { type: 'tool.start'; toolCallId: string; messageId: string; name: string; args?: unknown }
  | { type: 'tool.delta'; toolCallId: string; delta: string }
  | { type: 'tool.complete'; toolCallId: string; result: unknown }
  | { type: 'tool.error'; toolCallId: string; error: string }
  | { type: 'branch.created'; branchId: string; parentMessageId: string }
  | { type: 'branch.switched'; messageId: string; branchId: string }
  | { type: 'file.changed'; path: string }
  | { type: 'session.pinned'; sessionId: string; pinned: boolean }
  | { type: 'session.renamed'; sessionId: string; name: string }
  | { type: 'error'; message: string; code?: string }
  | { type: 'done' }
  | { type: 'ping' }
  | { type: 'heartbeat' }

// ============================================================================
// Running SSE(全局,侧栏用)
// ============================================================================

/** /api/agent/running/events 单帧数据 */
export interface RunningFrame {
  type: 'running'
  runningSessionIds: string[]
}

/** 侧栏维护的 running map(避免每次重新 filter) */
export type RunningStateMap = ReadonlyMap<string, boolean>

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

// ============================================================================
// 抽屉面板类型(index.vue 用)
// ============================================================================

export type ConfigPanelKey = 'none' | 'files' | 'models' | 'skills' | 'plugins'

// ============================================================================
// 安全工具:URL / 文件路径白名单
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