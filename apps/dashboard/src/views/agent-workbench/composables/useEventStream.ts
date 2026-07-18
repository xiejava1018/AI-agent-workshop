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

      const type = typeof raw.type === 'string' ? raw.type : ''
      // 四:窄白名单过滤
      if (!ALLOWED_SSE_EVENTS.includes(type as (typeof ALLOWED_SSE_EVENTS)[number])) {
        console.warn(`[useEventStream] 未授权事件: ${type},丢弃`)
        return
      }

      handleEvent(type, raw)
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
    resetMessages
  }
}
