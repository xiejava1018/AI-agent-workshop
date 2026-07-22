/**
 * ProcessDetailsGroup — 折叠面板组件契约测试。
 *
 * 覆盖:
 *   - 默认折叠 counts 正确
 *   - 点击展开 body 出现
 *   - defaultOpen: true 初始即展开
 *   - toolCall 计数:array 形态中的 toolCall block 累加
 *   - toolCalls snapshot 字段兼容
 *   - empty messages 退化
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProcessDetailsGroup from './ProcessDetailsGroup.vue'
import type { AgentMessage } from '../types'

const a = (content: AgentMessage['content'], id?: string): AgentMessage => ({
  id: id ?? `a-${Math.random().toString(36).slice(2, 8)}`,
  role: 'assistant',
  content,
  createdAt: '2026-07-22T00:00:00.000Z',
})

const messages = [
  a([
    { type: 'text', text: 'a1' },
    { type: 'toolCall', toolCallId: 't1', toolName: 'bash', input: {} },
    { type: 'toolCall', toolCallId: 't2', toolName: 'ls', input: {} },
  ]),
  a([{ type: 'text', text: 'a2' }]),
  a([
    { type: 'text', text: 'a3' },
    { type: 'toolCall', toolCallId: 't3', toolName: 'echo', input: {} },
  ]),
]

describe('ProcessDetailsGroup', () => {
  it('默认折叠,header 显示正确 counts', () => {
    const w = mount(ProcessDetailsGroup, {
      props: { messages },
      slots: { default: '<div class="child-stub">child</div>' },
    })
    expect(w.find('.wb-process-details__label').text()).toBe('Process details')
    expect(w.text()).toContain('3 messages')
    expect(w.text()).toContain('3 tool calls')
    // body 不渲染
    expect(w.find('.wb-process-details__body').exists()).toBe(false)
  })

  it('点击 header 展开 body', async () => {
    const w = mount(ProcessDetailsGroup, {
      props: { messages },
      slots: { default: '<div class="child-stub">child content</div>' },
    })
    expect(w.find('.wb-process-details__body').exists()).toBe(false)
    await w.find('.wb-process-details__header').trigger('click')
    expect(w.find('.wb-process-details__body').exists()).toBe(true)
    expect(w.text()).toContain('child content')
    // chevron 旋转 90 度
    const chev = w.find('.wb-process-details__chevron') as unknown as { element: SVGElement & { style: { transform: string } } }
    expect(chev.element.style.transform).toBe('rotate(90deg)')
    // 再点击折叠回
    await w.find('.wb-process-details__header').trigger('click')
    expect(w.find('.wb-process-details__body').exists()).toBe(false)
  })

  it('defaultOpen: true 初始即展开', () => {
    const w = mount(ProcessDetailsGroup, {
      props: { messages, defaultOpen: true },
      slots: { default: 'X' },
    })
    expect(w.find('.wb-process-details__body').exists()).toBe(true)
    expect(w.text()).toContain('X')
    const chev = w.find('.wb-process-details__chevron') as unknown as { element: SVGElement & { style: { transform: string } } }
    expect(chev.element.style.transform).toBe('rotate(90deg)')
  })

  it('toolCalls snapshot 字段兼容 (snapshot 数组也算)', () => {
    const legacy = a('legacy text', 'legacy')
    ;(legacy as { toolCalls?: unknown }).toolCalls = [
      { id: 's1', name: 'bash', status: 'done' },
      { id: 's2', name: 'ls', status: 'done' },
    ]
    const w = mount(ProcessDetailsGroup, { props: { messages: [legacy] } })
    expect(w.text()).toContain('1 message')
    expect(w.text()).toContain('2 tool calls')
  })

  it('empty messages 退化(0 messages,0 tool calls)', () => {
    const w = mount(ProcessDetailsGroup, { props: { messages: [] } })
    expect(w.text()).toContain('0 messages')
    // 0 tool calls 时省略工具计数文案(条件渲染)
    expect(w.text()).not.toContain('tool calls')
  })

  it('仅有 1 条 message 不省略 tool calls 计数', () => {
    const w = mount(ProcessDetailsGroup, {
      props: { messages: [a([{ type: 'toolCall', toolCallId: 'x', toolName: 'go', input: {} }])] },
    })
    expect(w.text()).toContain('1 message')
    expect(w.text()).toContain('1 tool call') // 单数
  })

  it('header button aria-expanded', async () => {
    const w = mount(ProcessDetailsGroup, { props: { messages } })
    const btn = w.find('.wb-process-details__header')
    expect(btn.attributes('aria-expanded')).toBe('false')
    await btn.trigger('click')
    expect(btn.attributes('aria-expanded')).toBe('true')
  })
})
