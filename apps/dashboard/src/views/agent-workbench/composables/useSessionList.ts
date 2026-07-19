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
  create: (userId?: string) => Promise<string | null>
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
  // 跟踪乐观 push 的会话 id —— 这些会话在 load 后端列表时必须保留,
  // 否则连续 create 会把之前的乐观项挤掉(Bug 1 根因)。
  // 后端真正返该项时从集合中移除(在 load 的合并阶段处理)。
  //
  // Bug 3 修复:乐观 push 的会话(用户从未发过消息的空会话)还必须跨刷新保留 —
  // 后端 listSessions 不返回它们,组件重挂载会丢掉乐观 push 项。所以这些
  // 会话(包括 optimisticIds 和它们的 title/createdAt)持久化到 localStorage,
  // 模块加载时水化。
  const OPTIMISTIC_KEY = 'wb:optimisticSessions'
  const optimisticIds = new Set<string>(loadOptimisticMeta().map((s) => s.id))

  function setError(msg: string | null) {
    error.value = msg
  }
  function clearError() {
    error.value = null
  }

  /** 从 localStorage 读乐观 push 的会话清单(模块加载时调一次) */
  function loadOptimisticMeta(): AgentSession[] {
    try {
      const raw = localStorage.getItem(OPTIMISTIC_KEY)
      if (!raw) return []
      const arr = JSON.parse(raw) as unknown
      if (!Array.isArray(arr)) return []
      return arr.filter(
        (s): s is AgentSession =>
          !!s &&
          typeof (s as AgentSession).id === 'string' &&
          typeof (s as AgentSession).title === 'string'
      )
    } catch {
      return []
    }
  }

  function persistOptimisticMeta(): void {
    try {
      // 只持久化乐观项的最小必要字段(id/title/createdAt)
      const extras = sessions.value.filter((s) => optimisticIds.has(s.id))
      localStorage.setItem(OPTIMISTIC_KEY, JSON.stringify(extras))
    } catch {
      /* 隐私模式 / quota 异常静默 */
    }
  }

  async function load(showLoading = false) {
    if (showLoading) loading.value = true
    try {
      const resp = await listSessions({ page: 1, page_size: 100 })
      const remoteItems = extractSessions(resp)
      // Bug 1 修复:与乐观项按 id 合并,保留所有仍在 optimisticIds 的本地项。
      // 合并策略:
      //   - 用后端项作为权威(覆盖本地同名项的 updatedAt/title/pinned)
      //   - 乐观项若不在后端返回中,保留(用户能看到自己刚建的空会话)
      //   - 后端真正命中乐观 id 后,从 optimisticIds 中移除,下次 load 不会再保留
      const byId = new Map<string, AgentSession>()
      for (const item of remoteItems) byId.set(item.id, item)
      // 先放远程(顺序按后端 updatedAt desc),再追加远程没有的乐观项
      const merged: AgentSession[] = [...remoteItems]
      for (const id of optimisticIds) {
        if (byId.has(id)) {
          // 后端已返该项,不再是乐观 → 清标记,后续 load 不再"保留"
          optimisticIds.delete(id)
        }
      }
      // 把仍在 optimisticIds 且不在后端的本地项找出来,前置到头部
      // (用户刚建的会话应在最上方,语义上"最新")
      //
      // Bug 3 修复:首次 load 时 sessions.value 可能是空(模块刚加载),
      // 这时 localStorage 水化的乐观项要作为本地来源 — 否则组件挂载后
      // 侧栏看不到任何"乐观会话"。
      const localSource = sessions.value.length > 0 ? sessions.value : loadOptimisticMeta()
      const localExtras = localSource.filter(
        (s) => optimisticIds.has(s.id) && !byId.has(s.id)
      )
      // 去重:本地可能已包含某个 id 但被合并逻辑覆盖了,这里用 Map 兜底
      const remoteIds = new Set(merged.map((s) => s.id))
      const headExtras: AgentSession[] = []
      for (const extra of localExtras) {
        if (remoteIds.has(extra.id)) continue
        headExtras.push(extra)
        remoteIds.add(extra.id)
      }
      sessions.value = [...headExtras, ...merged]
      // Bug 3 修复:乐观项变更后写回 localStorage(供下次刷新)
      persistOptimisticMeta()
      error.value = null
    } catch (e: unknown) {
      error.value = formatError(e, '加载会话列表失败')
    } finally {
      if (showLoading) loading.value = false
    }
  }

  async function create(userId?: string): Promise<string | null> {
    try {
      // 真实 userId 由调用方传入(避免在 composable 里直接 import userStore,
      // 它的依赖图会引入 mock/changeLog 等测试环境不友好的模块)。
      // 后端 listSessions 走 assertCanReadSessionScoped 鉴权,如果 userId
      // 是字面量 'default' 会导致新建的 session 不属于任何用户,被过滤掉,
      // 侧栏永远看不到。
      const resp = await createSession(userId ?? 'default')
      // 后端响应: { success, sessionId, data: null }
      const r = resp as any
      const sid = r?.sessionId ?? r?.data?.sessionId
      // Bug 1 修复:先标记乐观 id,再 await load(load 会保留该项),
      // 避免"乐观 push 后被 load 覆盖"的回归。
      if (typeof sid === 'string' && sid.length > 0) {
        optimisticIds.add(sid)
        const existing = sessions.value.findIndex((s) => s.id === sid)
        if (existing === -1) {
          sessions.value = [
            {
              id: sid,
              title: '新会话',
              available: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            ...sessions.value
          ]
        }
        // Bug 3 修复:乐观 push 后立即写回 localStorage,避免刷新丢
        persistOptimisticMeta()
      }
      // load 会走合并路径:保留 optimisticIds 中的项,后端命中后清标记
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
      optimisticIds.delete(sessionId)
      // Bug 3 修复:delete 后写回 localStorage,避免幽灵会话
      persistOptimisticMeta()
    } catch (e: unknown) {
      // 回滚:把会话放回原位置
      sessions.value = [...sessions.value.slice(0, idx), removed, ...sessions.value.slice(idx)]
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
