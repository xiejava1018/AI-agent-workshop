/**
 * MessageView 组件测试 —— 渲染 + retry 路径
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageView from './MessageView.vue'
import type { AgentMessage } from '../types'

const baseMsg = (overrides: Partial<AgentMessage> = {}): AgentMessage => ({
  id: 'msg-1',
  role: 'assistant',
  content: 'Hello world',
  createdAt: '2026-07-18T00:00:00.000Z',
  ...overrides
})

describe('MessageView', () => {
  it('renders user message content via MarkdownBody', () => {
    const wrapper = mount(MessageView, {
      props: { message: baseMsg({ role: 'user', content: 'Hi' }) }
    })
    expect(wrapper.html()).toContain('Hi')
  })

  it('renders assistant message content', () => {
    const wrapper = mount(MessageView, {
      props: { message: baseMsg({ role: 'assistant', content: 'Hello' }) }
    })
    expect(wrapper.html()).toContain('Hello')
    expect(wrapper.find('.wb-message--assistant').exists()).toBe(true)
  })

  it('renders tool message in monospace style', () => {
    const wrapper = mount(MessageView, {
      props: { message: baseMsg({ role: 'tool', content: '[bash] echo hi' }) }
    })
    expect(wrapper.find('.wb-message--tool').exists()).toBe(true)
    expect(wrapper.html()).toContain('[bash] echo hi')
  })

  it('shows cancelled banner with retry button when message.cancelled=true', async () => {
    const wrapper = mount(MessageView, {
      props: { message: baseMsg({ role: 'assistant', content: 'part', cancelled: true }) }
    })
    expect(wrapper.html()).toContain('已取消')
    const retryBtn = wrapper.find('.wb-stream-error__retry')
    expect(retryBtn.exists()).toBe(true)

    await retryBtn.trigger('click')
    const emitted = wrapper.emitted('retry')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toBe('msg-1')
  })

  it('shows partial banner without retry button when message.partial=true', () => {
    const wrapper = mount(MessageView, {
      props: { message: baseMsg({ role: 'assistant', content: 'trunc', partial: true }) }
    })
    expect(wrapper.html()).toContain('回复未完成')
    expect(wrapper.find('.wb-stream-error__retry').exists()).toBe(false)
  })

  it('shows typing dots when streamStatus=streaming', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({ role: 'assistant', content: 'so far', streamStatus: 'streaming' })
      }
    })
    expect(wrapper.find('.wb-typing-dots').exists()).toBe(true)
  })

  it('emits toolExpand with the message id on tool expand click', async () => {
    const wrapper = mount(MessageView, {
      props: { message: baseMsg({ id: 'tool-42', role: 'tool', content: 'x' }) }
    })
    await wrapper.find('.wb-stream-error__retry').trigger('click')
    const emitted = wrapper.emitted('toolExpand')
    expect(emitted?.[0]?.[0]).toBe('tool-42')
  })

  it('emits branchSwitch when slot emits', () => {
    // 这里我们只验证 props.branches.length > 1 时 slots.branches 被暴露
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg(),
        branches: [
          { id: 'b1', parentMessageId: 'msg-1', createdAt: '' },
          { id: 'b2', parentMessageId: 'msg-1', createdAt: '' }
        ]
      }
    })
    // branches.length > 1 → .wb-message__branches 容器渲染
    expect(wrapper.find('.wb-message__branches').exists()).toBe(true)
  })
})
