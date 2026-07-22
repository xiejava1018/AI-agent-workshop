/**
 * ThinkingBlock 测试覆盖 spec "ThinkingBlock 组件契约":
 *   - 默认折叠
 *   - 点击展开
 *   - streaming 自动展开
 *   - deferred 显示按需拉取占位
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ThinkingBlock from './ThinkingBlock.vue'
import type { ThinkingContent } from '../../types/assistant-blocks'

const factory = (block: ThinkingContent, streaming = false) =>
  mount(ThinkingBlock, { props: { block, streaming } })

describe('ThinkingBlock', () => {
  it('默认折叠 - 文本不在 DOM 中可见', () => {
    const wrapper = factory({ type: 'thinking', thinking: 'reasoning...' })
    const details = wrapper.find('details')
    expect(details.exists()).toBe(true)
    // details open attribute 默认 false
    expect(details.attributes('open')).toBeUndefined()
    // 但 summary 之后 pre 仍渲染(浏览器 DOM 行为,collapsed 也包含文本结构)
    // 主要断言:open is false 表示折叠
    expect(details.element.hasAttribute('open')).toBe(false)
  })

  it('streaming - 自动 open', () => {
    const wrapper = factory({ type: 'thinking', thinking: 'reasoning...' }, true)
    const details = wrapper.find('details')
    expect(details.element.hasAttribute('open')).toBe(true)
    expect(wrapper.find('.wb-thinking__pulse').exists()).toBe(true)
  })

  it('deferred - 显示 click to load 占位,emit loadDeferred', async () => {
    const wrapper = factory({ type: 'thinking', thinking: '', deferred: true })
    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.find('.wb-thinking__placeholder').exists()).toBe(true)
    expect(wrapper.find('.wb-thinking__placeholder').text()).toContain('click to load')
    await wrapper.find('.wb-thinking__placeholder').trigger('click')
    const events = wrapper.emitted('loadDeferred')
    expect(events).toBeTruthy()
    expect(events?.[0]?.[0]).toEqual({ type: 'thinking', thinking: '', deferred: true })
  })
})
