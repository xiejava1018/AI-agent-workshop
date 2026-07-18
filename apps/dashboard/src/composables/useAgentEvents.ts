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
 * 前端 watch 期望的形状是窄白名单
 *   { type: 'message' | 'tool_update' | 'prompt_done' | 'error', content?, toolName?, toolInput? }
 *
 * 这一层只做一件事:把 SDK 事件归一化到前端 4 类,丢掉对 UI 无意义的事件,
 * 避免下游 watch 把 content=undefined 的空消息塞进 messages 数组(参见 M4
 * 历史 bug:workbench/index.vue 里 `=== 'message' | ...` 优先级错误导致
 * 永远 truthy、空消息无限 push)。
 */
import { ref, onUnmounted, type Ref } from 'vue'

export interface AgentEvent {
  type: 'message' | 'tool_update' | 'prompt_done' | 'error'
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
    case 'message_update': {
      const inner = e.assistantMessageEvent
      if (!inner) return null
      // 只关心文本增量;其余(text_start/thinking_*/toolcall_*)不在 watch 范围内
      if (inner.type === 'text_delta' && typeof inner.delta === 'string') {
        return { type: 'message', content: inner.delta }
      }
      return null
    }
    case 'message_end': {
      // 整条 message 完整,典型是最终 assembled 文本;前端 watch 不需要重复追加,
      // 真正的"已结束"信号交给 message_end 后紧跟的 turn_end 来发 prompt_done
      return null
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