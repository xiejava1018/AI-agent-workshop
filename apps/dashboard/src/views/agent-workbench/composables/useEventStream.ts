/**
 * useEventStream — 单一 session 的 SSE 流订阅 composable。
 *
 * 关键设计(完整复刻 apps/web 已验证的三层防护 — 参考 memory
 * `events-sse-refcount-cap-closure` 和 `pi-sdk-event-narrow-whitelist-pitfall`):
 *
 *   1. released WeakSet(refcount 幂等门)
 *      - 卸载 / 重连时把当前 EventSource 实例推进 released.value
 *      - onmessage 看到该实例上再来的事件 → 丢弃
 *      - 解决"浏览器对已关闭的 EventSource 仍可能投递 1~2 个尾巴事件"的竞态
 *
 *   2. capturedWrapper 闭包捕获
 *      - 每次 connect() 都把当前 EventSource 句柄闭包到一个 fresh 局部变量
 *      - 后续 cleanup 只能关自己捕获的那一份,不会误关重连后的新实例
 *
 *   3. cap WeakSet(去重)
 *      - 同一个 MessageEvent 已经在 cap 里就跳过,避免重连路径下旧事件
 *        跨生命周期重复处理导致消息重复 push
 *
 *   4. 窄白名单(ALLOWED_SSE_EVENTS)
 *      - pi SDK 事件种类很多(thinking_delta / toolcall_* / extension_ui_* / …),
 *        大部分对 UI 无意义,放进 ref 会触发无谓的 watch + render。
 *      - 不在白名单的 → console.warn 并丢弃。
 *
 *   5. abort()
 *      - es.close() + 把当前 streaming 消息标记 cancelled / streamStatus='cancelled'
 *      - 用户在 ChatInput 点「停止」时调用
 *
 *   6. 流超时
 *      - 90s 内没有任何事件 → 自动标记 partial + 报错信息
 *
 *   7. watch(sessionId) 重建连接
 *
 *   8. onUnmounted 清理(幂等门)
 *
 * 不在白名单的事件直接 console.warn + 丢弃,不做泛洪累加。
 */

