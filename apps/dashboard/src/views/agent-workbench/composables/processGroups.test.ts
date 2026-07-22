/**
 * isEmptyThinkingBlock / hasFinalAssistantAnswer / processGroups —— ChatWindow 折叠算法 helpers,
 * mirror apps/web/components/ChatWindow.tsx 行为。
 */
import { describe, it, expect } from 'vitest'
import type { AgentMessage } from '../types'
import {
  hasFinalAssistantAnswer,
  isEmptyThinkingBlock,
  processGroups,
} from './processGroups'

const makeText = (role: AgentMessage['role'], content: string, id: string): AgentMessage => ({
  id,
  role,
  content,
  createdAt: '2026-07-22T00:00:00.000Z',
})
const makeAssistant = (content: AgentMessage['content'], id: string): AgentMessage => ({
  id,
  role: 'assistant',
  content,
  createdAt: '2026-07-22T00:00:00.000Z',
})
const userAt = (s: string, id: string) => makeText('user', s, id)
const assistantTextAt = (s: string, id: string) => makeAssistant(s, id)
const assistantArrayAt = (content: AgentMessage['content'], id: string) =>
  makeAssistant(content, id)

/** 仅 type+message.id 的轻量断言 helper(对实现返回的 RenderItem 严格比对 id,但不锁死 createdAt / magic suffix) */
function pluckRenderItem(item: { type: string; message?: AgentMessage; messages?: AgentMessage[] }): unknown {
  if (item.type === 'group' && item.messages) {
    return { type: 'group', ids: item.messages.map((m: AgentMessage) => m.id) }
  }
  if (item.type === 'message' && item.message) {
    return { type: 'message', id: item.message.id, role: item.message.role }
  }
  return item
}

describe('hasFinalAssistantAnswer', () => {
  it('user role → false', () => {
    expect(hasFinalAssistantAnswer(userAt('hi', 'u1'))).toBe(false)
  })
  it('empty assistant string content → false', () => {
    expect(hasFinalAssistantAnswer(assistantTextAt('', 'a1'))).toBe(false)
  })
  it('non-empty assistant string content → true', () => {
    expect(hasFinalAssistantAnswer(assistantTextAt('hello', 'a1'))).toBe(true)
  })
  it('only thinking blocks → false', () => {
    expect(
      hasFinalAssistantAnswer(
        assistantArrayAt([{ type: 'thinking', thinking: 'r' }], 'a1'),
      ),
    ).toBe(false)
  })
  it('at least one text block → true', () => {
    expect(
      hasFinalAssistantAnswer(
        assistantArrayAt(
          [{ type: 'thinking', thinking: 'r' }, { type: 'text', text: 'hi' }],
          'a1',
        ),
      ),
    ).toBe(true)
  })
})

