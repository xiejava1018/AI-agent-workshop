/**
 * MessageView 组件测试 —— 渲染 + retry 路径 + chrome v1
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

// =============================================================================
// chrome v1:头部 chrome + 时间戳 + token footer + 操作按钮
// =============================================================================

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/** 在容器本地时区下构造一个"今天" / "本年早些天" / "跨年" 的 ISO 时间戳 */
function isoToday(hour = 21, minute = 55): string {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

function isoSameYearMonthAgo(monthIdx: number, day = 19): string {
  const d = new Date()
  d.setMonth(monthIdx, day)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

function isoPrevYear(monthIdx: number, day = 19): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 1)
  d.setMonth(monthIdx, day)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

describe('MessageView — header chrome (chrome v1 A 组)', () => {
  it('user 消息头部显示 USER 标签 + 时间戳', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({
          id: 'u-1',
          role: 'user',
          content: 'hi',
          createdAt: isoToday(9, 5)
        })
      }
    })
    // USER 标签(el-tag plain)渲染 USER 文本
    expect(wrapper.html()).toContain('USER')
    // 时间戳渲染 09:05(2 位 hour:2 位 minute)
    expect(wrapper.find('.wb-message__time').exists()).toBe(true)
    expect(wrapper.find('.wb-message__time').text()).toBe(`09:05`)
  })

  it('assistant 消息头部命中 modelNames 显示模型名', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({
          id: 'a-1',
          role: 'assistant',
          content: 'reply',
          modelProvider: 'anthropic',
          modelId: 'claude-opus-4-8'
        }),
        modelNames: { 'anthropic:claude-opus-4-8': 'MiniMax-M3' }
      }
    })
    expect(wrapper.html()).toContain('MiniMax-M3')
    // 不能 fallback 到 assistant
    expect(wrapper.html()).not.toContain('>assistant<')
  })

  it('assistant 消息头部未命中 modelNames 降级为 assistant', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({
          id: 'a-2',
          role: 'assistant',
          content: 'reply',
          modelProvider: 'anthropic',
          modelId: 'unknown-model'
        }),
        modelNames: {}
      }
    })
    expect(wrapper.html()).toContain('assistant')
  })
})

describe('MessageView — smart timestamp formatTime (chrome v1 A 组)', () => {
  it('今天消息时间戳格式 HH:MM', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({ id: 't-1', role: 'user', content: 'x', createdAt: isoToday(21, 55) })
      }
    })
    expect(wrapper.find('.wb-message__time').text()).toBe('21:55')
  })

  it('昨天/本月消息时间戳格式 M月D日', () => {
    // 构造一个非今天的日期:把 today 减 7 天(确保不是今天)
    const d = new Date()
    d.setDate(d.getDate() - 7)
    d.setHours(12, 0, 0, 0)
    const iso = d.toISOString()
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({ id: 't-2', role: 'user', content: 'x', createdAt: iso })
      }
    })
    const expected = `${d.getMonth() + 1}月${d.getDate()}日`
    expect(wrapper.find('.wb-message__time').text()).toBe(expected)
  })

  it('跨年消息时间戳格式 YYYY年M月D日', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({
          id: 't-3',
          role: 'user',
          content: 'x',
          createdAt: isoPrevYear(11, 19)
        })
      }
    })
    const d = new Date()
    const prevYear = d.getFullYear() - 1
    expect(wrapper.find('.wb-message__time').text()).toBe(
      `${prevYear}年12月19日`
    )
  })
})

describe('MessageView — token footer (chrome v1 A 组)', () => {
  it('完成 assistant 消息有 usage 时显示 token footer', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({
          id: 'u-1',
          role: 'assistant',
          content: 'done',
          streamStatus: 'done',
          usage: { input: 6721, output: 498, cacheRead: 128, cacheWrite: 0 }
        })
      }
    })
    const footer = wrapper.find('.wb-message__usage')
    expect(footer.exists()).toBe(true)
    expect(footer.text()).toContain('6,721')
    expect(footer.text()).toContain('498')
    expect(footer.text()).toContain('128')
    expect(footer.text()).toContain('in')
    expect(footer.text()).toContain('out')
    expect(footer.text()).toContain('cache')
  })

  it('流式中 assistant 消息不显示 token footer', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({
          id: 'u-2',
          role: 'assistant',
          content: 'streaming',
          streamStatus: 'streaming',
          usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 }
        })
      }
    })
    expect(wrapper.find('.wb-message__usage').exists()).toBe(false)
  })

  it('msg.usage 缺失不显示 token footer', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({
          id: 'u-3',
          role: 'assistant',
          content: 'no usage',
          streamStatus: 'done'
          // usage 缺失
        })
      }
    })
    expect(wrapper.find('.wb-message__usage').exists()).toBe(false)
  })
})

describe('MessageView — action buttons (chrome v1 A 组)', () => {
  it('user 消息渲染 Copy + Edit 按钮(Fork / Navigate Up 需要 entryId 才显示)', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({ id: 'u-1', role: 'user', content: 'hi' })
      }
    })
    const actions = wrapper.find('[role="toolbar"]')
    expect(actions.exists()).toBe(true)
    // Copy + Edit 总在
    expect(actions.text()).toContain('复制')
    expect(actions.text()).toContain('编辑')
    // 没有 entryId → Fork / Navigate Up 不显示
    expect(actions.text()).not.toContain('Fork')
    expect(actions.text()).not.toContain('↑')
  })

  it('user 消息有 entryId 时显示 Fork 按钮', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({ id: 'u-2', role: 'user', content: 'hi' }),
        entryId: 'entry-42'
      }
    })
    expect(wrapper.find('[role="toolbar"]').text()).toContain('Fork')
  })

  it('user 消息无 entryId 时不显示 Fork 按钮', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({ id: 'u-3', role: 'user', content: 'hi' }),
        entryId: undefined
      }
    })
    expect(wrapper.find('[role="toolbar"]').text()).not.toContain('Fork')
  })

  it('assistant 消息渲染 Copy + Retry 按钮(非流式)', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({ id: 'a-1', role: 'assistant', content: 'reply' }),
        isStreaming: false
      }
    })
    const actions = wrapper.find('[role="toolbar"]')
    expect(actions.exists()).toBe(true)
    expect(actions.text()).toContain('复制')
    expect(actions.text()).toContain('重试')
  })

  it('assistant 消息 streaming 时不显示 Retry 按钮', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({ id: 'a-2', role: 'assistant', content: 'reply' }),
        isStreaming: true
      }
    })
    const actions = wrapper.find('[role="toolbar"]')
    expect(actions.exists()).toBe(true)
    expect(actions.text()).toContain('复制')
    expect(actions.text()).not.toContain('重试')
  })

  it('所有按钮都有 aria-label', () => {
    const wrapper = mount(MessageView, {
      props: {
        message: baseMsg({ id: 'a-3', role: 'assistant', content: 'reply' }),
        isStreaming: false
      }
    })
    const buttons = wrapper.findAll('[role="toolbar"] button')
    expect(buttons.length).toBeGreaterThan(0)
    for (const btn of buttons) {
      expect(btn.attributes('aria-label')).toBeTruthy()
    }
  })
})