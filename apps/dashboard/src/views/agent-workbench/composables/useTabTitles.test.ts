/**
 * useTabTitles —— tab 友好命名策略单测。
 */
import { describe, expect, it } from 'vitest'
import { resolveTabTitle } from './useTabTitles'
import type { AgentSession } from '@/api/agent'

const session = (overrides: Partial<AgentSession>): AgentSession => ({
  id: 'sess-x',
  title: '新会话',
  createdAt: '',
  updatedAt: '',
  ...overrides
})

describe('resolveTabTitle', () => {
  it('后端 title 为真命名时(非默认)优先使用', () => {
    const list: AgentSession[] = [
      session({ id: 'sess-1', title: '帮我设计接口' })
    ]
    expect(resolveTabTitle('sess-1', list)).toBe('帮我设计接口')
  })

  it('后端 title 是默认 "新会话" 时返回 "新会话"(友好)', () => {
    const list: AgentSession[] = [
      session({ id: 'sess-1', title: '新会话' })
    ]
    expect(resolveTabTitle('sess-1', list)).toBe('新会话')
  })

  it('后端未拉到(乐观会话)→ fallback "会话 {id 前缀}"', () => {
    expect(resolveTabTitle('sess-019f9967', [])).toBe('会话 sess-0')
    expect(resolveTabTitle('019f9967-aaaa-bbbb', [])).toBe('会话 019f99')
    expect(resolveTabTitle('sess-abcdef', [session({ id: 'other' })])).toBe(
      '会话 sess-a'
    )
  })

  it('title 是 raw sessionId(后端将 id 错填 title)→ 视为无效,退回 fallback', () => {
    const list: AgentSession[] = [
      session({ id: 'sess-1', title: 'sess-1' })
    ]
    expect(resolveTabTitle('sess-1', list)).toBe('会话 sess-1')
  })

  it('title 含前后空白 → trim 后判定', () => {
    const list: AgentSession[] = [
      session({ id: 'sess-1', title: '  我的提问  ' })
    ]
    expect(resolveTabTitle('sess-1', list)).toBe('我的提问')
  })

  it('空 sessions 列表 → fallback "会话 {id 前缀}"', () => {
    expect(resolveTabTitle('019f9967-xxxx-yyyy', [])).toBe('会话 019f99')
  })

  it('auto-rename 后写入 title 包含特殊字符不影响', () => {
    const list: AgentSession[] = [
      session({ id: 'sess-1', title: '关于 TypeScript 中 void 与 undefined 的区分?' })
    ]
    expect(resolveTabTitle('sess-1', list)).toBe(
      '关于 TypeScript 中 void 与 undefined 的区分?'
    )
  })
})