describe('processGroups - lint smoke', () => {
  it('空 messages - 返回 []', () => {
    expect(processGroups([])).toEqual([])
  })

  it('单条 user + 单条 assistant - 都平铺', () => {
    const u = userAt('u1', 'u1')
    const a = assistantTextAt('a1', 'a1')
    const out = processGroups([u, a])
    expect(out.map(pluckRenderItem)).toEqual([
      { type: 'message', id: 'u1', role: 'user' },
      { type: 'message', id: 'a1', role: 'assistant' },
    ])
  })

  it('单条 assistant - 不折叠 (无 user 前缀)', () => {
    const a = assistantTextAt('a1', 'a1')
    const out = processGroups([a])
    expect(out.map(pluckRenderItem)).toEqual([
      { type: 'message', id: 'a1', role: 'assistant' },
    ])
  })

  it('2 条 + toolCall → 折叠 (last 是 final reply, 进 group 前一条; last 独立)', () => {
    // 我们的算法:序列 ≥ 2 + last hasFinalAssistantAnswer → 倒数第 1 进 group(若 ≥ 2 才触发) 最后一条独立
    // 这里 segment=[a1(有 toolCall), a2(string 'a2')] len=2; 前段=segment.slice(0,-1)=[a1] len=1 (不触发 group, 平铺)+ final [a2]
    // 所以实际输出全平铺。验算法
    const u = userAt('u1', 'u1')
    const a1 = assistantArrayAt(
      [{ type: 'text', text: 'a1' }, { type: 'toolCall', toolCallId: 'a', toolName: 'bash', input: {} }],
      'a1',
    )
    const a2 = assistantTextAt('a2', 'a2')
    const out = processGroups([u, a1, a2])
    // segment [a1, a2] len=2; trigger by len≥2 + ≥1 displayable
    // lastIsFinalReply=true; groupMsgs=[a1] len=1 < 2 → 平铺; finalMsg=[a2] 平铺
    expect(out.map(pluckRenderItem)).toEqual([
      { type: 'message', id: 'u1', role: 'user' },
      { type: 'message', id: 'a1', role: 'assistant' },
      { type: 'message', id: 'a2', role: 'assistant' },
    ])
  })

  it('3 条 [steps + final] → 前 2 进 group, final 独立', () => {
    const u = userAt('u1', 'u1')
    const a1 = assistantArrayAt(
      [{ type: 'text', text: 'a1' }, { type: 'toolCall', toolCallId: 't', toolName: 'bash', input: {} }],
      'a1',
    )
    const a2 = assistantTextAt('a2', 'a2')
    const a3 = assistantTextAt('final', 'a3')
    const out = processGroups([u, a1, a2, a3])
    expect(out.map(pluckRenderItem)).toEqual([
      { type: 'message', id: 'u1', role: 'user' },
      { type: 'group', ids: ['a1', 'a2'] },
      { type: 'message', id: 'a3', role: 'assistant' },
    ])
  })

  it('≥2 全 thinking → 不折叠 (displayable 不够)', () => {
    const u = userAt('u1', 'u1')
    const a1 = assistantArrayAt([{ type: 'thinking', thinking: 'r1' }], 'a1')
    const a2 = assistantArrayAt([{ type: 'thinking', thinking: 'r2' }], 'a2')
    const out = processGroups([u, a1, a2])
    expect(out.map(pluckRenderItem)).toEqual([
      { type: 'message', id: 'u1', role: 'user' },
      { type: 'message', id: 'a1', role: 'assistant' },
      { type: 'message', id: 'a2', role: 'assistant' },
    ])
  })

  it('3 条 [steps,steps,thinking-tail] - last 是 thinking → 全 3 进 group', () => {
    // 边界:last 是 thinking(空)→ 全进 group
    const u = userAt('u1', 'u1')
    const a1 = assistantArrayAt(
      [{ type: 'text', text: 'a1' }, { type: 'toolCall', toolCallId: 't', toolName: 'bash', input: {} }],
      'a1',
    )
    const a2 = assistantTextAt('a2', 'a2')
    const a3 = assistantArrayAt([{ type: 'thinking', thinking: 'tail' }], 'a3') // isEmptyThinkingBlock
    const out = processGroups([u, a1, a2, a3])
    // segment [a1, a2, a3] len=3, lastIsFinalReply=false → 全部进 group
    expect(out.map(pluckRenderItem)).toEqual([
      { type: 'message', id: 'u1', role: 'user' },
      { type: 'group', ids: ['a1', 'a2', 'a3'] },
    ])
  })

  it('2 assistant + 后续 user - 第一段折叠到 user 前', () => {
    const u1 = userAt('u1', 'u1')
    const a1 = assistantArrayAt(
      [{ type: 'toolCall', toolCallId: 'a', toolName: 'bash', input: {} }],
      'a1',
    )
    const a2 = assistantTextAt('a2', 'a2')
    const u2 = userAt('u2', 'u2')
    const a3 = assistantTextAt('final', 'a3')
    const out = processGroups([u1, a1, a2, u2, a3])
    // u1/user → flat. [a1, a2] → group(中间 steps + final 都进 group? 算法让 a2 lastIsFinalReply 触发 group[a1] + flat[a2])
    // Re-check: segment [a1, a2] len=2; lastIsFinalReply=true (a2 has text); groupMsgs=[a1] len=1 → 平铺; finalMsg[a2] 平铺
    // → all flat. u2 flat. a3 flat.
    expect(out.map(pluckRenderItem)).toEqual([
      { type: 'message', id: 'u1', role: 'user' },
      { type: 'message', id: 'a1', role: 'assistant' },
      { type: 'message', id: 'a2', role: 'assistant' },
      { type: 'message', id: 'u2', role: 'user' },
      { type: 'message', id: 'a3', role: 'assistant' },
    ])
  })

  it('sequence 头不是 user - 容忍,以首条 assistant 为基准', () => {
    const a1 = assistantArrayAt(
      [{ type: 'toolCall', toolCallId: 't', toolName: 'bash', input: {} }],
      'a1',
    )
    const a2 = assistantTextAt('a2', 'a2')
    const out = processGroups([a1, a2])
    // segment [a1, a2] len=2; last is final → groupMsgs=[a1] len=1 → 平铺; final[a2] 平铺
    expect(out.map(pluckRenderItem)).toEqual([
      { type: 'message', id: 'a1', role: 'assistant' },
      { type: 'message', id: 'a2', role: 'assistant' },
    ])
  })

  it('4 条 [steps,steps,final] + final lastIsEmpty → 全 3 进 group', () => {
    // 边界:last 是 thinking(空)→ 全进 group
    const u = userAt('u1', 'u1')
    const a1 = assistantArrayAt(
      [{ type: 'text', text: 'a1' }, { type: 'toolCall', toolCallId: 't', toolName: 'bash', input: {} }],
      'a1',
    )
    const a2 = assistantTextAt('a2', 'a2')
    const a3 = assistantArrayAt([{ type: 'thinking', thinking: 'tail' }], 'a3') // isEmptyThinkingBlock
    const out = processGroups([u, a1, a2, a3])
    // segment [a1, a2, a3] len=3, lastIsFinalReply=false → 全部进 group
    expect(out.map(pluckRenderItem)).toEqual([
      { type: 'message', id: 'u1', role: 'user' },
      { type: 'group', ids: ['a1', 'a2', 'a3'] },
    ])
  })
})

describe('isEmptyThinkingBlock', () => {
  it('user role → true', () => {
    expect(isEmptyThinkingBlock(userAt('hi', 'u1'))).toBe(true)
  })
  it('空 string 内容 → true', () => {
    expect(isEmptyThinkingBlock(assistantTextAt('', 'a1'))).toBe(true)
  })
  it('纯 thinking → true', () => {
    expect(isEmptyThinkingBlock(assistantArrayAt([{ type: 'thinking', thinking: 'r' }], 'a1'))).toBe(true)
  })
  it('含 text block → false', () => {
    expect(isEmptyThinkingBlock(assistantArrayAt([{ type: 'text', text: 'hi' }], 'a1'))).toBe(false)
  })
})
