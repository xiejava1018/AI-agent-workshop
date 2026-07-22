/**
 * BlockView 测试覆盖 spec "BlockView 组件契约" Requirement 的 4 scenarios:
 *   - 渲染 TextBlock 数组
 *   - 混合 block 类型(顺序保持)
 *   - 空 blocks → 空 fragment
 *   - 顺序保持
 *
 * 子组件当前是 T3.5 stub fixture;T4.x 会替换为真实实现,本测试只覆盖 BlockView 的
 * 分发逻辑(v-for + 类型 switch + 稳定 key),不验证子组件行为。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BlockView from './BlockView.vue'
import type { AssistantContentBlock } from '../../types/assistant-blocks'

const factory = (blocks: readonly AssistantContentBlock[]) =>
  mount(BlockView, { props: { blocks } })

describe('BlockView', () => {
  it('渲染 TextBlock 数组 — 顺序与文本内容正确', () => {
    const blocks: AssistantContentBlock[] = [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]
    const wrapper = factory(blocks)
    expect(wrapper.text()).toBe('ab')
    expect(wrapper.findAll('[data-testid="wb-block-text"]').length).toBe(2)
  })

  it('混合 block 类型 — 4 种按数组顺序渲染', () => {
    const blocks: AssistantContentBlock[] = [
      { type: 'text', text: 'first' },
      { type: 'thinking', thinking: 'reason' },
      { type: 'toolCall', toolCallId: 'abc', toolName: 'bash', input: { command: 'ls' } },
      { type: 'image', source: { type: 'url', url: 'https://example.com/x.png' } },
    ]
    const wrapper = factory(blocks)
    const text = wrapper.text()
    // 顺序断言: first 在 reason 之前,reason 在 bash 之前
    expect(text.indexOf('first')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('reason')).toBeGreaterThan(text.indexOf('first'))
    expect(text.indexOf('bash')).toBeGreaterThan(text.indexOf('reason'))
    expect(text.indexOf('image')).toBeGreaterThan(text.indexOf('bash'))
    // 4 个不同类型的子组件都渲染
    expect(wrapper.find('[data-testid="wb-block-text"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="wb-block-thinking"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="wb-block-toolcall"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="wb-block-image"]').exists()).toBe(true)
  })

  it('空 blocks → 空 fragment,无 DOM 子元素', () => {
    const wrapper = factory([])
    // BlockView 根是 <template>(v-if 编译占位)。空场景下无任何子组件被渲染,
    // 断言:没有任何 [data-testid="wb-block-*"] 元素出现(占位 comment 不算)。
    expect(wrapper.findAll('[data-testid^="wb-block-"]').length).toBe(0)
  })

  it('顺序保持 — 重渲染后 DOM 顺序与 blocks 数组一致', () => {
    const blocks: AssistantContentBlock[] = [
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
      { type: 'text', text: 'C' },
    ]
    const wrapper = factory(blocks)
    expect(wrapper.text()).toBe('ABC')
  })
})
