/**
 * Agent 工作台 SSE 流式事件 Composable
 *
 * 后端 /api/agent/[id]/events 透传的是 pi SDK 真实事件流:
 *   agent_start / agent_end
 *   turn_start  / turn_end { message, toolResults }
 *   message_start / message_update { message, assistantMessageEvent }
 *                / message_end
 *   tool_execution_start / tool_execution_update / tool_execution_end
 *
 * 前端 watch 期望的形状:
 *   { type: 'message_start', content: '' }      // 开新 assistant 消息(占位)
 *   { type: 'message_delta', content: string }   // 文本增量,append 到当前消息
 *   { type: 'message_end' }                      // 当前消息结束
 *   { type: 'tool_update', toolName?, toolInput? }
 *   { type: 'prompt_done' }
 *   { type: 'error', content }
 *
 * 关键设计:streaming 时 SDK 一段回复会产生 N 个 `message_update.text_delta`,
 * 不能每个 delta 都 emit 为独立 'message' 类型(那样会把一段回复切成 N 个气泡)。
 * 改成 'message_delta' 让前端累积到同一条消息上。
 */
import { ref, onUnmounted, type Ref } from 'vue'

export interface AgentEvent {
  type: 'message_start' | 'message_delta' | 'message_end' | 'tool_update' | 'prompt_done' | 'error'
  content?: string
  toolName?: string
  toolInput?: unknown
}

/** SDK 事件 → 前端事件 形状兼容层 */
interface SdkAssistantMessageEvent {
  type: 'start' | 'text_start' | 'text_delta' | 'text_end' | 'thinking_start' | 'thinking_delta' | 'thinking_end' | 'toolcall_start' | 'toolcall_delta' | 'toolcall_end' | 'done' | 'error'
  delta?: string
  error?: string
  // 其余字段对 UI 渲染无用,直接透传到 partial 即可
  [key: string]: unknown
}

interface SdkAgentEvent {
  type: string
  message?: { role?: string; content?: unknown; errorMessage?: string }
  assistantMessageEvent?: SdkAssistantMessageEvent
  toolCallId?: string
  toolName?: string
  args?: unknown
  result?: unknown
  isError?: boolean
  toolResults?: Array<{ isError?: boolean; content?: unknown }>
  [key: string]: unknown
}

/** 把任意 SDK content 数组展平成可读文本(text/image 块) */
function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: { type?: string; text?: string; delta?: string; thinking?: string }) => {
      if (typeof block?.text === 'string') return block.text
      if (typeof block?.delta === 'string') return block.delta
      if (typeof block?.thinking === 'string') return block.thinking
      return ''
    })
    .join('')
}

/** SDK 事件 → 前端窄事件。返回 null 表示对 UI 无意义,丢弃 */
function normalizeSdkEvent(raw: unknown): AgentEvent | null {
  const e = raw as SdkAgentEvent
  switch (e?.type) {
    case 'message_start': {
      // 整条 assistant/user 消息开始。emit 占位事件让前端 push 一条空消息,
      // 后续 message_delta 在这条消息上 append。
      // 区分 assistant vs user:SDK emit 的 message 没有 role 字段在顶层,
      // 但 SDK 推 message 时通常 message.role 描述。但 wrapper 透传原始事件,
      // 这里用 message.role 推断。
      const role = (e.message as { role?: string } | undefined)?.role
      // 只对 assistant 开新消息占位;user 消息由前端 handleSend 自己 push,不走 SSE
      if (role !== 'assistant') return null
      return { type: 'message_start', content: '' }
    }
    case 'message_update': {
      const inner = e.assistantMessageEvent
      if (!inner) return null
      // 只关心文本增量;其余(text_start/thinking_*/toolcall_*)不在 watch 范围内
      if (inner.type === 'text_delta' && typeof inner.delta === 'string') {
        // 关键:emit 'message_delta' 而不是 'message',让前端累积到同一条消息
        return { type: 'message_delta', content: inner.delta }
      }
      return null
    }
    case 'message_end': {
      // 整条 message 结束,emit 收尾事件让前端可以清理 streaming 状态
      return { type: 'message_end' }
    }
    case 'turn_end': {
      const toolErr = (e.toolResults ?? []).some((t) => t?.isError)
      if (toolErr) {
        return { type: 'error', content: 'Tool execution failed' }
      }
      return { type: 'prompt_done' }
    }
    case 'tool_execution_start': {
      return { type: 'tool_update', toolName: e.toolName, toolInput: e.args }
    }
    case 'tool_execution_end': {
      return {
        type: 'tool_update',
        toolName: e.toolName,
        toolInput: { result: e.result, isError: e.isError }
      }
    }
    case 'agent_end': {
      // agent 走完一轮,若最后一条 assistant message 带 errorMessage,上报为 error
      const lastMsg = Array.isArray(e.messages) ? e.messages[e.messages.length - 1] : undefined
      const errMsg =
        (lastMsg as { errorMessage?: string } | undefined)?.errorMessage ??
        (lastMsg as { stopReason?: string; errorMessage?: string } | undefined)?.errorMessage
      // 静默情况:无错误 → 不发任何东西,下游 message_update 已经把文本增量喂完了
      if (errMsg) {
        return { type: 'error', content: errMsg }
      }
      return null
    }
    default:
      return null
  }
}

/**
 * 接 sessionId(可以是固定字符串或 Ref<string>),变化时自动重连 SSE。
 * sessionId 为空时(路由无 :id 动态段),不连,等调用方设置后再连。
 */
export function useAgentEvents(sessionId: Ref<string> | string) {
  const events = ref<AgentEvent[]>([])
  const isConnected = ref(false)
  let eventSource: EventSource | null = null

  function getId(): string {
    return typeof sessionId === 'string' ? sessionId : sessionId.value
  }

  function disconnect() {
    eventSource?.close()
    eventSource = null
    isConnected.value = false
  }

  function connect() {
    disconnect()
    const targetId = getId() && getId().trim() ? getId() : null
    if (!targetId) return
    const url = `/api/agent/${targetId}/events`
    eventSource = new EventSource(url)

    eventSource.onopen = () => {
      isConnected.value = true
    }
    eventSource.onerror = () => {
      isConnected.value = false
    }
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as unknown
        // 后端第一帧是 { type: 'connected', sessionId },不是 SDK 事件,跳过
        if ((data as { type?: string })?.type === 'connected') return
        const normalized = normalizeSdkEvent(data)
        if (normalized) events.value.push(normalized)
      } catch {
        /* ignore parse errors */
      }
    }
  }

  onUnmounted(disconnect)

  return { events, isConnected, connect, disconnect }
}

// 暴露给可能想自己 normalize 的调用方,避免重复实现
export { normalizeSdkEvent, flattenContent }