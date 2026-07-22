/**
 * BlockView 测试覆盖 spec "BlockView 组件契约" Requirement 的 4 scenarios:
 *   - 渲染 TextBlock 数组
 *   - 混合 block 类型(顺序保持)
 *   - 空 blocks → 空 fragment
 *   - 顺序保持
 *
 * 用 findComponent 抓真实子组件,验证 BlockView 分发正确传 props,
 * 不验证子组件的内部 UI(子组件各自的测试在 G4 子单元测试中)。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BlockView from './BlockView.vue'
import TextBlock from './TextBlock.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolCallBlock from './ToolCallBlock.vue'
import ImageBlock from './ImageBlock.vue'
import type { AssistantContentBlock } from '../../types/assistant-blocks'

const factory = (blocks: readonly AssistantContentBlock[]) =>
  mount(BlockView, { props: { blocks } })

describe('BlockView', () => {
  it('渲染 TextBlock 数组 — 两个 TextBlock 接对 block props', () => {
    const blocks: AssistantContentBlock[] = [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]
    const wrapper = factory(blocks)
    const textChildren = wrapper.findAllComponents(TextBlock)
    expect(textChildren.length).toBe(2)
    expect(textChildren[0]?.props('block')).toEqual({ type: 'text', text: 'a' })
    expect(textChildren[1]?.props('block')).toEqual({ type: 'text', text: 'b' })
    expect(wrapper.findAllComponents(ThinkingBlock).length).toBe(0)
    expect(wrapper.findAllComponents(ToolCallBlock).length).toBe(0)
    expect(wrapper.findAllComponents(ImageBlock).length).toBe(0)
  })

  it('混合 block 类型 — 4 种子组件都被分发,且 props 正确', () => {
    const blocks: AssistantContentBlock[] = [
      { type: 'text', text: 'first' },
      { type: 'thinking', thinking: 'reason' },
      { type: 'toolCall', toolCallId: 'abc', toolName: 'bash', input: { command: 'ls' } },
      { type: 'image', source: { type: 'url', url: 'https://example.com/x.png' } },
    ]
    const wrapper = factory(blocks)
    expect(wrapper.findAllComponents(TextBlock).length).toBe(1)
    expect(wrapper.findAllComponents(ThinkingBlock).length).toBe(1)
    expect(wrapper.findAllComponents(ToolCallBlock).length).toBe(1)
    expect(wrapper.findAllComponents(ImageBlock).length).toBe(1)
    expect(wrapper.findComponent(TextBlock).props('block'))
      .toEqual({ type: 'text', text: 'first' })
    expect(wrapper.findComponent(ThinkingBlock).props('block'))
      .toEqual({ type: 'thinking', thinking: 'reason' })
    expect(wrapper.findComponent(ToolCallBlock).props('block'))
      .toEqual({ type: 'toolCall', toolCallId: 'abc', toolName: 'bash', input: { command: 'ls' } })
    expect(wrapper.findComponent(ImageBlock).props('block'))
      .toEqual({ type: 'image', source: { type: 'url', url: 'https://example.com/x.png' } })
  })

  it('空 blocks → 无子组件', () => {
    const wrapper = factory([])
    expect(wrapper.findAllComponents(TextBlock).length).toBe(0)
    expect(wrapper.findAllComponents(ThinkingBlock).length).toBe(0)
    expect(wrapper.findAllComponents(ToolCallBlock).length).toBe(0)
    expect(wrapper.findAllComponents(ImageBlock).length).toBe(0)
  })

  it('顺序保持 — 3 个 text 按数组顺序分发', () => {
    const blocks: AssistantContentBlock[] = [
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
      { type: 'text', text: 'C' },
    ]
    const wrapper = factory(blocks)
    const texts = wrapper.findAllComponents(TextBlock)
    expect(texts.length).toBe(3)
    expect((texts[0]?.props('block') as { text: string }).text).toBe('A')
    expect((texts[1]?.props('block') as { text: string }).text).toBe('B')
    expect((texts[2]?.props('block') as { text: string }).text).toBe('C')
  })
})
