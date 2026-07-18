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