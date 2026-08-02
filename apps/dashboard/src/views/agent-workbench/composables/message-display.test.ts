/**
 * T3.0 — 回合聚合(turn-grouping)单测。
 *
 * 覆盖 buildRenderSegments / buildTurnProcessGroup / findFinalAssistantIndex /
 * hasFinalAssistantAnswer / hasDisplayableProcessBlocks / countToolCallsInIndices
 * / withAssistantBlocks。
 *
 * Spec: openspec/changes/blockview-process-details/specs/turn-grouping-process-details/spec.md
 *       (scenarios T3.0-A / T3.0-B / T3.0-C / T3.0-D)
 *
 * 行为契约 port 自 apps/web/components/ChatWindow.tsx 第 40-130 行的 helper 函数,
 * 以及第 510-547 行的回合聚合渲染逻辑。
 */

import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '../types'
import type { AssistantContentBlock } from '../types/assistant-blocks'
import {
  buildRenderSegments,
  buildTurnProcessGroup,
  countToolCallsInIndices,
  findFinalAssistantIndex,
  hasDisplayableProcessBlocks,
  hasFinalAssistantAnswer,
  withAssistantBlocks
} from './message-display'

type AssistantMessage = AgentMessage & { role: 'assistant' }
type AsstContent = AssistantContentBlock[] | string

const userMsg = (id: string, content: string): AgentMessage => ({
  id,
  role: 'user',
  content,
  createdAt: '2026-07-25T13:00:00Z',
  streamStatus: 'done'
})

const asst = (id: string, content: AsstContent): AssistantMessage => ({
  id,
  role: 'assistant',
  content,
  createdAt: '2026-07-25T13:00:01Z',
  streamStatus: 'done'
})

const textBlock = (text: string) => ({ type: 'text' as const, text })
const thinkBlock = (thinking: string) => ({ type: 'thinking' as const, thinking })
const toolBlock = (id: string, name = 'bash') => ({
  type: 'toolCall' as const,
  toolCallId: id,
  toolName: name,
  input: {}
})

