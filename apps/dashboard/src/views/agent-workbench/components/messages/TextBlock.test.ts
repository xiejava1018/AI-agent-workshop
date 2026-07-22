/**
 * TextBlock 测试覆盖 spec "TextBlock 组件契约"。
 * TextBlock 是 MarkdownBody 的纯转发 + 不附加 chrome。
 * 留 happy-dom-friendly 断言(具体 markdown DOM 渲染由 markdown-it 决定,关心 chrome-free 即可)。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TextBlock from './TextBlock.vue'
import MarkdownBody from '../MarkdownBody.vue'

const factory = (text: string) =>
  mount(TextBlock, { props: { block: { type: 'text', text } } })

describe('TextBlock', () => {
  it('把 block.text 转发到 MarkdownBody', () => {
    const wrapper = factory('plain text')
    const md = wrapper.findComponent(MarkdownBody)
    expect(md.exists()).toBe(true)
    expect(md.props('content')).toBe('plain text')
  })

  it('不附加 chrome - 没有 header / footer / USER 标签', () => {
    const wrapper = factory('plain')
    expect(wrapper.find('.wb-message__role-tag').exists()).toBe(false)
    expect(wrapper.find('.wb-message__header').exists()).toBe(false)
    expect(wrapper.find('.wb-message__usage').exists()).toBe(false)
  })
})
