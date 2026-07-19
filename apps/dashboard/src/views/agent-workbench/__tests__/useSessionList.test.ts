/**
 * useSessionList 单元测试
 *
 * 覆盖:
 *   - 派生(pinned / unpinned / 搜索过滤)
 *   - rename / togglePin / delete 乐观更新 + 回滚
 *   - create 成功路径返回 sessionId
 *   - error 状态设置 + clearError
 *
 * Mock 约定: httpClient.get(..., { keepFullResponse: true }) 返回 res.data,即
 * 服务端 BaseResponse 形如 { code, msg, data: <T> }。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/agent', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  renameSession: vi.fn(),
  togglePinSession: vi.fn(),
  deleteSession: vi.fn(),
  sendMessage: vi.fn(),
  listAvailableAgents: vi.fn(),
  startDelegation: vi.fn(),
  subscribeRunningSessions: vi.fn()
}))

import { useSessionList } from '../composables/useSessionList'
import * as api from '@/api/agent'

const SAMPLE = [
  { id: 'a', title: 'Alpha', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-05T00:00:00Z', pinned: true },
  { id: 'b', title: 'Beta',  createdAt: '2025-01-02T00:00:00Z', updatedAt: '2025-01-04T00:00:00Z', pinned: false },
  { id: 'c', title: 'Gamma', createdAt: '2025-01-03T00:00:00Z', updatedAt: '2025-01-03T00:00:00Z', pinned: false }
]

function okResp<T>(data: T) {
  return { code: 0, msg: 'ok', data } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSessionList — load()', () => {
  it('extracts items from BaseResponse', async () => {
    vi.mocked(api.listSessions).mockResolvedValueOnce(okResp({ items: SAMPLE, total: 3 }))
    const c = useSessionList()
    await c.load(true)
    expect(c.sessions.value).toHaveLength(3)
    expect(c.loading.value).toBe(false)
    expect(c.error.value).toBeNull()
  })

  it('sets error when list fails', async () => {
    vi.mocked(api.listSessions).mockRejectedValueOnce(new Error('boom'))
    const c = useSessionList()
    await c.load(true)
    expect(c.error.value).toBe('boom')
    expect(c.sessions.value).toEqual([])
  })
})

describe('useSessionList — derived state', () => {
  it('separates pinned from unpinned, sorted by updatedAt desc', async () => {
    vi.mocked(api.listSessions).mockResolvedValueOnce(okResp({ items: SAMPLE }))
    const c = useSessionList()
    await c.load()
    expect(c.pinnedSessions.value.map((s) => s.id)).toEqual(['a'])
    // b updated 2025-01-04 > c updated 2025-01-03
    expect(c.unpinnedSessions.value.map((s) => s.id)).toEqual(['b', 'c'])
  })

  it('filters by search query (case-insensitive)', async () => {
    vi.mocked(api.listSessions).mockResolvedValueOnce(okResp({ items: SAMPLE }))
    const c = useSessionList()
    await c.load()
    c.searchQuery.value = 'beta'
    expect(c.filteredSessions.value.map((s) => s.id)).toEqual(['b'])
    expect(c.pinnedSessions.value).toEqual([])
    expect(c.unpinnedSessions.value).toHaveLength(1)
  })
})

describe('useSessionList — rename()', () => {
  it('optimistically updates title and rolls back on failure', async () => {
    vi.mocked(api.listSessions).mockResolvedValueOnce(okResp({ items: SAMPLE }))
    vi.mocked(api.renameSession).mockRejectedValueOnce(new Error('rename failed'))
    const c = useSessionList()
    await c.load()
    await c.rename('a', 'Alpha-2')
    expect(c.sessions.value.find((s) => s.id === 'a')!.title).toBe('Alpha')
    expect(c.error.value).toBe('rename failed')
  })

  it('keeps optimistic update on success', async () => {
    vi.mocked(api.listSessions).mockResolvedValueOnce(okResp({ items: SAMPLE }))
    vi.mocked(api.renameSession).mockResolvedValueOnce(okResp({ ok: true }))
    const c = useSessionList()
    await c.load()
    await c.rename('a', 'Alpha-2')
    expect(c.sessions.value.find((s) => s.id === 'a')!.title).toBe('Alpha-2')
    expect(c.error.value).toBeNull()
  })
})

describe('useSessionList — togglePin()', () => {
  it('optimistically toggles and rolls back on failure', async () => {
    vi.mocked(api.listSessions).mockResolvedValueOnce(okResp({ items: SAMPLE }))
    vi.mocked(api.togglePinSession).mockRejectedValueOnce(new Error('pin failed'))
    const c = useSessionList()
    await c.load()
    const before = c.sessions.value.find((s) => s.id === 'b')!.pinned
    await c.togglePin('b', true)
    expect(c.sessions.value.find((s) => s.id === 'b')!.pinned).toBe(before)
    expect(c.error.value).toBe('pin failed')
  })
})

describe('useSessionList — delete()', () => {
  it('optimistically removes and rolls back on failure', async () => {
    vi.mocked(api.listSessions).mockResolvedValueOnce(okResp({ items: SAMPLE }))
    vi.mocked(api.deleteSession).mockRejectedValueOnce(new Error('del failed'))
    const c = useSessionList()
    await c.load()
    await c.delete('a')
    expect(c.sessions.value.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(c.error.value).toBe('del failed')
  })

  it('keeps deletion on success', async () => {
    vi.mocked(api.listSessions).mockResolvedValueOnce(okResp({ items: SAMPLE }))
    vi.mocked(api.deleteSession).mockResolvedValueOnce(okResp({ ok: true }))
    const c = useSessionList()
    await c.load()
    await c.delete('a')
    expect(c.sessions.value.map((s) => s.id)).toEqual(['b', 'c'])
  })
})

describe('useSessionList — create()', () => {
  it('returns sessionId and refreshes the list on success', async () => {
    vi.mocked(api.listSessions)
      .mockResolvedValueOnce(okResp({ items: SAMPLE, total: 3 }))
      .mockResolvedValueOnce(
        okResp({
          items: [
            ...SAMPLE,
            { id: 'new', title: '新会话', createdAt: '2025-01-06', updatedAt: '2025-01-06' }
          ],
          total: 4
        })
      )
    // createSession 后端返回 { sessionId, data: null } —— 不走 BaseResponse
    vi.mocked(api.createSession).mockResolvedValueOnce({ sessionId: 'new' } as any)
    const c = useSessionList()
    await c.load()
    const sid = await c.create()
    expect(sid).toBe('new')
    expect(c.sessions.value).toHaveLength(4)
  })

  it('returns null and sets error on failure', async () => {
    vi.mocked(api.createSession).mockRejectedValueOnce(new Error('create failed'))
    const c = useSessionList()
    const sid = await c.create()
    expect(sid).toBeNull()
    expect(c.error.value).toBe('create failed')
  })

  /**
   * 真实场景:某些后端实现下,新建空会话不会立刻出现在 listSessions。
   * 期望乐观 push 把 new 补到 sessions 头部,保证侧栏立即可见。
   */
  it('optimistically pushes new session when listSessions does not include it', async () => {
    // 两次 list 都只返回 SAMPLE(不包含 new)
    vi.mocked(api.listSessions)
      .mockResolvedValueOnce(okResp({ items: SAMPLE, total: 3 }))
      .mockResolvedValueOnce(okResp({ items: SAMPLE, total: 3 }))
    vi.mocked(api.createSession).mockResolvedValueOnce({ sessionId: 'new' } as any)
    const c = useSessionList()
    await c.load()
    const sid = await c.create()
    expect(sid).toBe('new')
    // 远端 3 项 + 乐观 push 1 项 = 4
    expect(c.sessions.value).toHaveLength(4)
    expect(c.sessions.value[0]?.id).toBe('new')
    // 派生 unpinnedSessions 应包含 new(因为乐观 push 没设 pinned → undefined → falsy)
    expect(c.unpinnedSessions.value.map((s) => s.id)).toContain('new')
  })

  /**
   * Bug 1 回归:连续 create 两个新会话,后端 listSessions 始终不含(空会话)。
   * 第一次 create 后 sessions 应包含 new1;第二次 create 后应同时包含 new1 和 new2。
   * 修复前:第二次 create 的 load 会用 SAMPLE(3 项)整体覆盖,丢掉 new1。
   */
  it('preserves previously optimistic sessions when a second create fires', async () => {
    // 所有 listSessions 都只返 SAMPLE(不含任何新建会话)
    vi.mocked(api.listSessions).mockResolvedValue(okResp({ items: SAMPLE, total: 3 }))
    vi.mocked(api.createSession)
      .mockResolvedValueOnce({ sessionId: 'new1' } as any)
      .mockResolvedValueOnce({ sessionId: 'new2' } as any)
    const c = useSessionList()
    await c.load()
    await c.create()
    await c.create()
    // 后端 3 + 乐观 2 = 5
    expect(c.sessions.value).toHaveLength(5)
    expect(c.sessions.value.map((s) => s.id)).toEqual(
      expect.arrayContaining(['new1', 'new2'])
    )
    // 两个新建会话都应出现在 unpinned 列表
    const unpinnedIds = c.unpinnedSessions.value.map((s) => s.id)
    expect(unpinnedIds).toEqual(expect.arrayContaining(['new1', 'new2']))
  })

  /**
   * Bug 1 回归:load() 自身在已有乐观项时不应整体覆盖,只合并后端项。
   */
  it('load() merges with existing optimistic sessions instead of replacing', async () => {
    // 第一次 load:仅 SAMPLE
    vi.mocked(api.listSessions).mockResolvedValueOnce(okResp({ items: SAMPLE, total: 3 }))
    vi.mocked(api.createSession).mockResolvedValueOnce({ sessionId: 'new1' } as any)
    const c = useSessionList()
    await c.load()
    await c.create()
    expect(c.sessions.value.map((s) => s.id)).toEqual(
      expect.arrayContaining(['new1', 'a', 'b', 'c'])
    )
    // 第二次 load:后端仍未返 new1(模拟真实情况)
    vi.mocked(api.listSessions).mockResolvedValueOnce(okResp({ items: SAMPLE, total: 3 }))
    await c.load(true)
    expect(c.sessions.value).toHaveLength(4)
    expect(c.sessions.value.map((s) => s.id)).toEqual(
      expect.arrayContaining(['new1', 'a', 'b', 'c'])
    )
  })
})

describe('useSessionList — error utilities', () => {
  it('clearError resets error state', async () => {
    vi.mocked(api.listSessions).mockRejectedValueOnce(new Error('boom'))
    const c = useSessionList()
    await c.load()
    expect(c.error.value).toBe('boom')
    c.clearError()
    expect(c.error.value).toBeNull()
  })

  it('setError allows manual error injection', () => {
    const c = useSessionList()
    c.setError('manual')
    expect(c.error.value).toBe('manual')
  })
})