/**
 * ToolCallBlock 测试覆盖 spec "ToolCallBlock 组件契约":
 *   - 执行中:spinner,无 pairedResult,不可折叠
 *   - 已完成:summary 行 + 展开显示 input + paired result
 *   - copy 按钮触发 navigator.clipboard.writeText
 *
 * 注意:navigator.clipboard 在 happy-dom 默认存在但 mock 行为受限。
 * 我们使用 vi.stubGlobal 模拟 navigator.clipboard 写。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolCallBlock from './ToolCallBlock.vue'
import type { ToolCallContent } from '../../types/assistant-blocks'

const block: ToolCallContent = {
  type: 'toolCall',
  toolCallId: 'abc',
  toolName: 'bash',
  input: { command: 'echo hello' },
}

const factory = (pairedResults?: Map<string, unknown>) => {
  const props: Record<string, unknown> = { block }
  if (pairedResults) props['pairedResults'] = pairedResults
  return mount(ToolCallBlock, { props })
}

let writeText: ReturnType<typeof vi.fn>
let read: () => string

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
  read = () => writeText.mock.calls[0]?.[0] as string
  // happy-dom 把 navigator.clipboard 定义为只读 getter,直接用 Object.defineProperty 覆盖
  // (单纯赋值会在 else 分支 throw)
  try {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    })
  } catch {
    // fall back to mutating if there's no getter (older happy-dom)
    Object.defineProperty(navigator, 'clipboard', {
      get() { return { writeText } },
      configurable: true,
    })
  }
})

afterEach(() => {
  writeText.mockReset()
})

describe('ToolCallBlock', () => {
  it('执行中 - spinner,无 details 折叠', () => {
    const wrapper = factory(undefined)
    expect(wrapper.find('.wb-toolcall__spinner').exists()).toBe(true)
    expect(wrapper.find('details').exists()).toBe(false)
  })

  it('已完成 - 折叠 summary + 展开显示 input 与 result', async () => {
    const paired = new Map<string, unknown>([
      ['abc', { toolCallId: 'abc', content: 'hello\n', isError: false }],
    ])
    const wrapper = factory(paired)
    expect(wrapper.find('details').exists()).toBe(true)
    expect(wrapper.text()).toContain('[bash]')
    expect(wrapper.text()).toContain('abc')
    expect(wrapper.find('.wb-toolcall__copy').exists()).toBe(true)
    // 点击 summary 展开 details(input/result 文本应出现在 DOM 文本中)
    await wrapper.find('summary').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('command')
    expect(wrapper.text()).toContain('hello')
  })

  it('copy 按钮 - 调 navigator.clipboard.writeText 携带正确 payload', async () => {
    const paired = new Map<string, unknown>([
      ['abc', { toolCallId: 'abc', content: 'hello\n', isError: false }],
    ])
    const wrapper = factory(paired)
    await wrapper.find('.wb-toolcall__copy').trigger('click')
    expect(writeText).toHaveBeenCalledOnce()
    const payload = JSON.parse(read())
    expect(payload.toolCallId).toBe('abc')
    expect(payload.toolName).toBe('bash')
    expect(payload.input).toEqual({ command: 'echo hello' })
    expect(payload.result).toBe('hello\n')
    expect(payload.isError).toBe(false)
  })
})
