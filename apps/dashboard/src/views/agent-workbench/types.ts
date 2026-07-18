/**
 * Agent 工作台共享类型
 *
 * 来源:`apps/web/lib/types.ts` + `apps/web/lib/pi-types.ts` 的精简子集。
 * 我们只声明 Vue 端组件真正用到的字段,避免被 web 端完整类型污染
 * (web 端含 thinking/toolcall block 等一整套 AssistantContentBlock 体系,
 * Vue 端先用简化形状,后续可视实际需求再细化)。
 *
 * 设计原则:
 * - 不可变优先(Readonly + 显式更新函数返回新对象)
 * - 不与现有 chat.ts Pinia store 混(那是 Art Bot 路径)
 */

export type AgentRole = 'user' | 'assistant' | 'system' | 'tool'

/** 主类型 — 一条消息 */
export interface AgentMessage {
  /** 唯一 id;同一 id 的多个 delta 会被 useAgentSession 合并到一条消息上 */
  readonly id: string
  readonly role: AgentRole
  /** 内容文本,markdown 渲染 */
  readonly content: string
  /** 工具调用列表(role === 'tool' / 'assistant' 时) */
  readonly toolCalls?: readonly ToolCall[]
  /** 分支 id(用于 BranchNavigator 切换) */
  readonly branchId?: string
  /** 父消息 id(用于分支树构建) */
  readonly parentMessageId?: string
  /** 创建时间(ISO 字符串) */
  readonly createdAt: string
  /** 流式结束标记 — 中断/超时导致内容不完整时为 true */
  readonly partial?: boolean
  /** 用户主动取消时为 true(配合 partial UI 显示「重试」按钮) */
  readonly cancelled?: boolean
  /** 流状态机:当前消息当前所处的流状态 */
  readonly streamStatus?: StreamStatus
}

/** 流状态机状态 */
export type StreamStatus = 'idle' | 'streaming' | 'done' | 'error' | 'cancelled'

/** 工具调用 */
export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly status: 'pending' | 'running' | 'done' | 'error'
  readonly args?: unknown
  readonly result?: unknown
}

/** 分支(单条消息上的可选多版本) */
export interface Branch {
  readonly id: string
  readonly parentMessageId: string
  readonly createdAt: string
  /** 分支标题(可选,展示在 BranchNavigator) */
  readonly title?: string
}

/** 会话 */
export interface AgentSession {
  readonly id: string
  readonly title: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly userId?: string
  readonly teamId?: string | null
  readonly available?: boolean
  readonly pinned?: boolean
}

/** SSE 事件白名单 —— 见 design 文档 §"SSE 事件流" */
/** 允许的事件 type(其它事件 console.warn 并丢弃) */
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

/** 流超时时间(毫秒):SSE 长时间无任何事件时自动标记 partial */
export const STREAM_TIMEOUT_MS = 90_000
