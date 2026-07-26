/**
 * useUnreadSessions —— 跟踪侧栏的未读会话标记,持久化到 localStorage。
 *
 * 对齐 apps/web SessionSidebar.tsx 的 loadUnreadSessionIds / saveUnreadSessionIds:
 *   - 用户切到某个会话时,该会话的未读标记被清除
 *   - 新进入(后端推送)的会话/会话有活动时,SSE 或外部组件可 mark(id)
 *   - 刷新后未读标记保留(localStorage 持久化)
 *   - 删除会话时(从 sessions 中消失)清掉对应的 id(避免幽灵)
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { AgentSession } from '@/api/agent'

const STORAGE_KEY = 'wb:unread-session-ids'

function loadUnread(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((s): s is string => typeof s === 'string'))
  } catch {
    return new Set()
  }
}

function persistUnread(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    /* 隐私模式 / quota 静默 */
  }
}

export interface UseUnreadSessionsResult {
  /** 未读会话 id Set */
  unreadIds: ComputedRef<ReadonlySet<string>>
  /** 标记会话为未读 */
  mark: (sessionId: string) => void
  /** 清除会话的未读标记(切到该会话时调用) */
  clear: (sessionId: string) => void
  /** 是否未读 */
  isUnread: (sessionId: string) => boolean
  /** 清理已删除的会话(传入当前活跃列表,过滤掉不在的 id) */
  pruneTo: (sessions: ReadonlyArray<Pick<AgentSession, 'id'>>) => void
}

export function useUnreadSessions(): UseUnreadSessionsResult {
  const ids = ref<Set<string>>(loadUnread())

  // 持久化(任何变化都写)
  watch(
    ids,
    (next) => persistUnread(next),
    { deep: true }
  )

  function mark(id: string): void {
    if (ids.value.has(id)) return
    const next = new Set(ids.value)
    next.add(id)
    ids.value = next
  }

  function clear(id: string): void {
    if (!ids.value.has(id)) return
    const next = new Set(ids.value)
    next.delete(id)
    ids.value = next
  }

  function isUnread(id: string): boolean {
    return ids.value.has(id)
  }

  function pruneTo(sessions: ReadonlyArray<Pick<AgentSession, 'id'>>): void {
    const live = new Set(sessions.map((s) => s.id))
    let changed = false
    const next = new Set(ids.value)
    for (const id of Array.from(next)) {
      if (!live.has(id)) {
        next.delete(id)
        changed = true
      }
    }
    if (changed) ids.value = next
  }

  return {
    unreadIds: computed(() => ids.value),
    mark,
    clear,
    isUnread,
    pruneTo
  }
}