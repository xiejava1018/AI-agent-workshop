/**
 * CompactButton —— 上下文压缩按钮的三态测试。
 * 对齐 apps/web/components/ChatInput.tsx 第 1779-1857 行的 compact 按钮。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CompactButton from './CompactButton.vue'

function makeProps(overrides: Partial<{
  isCompacting: boolean
  compactError: string | null
  disabledByStreaming: boolean
}> = {}) {
  return {
    isCompacting: false,
    compactError: null,
    disabledByStreaming: false,
    ...overrides
  }
}

describe('CompactButton', () => {
  it('idle 态:显示 "Compact" + 双向收缩箭头 icon', () => {
    const wrapper = mount(CompactButton, { props: makeProps() })
    // 文字标签
    expect(wrapper.find('.wb-compact__label').text()).toBe('Compact')
    // SVG 是双向收缩箭头(有 4 个 polyline/line 子元素)
    const svg = wrapper.find('.wb-compact__btn svg')
    expect(svg.exists()).toBe(true)
    // aria-label 是「压缩上下文」
    expect(wrapper.find('.wb-compact__btn').attributes('aria-label')).toBe('压缩上下文')
  })

  it('running 态:显示 "压缩中…" + 红色样式 + 实心方块 icon,点击触发 abort-compact', async () => {
    const wrapper = mount(CompactButton, { props: makeProps({ isCompacting: true }) })

    expect(wrapper.find('.wb-compact__btn').classes()).toContain('is-running')
    expect(wrapper.find('.wb-compact__label').text()).toBe('压缩中…')
    // aria-label 变 "停止压缩"
    expect(wrapper.find('.wb-compact__btn').attributes('aria-label')).toBe('停止压缩')

    await wrapper.find('.wb-compact__btn').trigger('click')
    const emitted = wrapper.emitted('abort-compact')
    expect(emitted).toBeTruthy()
    expect(wrapper.emitted('compact')).toBeFalsy()
  })

  it('idle 态点击触发 compact 事件', async () => {
    const wrapper = mount(CompactButton, { props: makeProps() })
    await wrapper.find('.wb-compact__btn').trigger('click')
    expect(wrapper.emitted('compact')).toBeTruthy()
    expect(wrapper.emitted('abort-compact')).toBeFalsy()
  })

  it('流式期间 idle 态 disabled,点击不会 emit', async () => {
    const wrapper = mount(CompactButton, {
      props: makeProps({ disabledByStreaming: true })
    })
    const btn = wrapper.find('.wb-compact__btn')
    expect(btn.attributes('disabled')).toBeDefined()
    await btn.trigger('click')
    expect(wrapper.emitted('compact')).toBeFalsy()
  })

  it('流式期间 running 态仍可点击触发 abort-compact', async () => {
    const wrapper = mount(CompactButton, {
      props: makeProps({ isCompacting: true, disabledByStreaming: true })
    })
    const btn = wrapper.find('.wb-compact__btn')
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    expect(wrapper.emitted('abort-compact')).toBeTruthy()
  })

  it('compactError 非空时显示错误 tooltip', async () => {
    const wrapper = mount(CompactButton, {
      props: makeProps({ compactError: '后端超时' })
    })
    const tip = wrapper.find('.wb-compact__error-tooltip')
    expect(tip.exists()).toBe(true)
    expect(tip.text()).toBe('后端超时')
  })

  it('compactError 清空后 tooltip 消失', async () => {
    const wrapper = mount(CompactButton, {
      props: makeProps({ compactError: '先报错' })
    })
    expect(wrapper.find('.wb-compact__error-tooltip').exists()).toBe(true)
    await wrapper.setProps({ compactError: null })
    expect(wrapper.find('.wb-compact__error-tooltip').exists()).toBe(false)
  })
})
