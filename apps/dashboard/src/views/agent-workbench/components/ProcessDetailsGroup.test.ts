/**
 * ProcessDetailsGroup — 折叠面板组件契约测试(新 API:messageCount + toolCallCount)。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProcessDetailsGroup from './ProcessDetailsGroup.vue'

describe('ProcessDetailsGroup', () => {
  it('默认折叠,header 显示正确 counts', () => {
    const w = mount(ProcessDetailsGroup, {
      props: { messageCount: 3, toolCallCount: 2 },
      slots: { default: '<div class="child-stub">child</div>' },
    })
    expect(w.find('.wb-process-details__label').text()).toBe('Process details')
    expect(w.text()).toContain('3 messages')
    expect(w.text()).toContain('2 tool calls')
    expect(w.find('.wb-process-details__body').exists()).toBe(false)
  })

  it('点击 header 展开 body', async () => {
    const w = mount(ProcessDetailsGroup, {
      props: { messageCount: 1, toolCallCount: 1 },
      slots: { default: '<div class="child-stub">child content</div>' },
    })
    expect(w.find('.wb-process-details__body').exists()).toBe(false)
    await w.find('.wb-process-details__header').trigger('click')
    expect(w.find('.wb-process-details__body').exists()).toBe(true)
    expect(w.text()).toContain('child content')
    const chev = w.find('.wb-process-details__chevron') as unknown as { element: SVGElement & { style: { transform: string } } }
    expect(chev.element.style.transform).toBe('rotate(90deg)')
    await w.find('.wb-process-details__header').trigger('click')
    expect(w.find('.wb-process-details__body').exists()).toBe(false)
  })

  it('defaultOpen: true 初始即展开', () => {
    const w = mount(ProcessDetailsGroup, {
      props: { messageCount: 1, toolCallCount: 1, defaultOpen: true },
      slots: { default: 'X' },
    })
    expect(w.find('.wb-process-details__body').exists()).toBe(true)
  })

  it('toolCallCount=0 时省略工具计数文案', () => {
    const w = mount(ProcessDetailsGroup, {
      props: { messageCount: 2, toolCallCount: 0 },
    })
    expect(w.text()).toContain('2 messages')
    expect(w.text()).not.toContain('tool call')
  })

  it('单数 messageCount 显示 "1 message"', () => {
    const w = mount(ProcessDetailsGroup, {
      props: { messageCount: 1, toolCallCount: 1 },
    })
    expect(w.text()).toContain('1 message')
    expect(w.text()).toContain('1 tool call')
  })

  it('header button aria-expanded', async () => {
    const w = mount(ProcessDetailsGroup, {
      props: { messageCount: 1, toolCallCount: 0 },
    })
    const btn = w.find('.wb-process-details__header')
    expect(btn.attributes('aria-expanded')).toBe('false')
    await btn.trigger('click')
    expect(btn.attributes('aria-expanded')).toBe('true')
  })
})