import { computed, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import { sendMessage } from '@/api/agent'
import {
  ALLOWED_SSE_EVENTS,
  STREAM_TIMEOUT_MS,
  type AgentMessage,
  type StreamStatus
} from '../types'

/** 内部窄事件:useEventStream 透传的所有事件 type */
export interface StreamEvent {
  readonly type: string
  readonly data: unknown
}

/**
 * 把 pi SDK 真实事件归一化为工作台内部事件。
 *
 * 关键修复:活跃的 AppShell → ChatWindow 路径在白名单判断前需要先把
 * SDK 事件(例如 `message_update.assistantMessageEvent.text_delta` 和
 * `prompt_error`)转为内部 `message_delta` / `error`,否则:
 *   - 助手文本永远不进 messages,UI 只能看到空 assistant 容器
 *   - prompt 失败原因被白名单丢弃,UI 永远停留在"已取消重试"
 *   - 用户角色 `message_start` 也会被无差别建出 assistant 占位
 *
 * 返回 null 表示该事件对 UI 无意义,直接丢弃;返回的 payload 已对齐
 * 内部事件形状,可继续走白名单 + handleEvent 状态机。
 */
export function normalizeAgentWorkbenchEvent(
  raw: Record<string, unknown>
): Record<string, unknown> | null {
  const type = typeof raw.type === 'string' ? raw.type : ''

  if (type === 'message_start') {
    const role = (raw.message as { role?: unknown } | undefined)?.role
    if (role !== 'assistant') return null
    return { type: 'message_start', content: '' }
  }

  if (type === 'message_update') {
    const inner = raw.assistantMessageEvent as { type?: unknown; delta?: unknown } | undefined
    if (inner && inner.type === 'text_delta' && typeof inner.delta === 'string') {
      return { type: 'message_delta', content: inner.delta }
    }
    return null
  }

  if (type === 'message_end') {
    return { type: 'message_end' }
  }

  if (type === 'prompt_error') {
    const message =
      typeof raw.errorMessage === 'string' && raw.errorMessage ? raw.errorMessage : '未知错误'
    return { type: 'error', content: message }
  }

  if (type === 'tool_execution_start') {
    return {
      type: 'tool_update',
      toolName: raw.toolName,
      toolInput: raw.args
    }
  }

  if (type === 'tool_execution_end') {
    return {
      type: 'tool_update',
      toolName: raw.toolName,
      toolInput: { result: raw.result, isError: raw.isError }
    }
  }

  if (type === 'turn_end') {
    const toolErr = Array.isArray(raw.toolResults)
      ? (raw.toolResults as Array<{ isError?: unknown }>).some((t) => t?.isError === true)
      : false
    if (toolErr) return { type: 'error', content: 'Tool execution failed' }
    return { type: 'prompt_done' }
  }

  if (type === 'agent_start' || type === 'agent_end') {
    return null
  }

  if (!type) return null

  return { type, ...raw }
}

/** sendMessage 返回的 user 消息(sendMessage 调起后由调用方决定是否入栈,默认不入栈) */
export interface SentUserMessage {
  readonly id: string
  readonly content: string
}

export interface UseEventStreamReturn {
  messages: Ref<readonly AgentMessage[]>
  isStreaming: ComputedRef<boolean>
  streamStatus: Ref<StreamStatus>
  error: Ref<string | null>
  sendMessage: (text: string, attachments?: File[]) => Promise<void>
  abort: () => void
  clearError: () => void
  resetMessages: () => void
  /**
   * Bug 2 修复:把历史消息前置到 messages 头部。
   * 切 tab 时由 useAgentSession.fetchHistory 调用,按 messageId 去重避免
   * 重复(SSE 实时流的最新 messageId 优先保留)。
   */
  prependMessages: (history: readonly AgentMessage[]) => void
}

/**
 * 订阅 `/api/agent/[sessionId]/events` 的 EventSource。
 * sessionId 变化时自动重连,组件卸载时关闭。
 *
 * @param sessionId 当前 session id(可以是 Ref<string> 或固定字符串)
 * @param userId 用于 sendMessage 时的 body 字段(从 localStorage 取)
 */
export function useEventStream(
  sessionId: Ref<string> | string,
  userId: string
): UseEventStreamReturn {
  // 列表:UI 渲染用。同 messageId 的 delta 在 useAgentSession 层合并,这里
  // 只负责把 SDK 事件转成离散消息单元。
  const messages = ref<AgentMessage[]>([]) as Ref<AgentMessage[]>
  const streamStatus = ref<StreamStatus>('idle')
  const error = ref<string | null>(null)

  // 三层防护 #1:released 幂等门。值是 WeakSet<EventSource>。
  // 组件 onUnmounted 时整个 WeakSet 重建为 new WeakSet() 一次性作废,旧的
  // 不再被任何路径持有,自然 GC。
  const released = ref<WeakSet<EventSource>>(new WeakSet())
  // 三层防护 #3:cap 去重(WeakSet<MessageEvent>)。
  // 一个 MessageEvent 只允许被处理一次,跨重连也不重复。
  const cap = new WeakSet<MessageEvent>()

  // capturedWrapper 闭包:每次 connect 时把最新 EventSource 引用关到自己的
  // 局部变量里,cleanup 只关自己捕获的那一份。
  let activeEs: EventSource | null = null

  // 流超时计时器:每次 onmessage 都重置;90s 无事件 → 标记 partial
  let streamTimer: ReturnType<typeof setTimeout> | null = null

  function clearStreamTimer(): void {
    if (streamTimer) {
      clearTimeout(streamTimer)
      streamTimer = null
    }
  }

  function armStreamTimer(): void {
    clearStreamTimer()
    streamTimer = setTimeout(() => {
      // 流超时:把当前 streaming 消息标记 partial
      const last = messages.value[messages.value.length - 1]
      if (last && last.role === 'assistant' && last.streamStatus === 'streaming') {
        messages.value = [
          ...messages.value.slice(0, -1),
          { ...last, partial: true, streamStatus: 'error' as StreamStatus }
        ]
      }
      streamStatus.value = 'error'
      error.value = '流超时:已超过 90 秒未收到事件'
    }, STREAM_TIMEOUT_MS)
  }

  function getId(): string {
    return typeof sessionId === 'string' ? sessionId : sessionId.value
  }

  function disconnect(): void {
    if (activeEs) {
      // 幂等门 #1:关闭前把当前 ES 实例塞进 released
      released.value.add(activeEs)
      try {
        activeEs.close()
      } catch {
        /* ignore */
      }
      activeEs = null
    }
    clearStreamTimer()
    streamStatus.value = 'idle'
  }

  function connect(): void {
    disconnect()
    const targetId = getId()
    if (!targetId || !targetId.trim()) return

    const es = new EventSource(`/api/agent/${encodeURIComponent(targetId)}/events`)
    activeEs = es // capturedWrapper 闭包捕获

    es.onopen = () => {
      armStreamTimer()
    }

    es.onerror = () => {
      // 幂等门:disconnect() 已主动 close 当前 ES,close() 后浏览器可能
      // 仍触发一次 onerror(readyState=CLOSED)。这时不应报"连接已关闭"
      // —— 这是我们主动行为,不是错误。
      if (released.value.has(es)) return
      // 浏览器会自动重连,这里只清超时计时器(由 onmessage 重新 arm)
      // readyState === CLOSED → 服务器 4xx/5xx 或路由不存在 → 不重连
      if (es.readyState === EventSource.CLOSED) {
        streamStatus.value = 'error'
        error.value = 'SSE 连接已关闭'
        clearStreamTimer()
      }
    }

    es.onmessage = (e: MessageEvent) => {
      // 三层防护 #1:released 幂等门
      if (released.value.has(es)) return
      // 三层防护 #3:cap 去重
      if (cap.has(e)) return
      cap.add(e)

      // 重置超时计时器
      armStreamTimer()

      let raw: { type?: unknown } & Record<string, unknown> = {}
      try {
        raw = JSON.parse(e.data) as { type?: unknown } & Record<string, unknown>
      } catch {
        // 非 JSON 帧,丢
        console.warn('[useEventStream] 非 JSON SSE 帧,丢弃')
        return
      }

      // 先把 pi SDK 真实事件归一化为内部事件,然后再走白名单,
      // 避免 SDK 事件类型(message_update / prompt_error / tool_execution_* …)
      // 被窄白名单整体丢弃。
      const normalized = normalizeAgentWorkbenchEvent(raw)
      if (!normalized) return
      const type: string = typeof normalized.type === 'string' ? normalized.type : ''
      if (!type || !ALLOWED_SSE_EVENTS.includes(type as (typeof ALLOWED_SSE_EVENTS)[number])) {
        console.warn(`[useEventStream] 未授权事件: ${type || '<empty>'},丢弃`)
        return
      }

      handleEvent(type, normalized)
    }
  }

  /**
   * 单一事件分发:
   *   message_start / message_delta / message_end → 累积到当前 assistant 消息
   *   tool_update → 推一条 tool 消息
   *   prompt_done → 收尾(标记 done)
   *   error → 报错
   *   其它白名单事件 → 暂不映射到 messages(留给 useAgentSession 决定)
   */
  function handleEvent(type: string, raw: Record<string, unknown>): void {
    switch (type) {
      case 'connected':
        return
      case 'message_start': {
        // 开新 assistant 占位
        messages.value = [
          ...messages.value,
          {
            id: `asst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            streamStatus: 'streaming'
          }
        ]
        streamStatus.value = 'streaming'
        return
      }
      case 'message_delta': {
        const delta = typeof raw.content === 'string' ? raw.content : ''
        const last = messages.value[messages.value.length - 1]
        if (last && last.role === 'assistant') {
          messages.value = [
            ...messages.value.slice(0, -1),
            { ...last, content: last.content + delta }
          ]
        } else {
          // 兜底:没占位直接 push
          messages.value = [
            ...messages.value,
            {
              id: `asst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'assistant',
              content: delta,
              createdAt: new Date().toISOString(),
              streamStatus: 'streaming'
            }
          ]
        }
        streamStatus.value = 'streaming'
        return
      }
      case 'message_end': {
        const last = messages.value[messages.value.length - 1]
        if (last && last.role === 'assistant') {
          messages.value = [
            ...messages.value.slice(0, -1),
            { ...last, streamStatus: 'done' as StreamStatus }
          ]
        }
        return
      }
      case 'tool_update': {
        const toolName = typeof raw.toolName === 'string' ? raw.toolName : 'tool'
        messages.value = [
          ...messages.value,
          {
            id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'tool',
            content: `[${toolName}] ${JSON.stringify(raw.toolInput ?? {})}`,
            createdAt: new Date().toISOString(),
            streamStatus: 'done' as StreamStatus
          }
        ]
        return
      }
      case 'prompt_done': {
        streamStatus.value = 'done'
        clearStreamTimer()
        return
      }
      case 'error': {
        const msg = typeof raw.content === 'string' ? raw.content : '未知错误'
        error.value = msg
        streamStatus.value = 'error'
        const last = messages.value[messages.value.length - 1]
        if (last && last.role === 'assistant' && last.streamStatus === 'streaming') {
          messages.value = [
            ...messages.value.slice(0, -1),
            { ...last, partial: true, streamStatus: 'error' as StreamStatus }
          ]
        }
        return
      }
      case 'done': {
        streamStatus.value = 'done'
        clearStreamTimer()
        return
      }
      default:
        // 白名单内但目前未映射的事件(branch_created / file_changed / …)
        // 留空 — useAgentSession 可以基于自己的 ref 派生更多 UI 状态
        return
    }
  }

  async function send(text: string): Promise<void> {
    const targetId = getId()
    if (!targetId || !targetId.trim()) {
      error.value = '当前没有选中会话'
      return
    }
    if (!text.trim()) return

    // 乐观 push user 消息
    const userMsg: AgentMessage = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString()
    }
    messages.value = [...messages.value, userMsg]
    streamStatus.value = 'streaming'

    try {
      await sendMessage(targetId, text, userId)
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : '发送失败'
      error.value = errMsg
      streamStatus.value = 'error'
      // 发送失败时把刚 push 的 user 消息标记为 cancelled 让 UI 可以回退
      messages.value = [
        ...messages.value.slice(0, -1),
        { ...userMsg, cancelled: true, streamStatus: 'cancelled' as StreamStatus }
      ]
    }
  }

  function abort(): void {
    if (activeEs) {
      released.value.add(activeEs)
      try {
        activeEs.close()
      } catch {
        /* ignore */
      }
      activeEs = null
    }
    clearStreamTimer()
    // 把当前 streaming 消息标记 cancelled
    const last = messages.value[messages.value.length - 1]
    if (last && last.role === 'assistant' && last.streamStatus === 'streaming') {
      messages.value = [
        ...messages.value.slice(0, -1),
        { ...last, cancelled: true, streamStatus: 'cancelled' as StreamStatus }
      ]
    }
    streamStatus.value = 'cancelled'
  }

  function clearError(): void {
    error.value = null
  }

  function resetMessages(): void {
    messages.value = []
    streamStatus.value = 'idle'
    error.value = null
    clearStreamTimer()
  }

  /**
   * Bug 2 修复:把历史消息合并到 messages(按 id 去重)。
   * 注意:历史消息应在 resetMessages() 之后调用,避免和上一次会话的消息混在一起。
   * SSE 实时流的最新消息若已 push 进 messages.value(同 id),会跳过历史中重复的。
   */
  function prependMessages(history: readonly AgentMessage[]): void {
    if (!history.length) return
    const seen = new Set(messages.value.map((m) => m.id))
    const prepend: AgentMessage[] = []
    for (const m of history) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      prepend.push(m)
    }
    if (prepend.length) messages.value = [...prepend, ...messages.value]
  }

  // 5. sessionId 变化时重连
  watch(
    () => (typeof sessionId === 'string' ? sessionId : sessionId.value),
    () => {
      resetMessages()
      connect()
    }
  )

  // 首次挂载时连
  connect()

  // 8. onUnmounted 清理(幂等)
  onUnmounted(() => {
    disconnect()
    // 幂等门:作废整个 released WeakSet
    released.value = new WeakSet()
  })

  return {
    messages,
    isStreaming: computed(() => streamStatus.value === 'streaming'),
    streamStatus,
    error,
    sendMessage: send,
    abort,
    clearError,
    resetMessages,
    prependMessages
  }
}
