/**
 * 会话侧栏列表 composable
 *
 * 负责侧栏会话列表的 CRUD + 派生(pinned/unpinned/filtered):
 *   - load(): 拉取列表
 *   - create(): 新建会话
 *   - rename(): 重命名(乐观更新 + 回滚)
 *   - togglePin(): 切换 pin(乐观更新 + 回滚)
 *   - delete(): 删除会话
 *
 * 错误处理:统一暴露 `error: Ref<string|null>` + `clearError()`,UI 层用
 *   el-notification / el-message 提示用户。
 *
 * 不持有消息流 / SSE / file explorer,只关心侧栏数据。
 */

import { ref, computed, type Ref } from 'vue'
import {
  listSessions,
  createSession,
  renameSession,
  togglePinSession,
  deleteSession
} from '@/api/agent'
import type { AgentSession } from '../types'

export interface UseSessionListResult {
  /** 完整会话列表(按后端返回顺序) */
  sessions: Ref<AgentSession[]>
  /** 是否正在加载 */
  loading: Ref<boolean>
  /** 错误消息(UI 层读取后调用 clearError) */
  error: Ref<string | null>
  /** 当前搜索词(空 = 不过滤) */
  searchQuery: Ref<string>
  /** 按搜索词过滤后的会话列表 */
  filteredSessions: Ref<AgentSession[]>
  /** 置顶会话(按 updatedAt desc) */
  pinnedSessions: Ref<AgentSession[]>
  /** 未置顶会话(按 updatedAt desc) */
  unpinnedSessions: Ref<AgentSession[]>
  /** 拉取完整列表(showLoading 控制是否显示 loading 占位) */
  load: (showLoading?: boolean) => Promise<void>
  /** 新建会话(创建后自动刷新列表,返回新会话 id) */
  create: () => Promise<string | null>
  /** 重命名会话(乐观更新,失败回滚) */
  rename: (sessionId: string, newTitle: string) => Promise<void>
  /** 切换 pin(乐观更新,失败回滚) */
  togglePin: (sessionId: string, pinned: boolean) => Promise<void>
  /** 删除会话 */
  delete: (sessionId: string) => Promise<void>
  /** 清除错误状态 */
  clearError: () => void
  /** 手动设置错误(供父组件冒泡使用) */
  setError: (msg: string | null) => void
}

/**
 * 从 BaseResponse 风格响应里抽取数据。兼容三种形态:
 *   1. { success, data: { items, total } }
 *   2. { data: { items, total } }
 *   3. { items, total }
 */
function extractSessions(resp: unknown): AgentSession[] {
  if (!resp || typeof resp !== 'object') return []
  const r = resp as Record<string, any>
  const inner = (r.data ?? r) as Record<string, any>
  if (Array.isArray(inner.items)) return inner.items as AgentSession[]
  if (Array.isArray(inner)) return inner as AgentSession[]
  if (Array.isArray(r.items)) return r.items as AgentSession[]
  return []
}

/**
 * 把 error 标准化为用户可读字符串。axios 错误形如
 *   { response: { data: { error } }, message }
 */
function formatError(e: unknown, fallback: string): string {
  if (e instanceof Error) {
    const ax = e as any
    const serverMsg = ax?.response?.data?.error
    if (typeof serverMsg === 'string' && serverMsg.length > 0) return serverMsg
    return e.message || fallback
  }
  return fallback
}

/** 按 updatedAt 倒序排(unpinned) */
function sortByUpdatedDesc(list: AgentSession[]): AgentSession[] {
  return [...list].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

export function useSessionList(): UseSessionListResult {
  const sessions = ref<AgentSession[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const searchQuery = ref('')

  function setError(msg: string | null) {
    error.value = msg
  }
  function clearError() {
    error.value = null
  }

  async function load(showLoading = false) {
    if (showLoading) loading.value = true
    try {
      const resp = await listSessions({ page: 1, page_size: 100 })
      sessions.value = extractSessions(resp)
      error.value = null
    } catch (e: unknown) {
      error.value = formatError(e, '加载会话列表失败')
    } finally {
      if (showLoading) loading.value = false
    }
  }

  async function create(): Promise<string | null> {
    try {
      const resp = await createSession('default')
      // 后端响应: { success, sessionId, data: null }
      const r = resp as any
      const sid = r?.sessionId ?? r?.data?.sessionId
      await load(false)
      return typeof sid === 'string' ? sid : null
    } catch (e: unknown) {
      error.value = formatError(e, '创建会话失败')
      return null
    }
  }

  async function rename(sessionId: string, newTitle: string) {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    // 乐观更新
    const idx = sessions.value.findIndex((s) => s.id === sessionId)
    if (idx === -1) return
    const prevTitle = sessions.value[idx].title
    sessions.value[idx] = { ...sessions.value[idx], title: trimmed }
    try {
      await renameSession(sessionId, trimmed)
    } catch (e: unknown) {
      // 回滚
      if (idx < sessions.value.length) {
        sessions.value[idx] = { ...sessions.value[idx], title: prevTitle }
      }
      error.value = formatError(e, '重命名失败')
    }
  }

  async function togglePin(sessionId: string, pinned: boolean) {
    const idx = sessions.value.findIndex((s) => s.id === sessionId)
    if (idx === -1) return
    const prev = sessions.value[idx].pinned ?? false
    if (prev === pinned) return
    // 乐观更新
    sessions.value[idx] = { ...sessions.value[idx], pinned }
    try {
      await togglePinSession(sessionId, pinned)
    } catch (e: unknown) {
      // 回滚
      if (idx < sessions.value.length) {
        sessions.value[idx] = { ...sessions.value[idx], pinned: prev }
      }
      error.value = formatError(e, pinned ? '置顶失败' : '取消置顶失败')
    }
  }

  async function deleteSess(sessionId: string) {
    // 乐观删除
    const idx = sessions.value.findIndex((s) => s.id === sessionId)
    if (idx === -1) return
    const removed = sessions.value[idx]
    sessions.value = sessions.value.filter((s) => s.id !== sessionId)
    try {
      await deleteSession(sessionId)
    } catch (e: unknown) {
      // 回滚:把会话放回原位置
      sessions.value = [
        ...sessions.value.slice(0, idx),
        removed,
        ...sessions.value.slice(idx)
      ]
      error.value = formatError(e, '删除失败')
    }
  }

  const filteredSessions = computed(() => {
    const q = searchQuery.value.trim().toLowerCase()
    if (!q) return sessions.value
    return sessions.value.filter((s) => (s.title ?? '').toLowerCase().includes(q))
  })

  const pinnedSessions = computed(() =>
    sortByUpdatedDesc(filteredSessions.value.filter((s) => s.pinned))
  )
  const unpinnedSessions = computed(() =>
    sortByUpdatedDesc(filteredSessions.value.filter((s) => !s.pinned))
  )

  return {
    sessions,
    loading,
    error,
    searchQuery,
    filteredSessions,
    pinnedSessions,
    unpinnedSessions,
    load,
    create,
    rename,
    togglePin,
    delete: deleteSess,
    clearError,
    setError
  }
}