/**
 * useUnreadSessions —— 未读会话集合(localStorage 持久化)。
 *
 * 覆盖:
 *   - 初始为空(无 storage 项时)
 *   - mark/clear/isUnread 三接口闭环
 *   - 持久化:写入后从 storage 还原
 *   - pruneTo:仅保留还存在于 sessions 列表中的 id
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUnreadSessions } from './useUnreadSessions'
import type { AgentSession } from '@/api/agent'

function sess(id: string): AgentSession {
  return {
    id,
    title: id,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z'
  }
}

describe('useUnreadSessions', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('初始无 storage 时为空', () => {
    const u = useUnreadSessions()
    expect(u.isUnread('any')).toBe(false)
  })

  it('mark → isUnread true', () => {
    const u = useUnreadSessions()
    u.mark('s1')
    expect(u.isUnread('s1')).toBe(true)
  })

  it('clear → isUnread false', () => {
    const u = useUnreadSessions()
    u.mark('s2')
    u.clear('s2')
    expect(u.isUnread('s2')).toBe(false)
  })

  it('持久化:再 new 一个读实例能拿到旧集合', async () => {
    const a = useUnreadSessions()
    a.mark('persist-1')
    a.mark('persist-2')
    await Promise.resolve()
    expect(localStorage.getItem('wb:unread-session-ids')).not.toBeNull()
    const b = useUnreadSessions()
    expect(b.isUnread('persist-1')).toBe(true)
    expect(b.isUnread('persist-2')).toBe(true)
  })

  it('pruneTo:删除不在 sessions 中的 id,保留存在的', () => {
    const u = useUnreadSessions()
    u.mark('keep')
    u.mark('drop')
    u.mark('also-drop')
    u.pruneTo([sess('keep'), sess('no-existing-anyway')])
    expect(u.isUnread('keep')).toBe(true)
    expect(u.isUnread('drop')).toBe(false)
    expect(u.isUnread('also-drop')).toBe(false)
  })
})