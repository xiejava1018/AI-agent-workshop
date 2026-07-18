/**
 * useAgentSession —— useEventStream 的薄包装,加消息合并 / 状态机。
 *
 * 主要差异:
 *   - messages 按 messageId 索引(同 messageId 的 delta 自动合并 content)
 *   - 暴露稳定 messageId 派发(useAgentSession 由调用方控制 merge 规则)
 *   - 与 useEventStream 同形 API,Vue 端组件可以无差别切换
 *
 * 这里为了符合"消息按 messageId 索引"的契约,我们用一个 Map<id, message> 维护,
 * 暴露的 messages 仍是数组(由 Map 派生),保证 :key 列表渲染稳定。
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useEventStream } from './useEventStream'
import type { AgentMessage, StreamStatus } from '../types'

export interface UseAgentSessionReturn {
  messages: ComputedRef<readonly AgentMessage[]>
  isStreaming: ComputedRef<boolean>
  streamStatus: Ref<StreamStatus>
  error: Ref<string | null>
  sendMessage: (text: string, attachments?: File[]) => Promise<void>
  abort: () => void
  clearError: () => void
  /** 切换 session 时由调用方主动调 — 清空本地消息缓存 */
  resetSession: () => void
}

/**
 * @param sessionId 当前 session id(可以是 Ref<string> 或固定字符串)
 * @param userId sendMessage 时的 body 字段
 * @param messageIdResolver 可选:从 SDK 事件里提取 messageId。某些后端
 *   会在 message_start / message_delta 上附一个稳定的 messageId 字段,
 *   没附时退化为"每条 delta 都合并到最后一条 assistant 消息上"。
 */
export function useAgentSession(
  sessionId: Ref<string> | string,
  userId: string,
  messageIdResolver?: (raw: Record<string, unknown>) => string | null
): UseAgentSessionReturn {
  // 由 useEventStream 维护的"原始"消息流(已经按事件顺序累积)
  const {
    messages: rawMessages,
    isStreaming,
    streamStatus,
    error,
    sendMessage: rawSend,
    abort: rawAbort,
    clearError,
    resetMessages: rawReset
  } = useEventStream(sessionId, userId)

  // —— 合并层:把同 messageId 的相邻 delta 合并成单条消息 ——
  // 实现思路:维护一个 Map<stableId, AgentMessage>,每次 rawMessages 变化时
  // 重新合并导出 messages。
  //
  // 但当前 useEventStream 已经把同一 assistant 流合并到最后一条上了,
  // 这里主要职责是把"按事件序累积的简单列表"再做一次按 messageId 的稳定
  // 派生(messageIdResolver 没给时 → 与 rawMessages 等价)。
  const messageById = ref<Map<string, AgentMessage>>(new Map())

  function rebuildIndex(): void {
    const next = new Map<string, AgentMessage>()
    for (const msg of rawMessages.value) {
      // 优先使用 messageIdResolver(若 raw 上有 messageId 字段)
      const stableId =
        (messageIdResolver ? messageIdResolver(msg as unknown as Record<string, unknown>) : null) ??
        msg.id
      // 同 id 后续覆盖前序(append content)
      const existing = next.get(stableId)
      if (existing) {
        next.set(stableId, { ...existing, content: existing.content + msg.content })
      } else {
        next.set(stableId, msg)
      }
    }
    messageById.value = next
  }

  // 监听 raw 变化时重算
  watch(rawMessages, rebuildIndex, { immediate: true, deep: true })

  const messages = computed<readonly AgentMessage[]>(() => {
    // 用 rawMessages 的顺序(append 顺序)而不是 Map 迭代序,保证 UI 渲染稳定
    const seen = new Set<string>()
    const out: AgentMessage[] = []
    for (const msg of rawMessages.value) {
      const stableId =
        (messageIdResolver ? messageIdResolver(msg as unknown as Record<string, unknown>) : null) ??
        msg.id
      if (seen.has(stableId)) continue
      seen.add(stableId)
      out.push(messageById.value.get(stableId) ?? msg)
    }
    return out
  })

  async function sendMessage(text: string, attachments?: File[]): Promise<void> {
    await rawSend(text, attachments)
  }

  function abort(): void {
    rawAbort()
  }

  function resetSession(): void {
    rawReset()
    messageById.value = new Map()
  }

  // sessionId 变化时重置合并层
  watch(
    () => (typeof sessionId === 'string' ? sessionId : sessionId.value),
    () => {
      resetSession()
    }
  )

  return {
    messages,
    isStreaming,
    streamStatus,
    error,
    sendMessage,
    abort,
    clearError,
    resetSession
  }
}