describe('回合聚合 — 纯函数 helper', () => {
  describe('hasFinalAssistantAnswer', () => {
    it('text 为空时返 false', () => {
      expect(hasFinalAssistantAnswer(asst('a', [textBlock('   ')])).valueOf()).toBe(false)
    })
    it('text 非空时返 true', () => {
      expect(hasFinalAssistantAnswer(asst('a', [textBlock('hi')]))).toBe(true)
    })
    it('toolCall 块无 text 时也返 false', () => {
      expect(hasFinalAssistantAnswer(asst('a', [toolBlock('t1')]))).toBe(false)
    })
    it('user role 总是返 false', () => {
      expect(hasFinalAssistantAnswer(userMsg('u', 'hi'))).toBe(false)
    })
    it('content 为 string 时按长度判断', () => {
      expect(hasFinalAssistantAnswer(asst('a', 'final text'))).toBe(true)
      expect(hasFinalAssistantAnswer(asst('a', '   '))).toBe(false)
    })
  })

  describe('findFinalAssistantIndex', () => {
    it('区间内只有 process assistant 时降级到最后那个 assistant', () => {
      const list: AgentMessage[] = [
        userMsg('u', 'q'),
        asst('a1', [toolBlock('t1')]),
        asst('a2', [toolBlock('t2')])
      ]
      expect(findFinalAssistantIndex(list, 0, 3)).toBe(2)
    })
    it('区间内有 final-answer assistant 时优先选它', () => {
      const list: AgentMessage[] = [
        userMsg('u', 'q'),
        asst('a1', [toolBlock('t1')]),
        asst('a2', [textBlock('final answer')]),
        asst('a3', [toolBlock('t3')])
      ]
      // final answer 是 a2,从 userIdx=0 到 endIdx=4 区间内
      expect(findFinalAssistantIndex(list, 0, 4)).toBe(2)
    })
    it('区间内没有任何 assistant 时返 -1', () => {
      const list: AgentMessage[] = [userMsg('u', 'q'), userMsg('u2', 'q2')]
      expect(findFinalAssistantIndex(list, 0, 2)).toBe(-1)
    })
  })

  describe('hasDisplayableProcessBlocks', () => {
    it('只有 thinking 时返 true', () => {
      expect(hasDisplayableProcessBlocks(asst('a', [thinkBlock('...')]))).toBe(true)
    })
    it('只有 toolCall 时返 true', () => {
      expect(hasDisplayableProcessBlocks(asst('a', [toolBlock('t1')]))).toBe(true)
    })
    it('只有 text 时返 true(text 也算 displayable,与 React getDisplayableAssistantBlocks 对齐)', () => {
      // React 端 getDisplayableAssistantBlocks().length > 0 不区分 block 类型,
      // 只要有任何可显示 block 就视为 process-able。这里跟随该语义。
      expect(hasDisplayableProcessBlocks(asst('a', [textBlock('hi')]))).toBe(true)
    })
    it('空数组返 false', () => {
      expect(hasDisplayableProcessBlocks(asst('a', []))).toBe(false)
    })
    it('content 是 string 时返 false(string 视为纯 answer)', () => {
      expect(hasDisplayableProcessBlocks(asst('a', 'streaming text'))).toBe(false)
    })
  })

  describe('countToolCallsInIndices', () => {
    it('数 process 区间内所有 assistant 的 toolCall 块', () => {
      const list: AgentMessage[] = [
        asst('a1', [toolBlock('t1'), toolBlock('t2')]),
        asst('a2', [textBlock('no tool'), toolBlock('t3')]),
        asst('a3', [])
      ]
      expect(countToolCallsInIndices(list, [0, 1, 2])).toBe(3)
    })
    it('跳过非 assistant 与空 content', () => {
      const list: AgentMessage[] = [userMsg('u', 'q'), asst('a1', [toolBlock('t1')])]
      expect(countToolCallsInIndices(list, [0, 1])).toBe(1)
    })
  })

  describe('withAssistantBlocks', () => {
    it('替换 content 为新 blocks,omitUsage=true 抹掉 usage', () => {
      const a: AssistantMessage = {
        ...asst('a', [textBlock('hi')]),
        usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }
      }
      const next = withAssistantBlocks(a, [toolBlock('t1')], { omitUsage: true })
      expect(next.content).toEqual([toolBlock('t1')])
      expect(next.usage).toBeUndefined()
    })
    it('omitUsage=false 时保留 usage', () => {
      const a: AssistantMessage = {
        ...asst('a', [textBlock('hi')]),
        usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }
      }
      const next = withAssistantBlocks(a, [toolBlock('t1')])
      expect(next.usage).toBeDefined()
    })
  })

  describe('buildTurnProcessGroup', () => {
    it('完整回合:user → thinking → toolCall → final text', () => {
      const list: AgentMessage[] = [
        userMsg('u', 'q'),
        asst('a1', [thinkBlock('plan')]),
        asst('a2', [toolBlock('t1')]),
        asst('a3', [toolBlock('t2'), toolBlock('t3')]),
        asst('a4', [textBlock('done')])
      ]
      const g = buildTurnProcessGroup(list, 0, 5)
      expect(g).not.toBeNull()
      expect(g!.finalAssistantIdx).toBe(4)
      expect(g!.processIndices).toEqual([1, 2, 3])
      expect(g!.finalProcessBlocks).toEqual([])
      expect(g!.finalAnswerBlocks).toEqual([textBlock('done')])
    })

    it('finalAssistant 的 processBlocks 会被切走', () => {
      const list: AgentMessage[] = [
        userMsg('u', 'q'),
        asst('a1', [thinkBlock('plan'), toolBlock('t1'), textBlock('done')])
      ]
      const g = buildTurnProcessGroup(list, 0, 2)
      expect(g).not.toBeNull()
      expect(g!.finalAssistantIdx).toBe(1)
      expect(g!.processIndices).toEqual([])
      expect(g!.finalProcessBlocks).toEqual([thinkBlock('plan'), toolBlock('t1')])
      expect(g!.finalAnswerBlocks).toEqual([textBlock('done')])
    })

    it('无 finalAssistant 时返 null', () => {
      const list: AgentMessage[] = [userMsg('u', 'q')]
      expect(buildTurnProcessGroup(list, 0, 1)).toBeNull()
    })

    it('只有 answer text 块的回合:依然有 finalAssistant,只是没 process blocks', () => {
      // React 端不因'没东西可折叠'而返 null —— 只有 finalAssistant 不存在时才返 null。
      // hasDisplayableProcessBlocks 跟随 React getDisplayableAssistantBlocks().length > 0
      // 语义,不区分 block 类型。
      const list: AgentMessage[] = [userMsg('u', 'q'), asst('a1', [textBlock('hi')])]
      const g = buildTurnProcessGroup(list, 0, 2)
      expect(g).not.toBeNull()
      expect(g!.processIndices).toEqual([])
      expect(g!.finalProcessBlocks).toEqual([])
      expect(g!.finalAnswerBlocks).toEqual([textBlock('hi')])
    })
  })

  describe('buildRenderSegments', () => {
    it('回合聚合:user + ProcessDetailsGroup(中间过程) + finalAssistant answerBlocks', () => {
      const list: AgentMessage[] = [
        userMsg('u', 'q'),
        asst('a1', [thinkBlock('plan')]),
        asst('a2', [toolBlock('t1')]),
        asst('a3', [textBlock('done')])
      ]
      const segs = buildRenderSegments(list)
      expect(segs).toHaveLength(1)
      const seg = segs[0]!
      if (seg.kind !== 'turn') throw new Error('expected turn segment')
      expect(seg.user.id).toBe('u')
      expect(seg.processGroup.processIndices).toEqual([1, 2])
      expect(seg.processGroup.finalAssistantIdx).toBe(3)
      expect(seg.processGroup.finalAnswerBlocks).toEqual([textBlock('done')])
      expect(seg.processMessages.map((m) => m.id)).toEqual(['a1', 'a2'])
    })

    it('user 后没有 assistant 的回合降级为逐条 message 渲染', () => {
      // 没有 finalAssistant → buildTurnProcessGroup 返 null → buildRenderSegments 逐条渲染
      const list: AgentMessage[] = [userMsg('u', 'q')]
      const segs = buildRenderSegments(list)
      expect(segs).toHaveLength(1)
      expect(segs.every((s) => s.kind === 'message')).toBe(true)
    })

    it('多回合切分:两个 user 之间是独立的回合', () => {
      const list: AgentMessage[] = [
        userMsg('u1', 'q1'),
        asst('a1', [toolBlock('t1')]),
        asst('a2', [textBlock('done1')]),
        userMsg('u2', 'q2'),
        asst('a3', [toolBlock('t2')]),
        asst('a4', [textBlock('done2')])
      ]
      const segs = buildRenderSegments(list)
      expect(segs).toHaveLength(2)
      expect(segs.every((s) => s.kind === 'turn')).toBe(true)
      const turns = segs.filter((s): s is Extract<typeof s, { kind: 'turn' }> => s.kind === 'turn')
      expect(turns[0]?.user.id).toBe('u1')
      expect(turns[1]?.user.id).toBe('u2')
    })

    it('isLiveTail=true 时最后一个回合降级为逐条渲染', () => {
      const list: AgentMessage[] = [
        userMsg('u', 'q'),
        asst('a1', [toolBlock('t1')]),
        asst('a2', [textBlock('streaming...')])
      ]
      const segs = buildRenderSegments(list, { isLiveTail: true })
      expect(segs.every((s) => s.kind === 'message')).toBe(true)
      expect(segs).toHaveLength(3)
    })

    it('isLiveTail=false 时历史回合正常聚合', () => {
      const list: AgentMessage[] = [
        userMsg('u', 'q'),
        asst('a1', [toolBlock('t1')]),
        asst('a2', [textBlock('done')])
      ]
      const segs = buildRenderSegments(list, { isLiveTail: false })
      expect(segs).toHaveLength(1)
      expect(segs[0]!.kind).toBe('turn')
    })

    it('流式尾巴前的回合仍正常聚合', () => {
      const list: AgentMessage[] = [
        userMsg('u1', 'q1'),
        asst('a1', [toolBlock('t1')]),
        asst('a2', [textBlock('done1')]),
        userMsg('u2', 'q2'),
        asst('a3', [toolBlock('t2')])
      ]
      const segs = buildRenderSegments(list, { isLiveTail: true })
      // u1 → turn 聚合,u2 → 最后一个回合,流式尾巴 → 降级逐条
      expect(segs[0]!.kind).toBe('turn')
      expect(segs[1]!.kind).toBe('message')
      expect(segs[2]!.kind).toBe('message')
    })

    it('tool role 消息不进回合,toolResult 同样不渲染', () => {
      // 对齐 apps/web:visibleMessages = user/assistant only。
      // tool / toolResult role 不进 visibleMessages,tool result 的显示
      // 由 ChatWindow.pairedResultsByToolCallId Map 注入。
      const list: AgentMessage[] = [
        userMsg('u', 'q'),
        asst('a1', [toolBlock('t1')]),
        { id: 'tr', role: 'tool', content: 'result', createdAt: '', streamStatus: 'done' as const },
        { id: 'tr2', role: 'toolResult', toolCallId: 't1', content: 'paired output', createdAt: '', streamStatus: 'done' as const },
        asst('a2', [textBlock('done')])
      ]
      const segs = buildRenderSegments(list)
      expect(segs).toHaveLength(1)
      const seg = segs[0]!
      if (seg.kind !== 'turn') throw new Error('expected turn segment')
      // tool/toolResult 过滤后,仅 a1、a2 进入回合;a1 是 processMessage。
      expect(seg.processMessages.map((m) => m.id)).toEqual(['a1'])
      expect(seg.processGroup.finalAssistantIdx).toBe(2) // a2 在 visibleMessages 里的 idx
      expect(seg.processGroup.finalAnswerBlocks).toEqual([textBlock('done')])
    })
  })
})
