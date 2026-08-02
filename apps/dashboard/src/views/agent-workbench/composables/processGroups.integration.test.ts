/**
 * ChatWindow.vue processGroups 集成测试 —— 验证 renderItems computed 输出与模板路由。
 *
 * 算法触发条件(2026-07-22):segment.length ≥ 3 + ≥1 displayable 才折叠。
 */
import { describe, it, expect } from 'vitest'
import { processGroups } from './processGroups'
import type { AgentMessage } from '../types'

const u = (id: string, content = 'u'): AgentMessage => ({
  id, role: 'user', content, createdAt: 't',
})

const assistant = (id: string, content: AgentMessage['content']): AgentMessage => ({
  id, role: 'assistant', content, createdAt: 't',
})

const flatten = (out: ReturnType<typeof processGroups>) =>
  out.map(i => i.type === 'group'
    ? `g[${i.messages.map(m => m.id).join(',')}]`
    : `m[${i.message.id}]`,
  )

describe('ChatWindow processGroups - happy paths', () => {
  it('典型多步 agent 流程 - 3 条 + final → 前 2 进 group,final 独立', () => {
    const msgs = [
      u('u1', '帮我查文件'),
      assistant('a1', [
        { type: 'text', text: '好的我来查' },
        { type: 'toolCall', toolCallId: 't1', toolName: 'bash', input: { command: 'ls' } },
      ]),
      assistant('a2', 'ls 输出第一行是: file1.txt'),
      assistant('a3', '文件清单见上,需要我打开它吗?'),
    ]
    expect(flatten(processGroups(msgs))).toEqual([
      'm[u1]',
      'g[a1,a2]',
      'm[a3]',
    ])
  })

  it('多个 user 段每段 ≥3 → 各自折叠', () => {
    const msgs = [
      u('u1'),
      assistant('a1', [{ type: 'toolCall', toolCallId: 't', toolName: 'x', input: {} }]),
      assistant('a2', 'after'),
      // a3 必须是 thinking-tail(空)→ 全 3 进 group;如果是 text "thinking content" → 是 final reply
      assistant('a3', [{ type: 'thinking', thinking: 'tail' }]),
      u('u2'),
      assistant('a4', [{ type: 'toolCall', toolCallId: 't2', toolName: 'y', input: {} }]),
      assistant('a5', 'after2'),
      assistant('a6', 'final2'),
    ]
    expect(flatten(processGroups(msgs))).toEqual([
      'm[u1]',
      'g[a1,a2,a3]',
      'm[u2]',
      'g[a4,a5]',
      'm[a6]',
    ])
  })

  it('单条 assistant - 不折叠', () => {
    expect(flatten(processGroups([u('u1'), assistant('a1', 'plain text')]))).toEqual([
      'm[u1]', 'm[a1]',
    ])
  })

  it('2 条 + 工具 - 不折叠 (segment <3)', () => {
    const msgs = [
      u('u1'),
      assistant('a1', [{ type: 'toolCall', toolCallId: 't', toolName: 'x', input: {} }]),
      assistant('a2', [{ type: 'thinking', thinking: 'tail' }]),
    ]
    expect(flatten(processGroups(msgs))).toEqual([
      'm[u1]',
      'm[a1]',
      'm[a2]',
    ])
  })

  it('toolResult message(role=tool) 平铺', () => {
    const tool: AgentMessage = {
      id: 't1', role: 'tool',
      content: '[bash] ls result', createdAt: 't',
    }
    const out = processGroups([u('u1'), tool])
    expect(out).toEqual([
      { type: 'message', message: u('u1'), inProcessDetails: false },
      { type: 'message', message: tool, inProcessDetails: false },
    ])
  })

  it('3 条全 thinking → displayable 不够 → 平铺', () => {
    const msgs = [
      u('u1'),
      assistant('a1', [{ type: 'thinking', thinking: 'r1' }]),
      assistant('a2', [{ type: 'thinking', thinking: 'r2' }]),
      assistant('a3', [{ type: 'thinking', thinking: 'r3' }]),
    ]
    expect(flatten(processGroups(msgs))).toEqual([
      'm[u1]',
      'm[a1]',
      'm[a2]',
      'm[a3]',
    ])
  })

  it('3 条 + last thinking → 全 3 进 group', () => {
    const msgs = [
      u('u1'),
      assistant('a1', [{ type: 'text', text: 'a1' }, { type: 'toolCall', toolCallId: 't', toolName: 'x', input: {} }]),
      assistant('a2', 'intermediate'),
      assistant('a3', [{ type: 'thinking', thinking: 'tail' }]),
    ]
    expect(flatten(processGroups(msgs))).toEqual([
      'm[u1]',
      'g[a1,a2,a3]',
    ])
  })
})
