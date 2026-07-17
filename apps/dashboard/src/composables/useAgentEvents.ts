/**
 * Agent 工作台 SSE 流式事件 Composable
 */
import { ref, onUnmounted } from 'vue'

export interface AgentEvent {
  type: 'message' | 'tool_update' | 'prompt_done' | 'error'
  content?: string
  toolName?: string
  toolInput?: unknown
}

export function useAgentEvents(sessionId: string, userId: string) {
  const events = ref<AgentEvent[]>([])
  const isConnected = ref(false)
  let eventSource: EventSource | null = null

  function connect() {
    const url = `/api/agent/${sessionId}/events`
    const fullUrl = `${url}?userId=${userId}`
    eventSource = new EventSource(fullUrl)

    eventSource.onopen = () => {
      isConnected.value = true
    }
    eventSource.onerror = () => {
      isConnected.value = false
    }
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as AgentEvent
        events.value.push(data)
      } catch {
        /* ignore parse errors */
      }
    }
  }

  function disconnect() {
    eventSource?.close()
    eventSource = null
    isConnected.value = false
  }

  onUnmounted(disconnect)

  return { events, isConnected, connect, disconnect }
}
