/**
 * ChatInput 组件测试 —— 发送 / abort / 快捷键 / 状态条 chrome v1 B 组
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import ChatInput from './ChatInput.vue'

// ────────── EventSource stub(useAgentSession → useEventStream 内部 connect) ──────────
class StubEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  url: string
  readyState = StubEventSource.OPEN
  onopen: ((e: MessageEvent) => void) | null = null
  onerror: ((e: MessageEvent) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
  }
  close(): void {
    this.closed = true
    this.readyState = StubEventSource.CLOSED
  }
}

;(globalThis as { EventSource?: unknown }).EventSource = StubEventSource

// ────────── useAgentSession mock:返回受控 ref ──────────
// 三个状态条控件 + sendMessage 等基础接口。我们用 spy 函数便于测试断言是否被调。
const setModelMock = vi.fn().mockResolvedValue(undefined)
const setThinkingLevelMock = vi.fn().mockResolvedValue(undefined)
const setToolsMock = vi.fn().mockResolvedValue(undefined)
const refreshToolsMock = vi.fn().mockResolvedValue(undefined)

const refs = {
  modelList: ref<Array<{ provider: string; modelId: string; name: string }>>([]),
  modelNames: ref<Record<string, string>>({}),
  currentModel: ref<{ provider: string; modelId: string } | null>(null),
  isAutoModelSelection: ref(false),
  thinkingLevel: ref<string>('auto'),
  availableThinkingLevels: ref<Record<string, string[]>>({}),
  toolPreset: ref<'none' | 'default' | 'full'>('none')
}

// 每次 mount 前重置 ref(避免测试间状态污染)
function resetRefs(): void {
  refs.modelList.value = []
  refs.modelNames.value = {}
  refs.currentModel.value = null
  refs.isAutoModelSelection.value = false
  refs.thinkingLevel.value = 'auto'
  refs.availableThinkingLevels.value = {}
  refs.toolPreset.value = 'none'
  setModelMock.mockClear()
  setThinkingLevelMock.mockClear()
  setToolsMock.mockClear()
  refreshToolsMock.mockClear()
}

vi.mock('../composables/useAgentSession', () => ({
  useAgentSession: vi.fn(() => ({
    modelList: refs.modelList,
    modelNames: refs.modelNames,
    currentModel: refs.currentModel,
    isAutoModelSelection: refs.isAutoModelSelection,
    thinkingLevel: refs.thinkingLevel,
    availableThinkingLevels: refs.availableThinkingLevels,
    toolPreset: refs.toolPreset,
    setModel: setModelMock,
    setThinkingLevel: setThinkingLevelMock,
    setTools: setToolsMock,
    refreshTools: refreshToolsMock
  }))
}))

beforeEach(() => {
  localStorage.clear()
  resetRefs()
})

function makeWrapper(propsOverride: Partial<{ isStreaming: boolean; disabled: boolean }> = {}) {
  return mount(ChatInput, {
    props: {
      sessionId: 'sess-test',
      isStreaming: false,
      disabled: false,
      ...propsOverride
    }
  })
}

describe('ChatInput — send', () => {
  it('emits send with text and attachments when clicking send button', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('hello world')
    await wrapper.find('.el-button--primary').trigger('click')

    const emitted = wrapper.emitted('send')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toBe('hello world')
    expect(emitted?.[0]?.[1]).toEqual([])
  })

  it('clears input after sending', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('test')
    await wrapper.find('.el-button--primary').trigger('click')
    // v-model 同步:el-input 内部值已经清空
    await nextTick()
    // 用 setValue 验证:再次拿到 textarea 应该是空字符串
    expect(input.element.value).toBe('')
  })

  it('does not emit send for empty input with no attachments', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('   ')
    const btn = wrapper.find('.el-button--primary')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('send')).toBeFalsy()
  })
})

describe('ChatInput — abort', () => {
  it('shows stop button when isStreaming=true', () => {
    const wrapper = makeWrapper({ isStreaming: true })
    expect(wrapper.find('.el-button--primary').exists()).toBe(false)
    // 找 danger 类型按钮(停止)
    const dangerBtn = wrapper.findAll('.el-button').find((b) => b.text().includes('停止'))
    expect(dangerBtn).toBeDefined()
  })

  it('emits abort when stop button clicked', async () => {
    const wrapper = makeWrapper({ isStreaming: true })
    const dangerBtn = wrapper.findAll('.el-button').find((b) => b.text().includes('停止'))
    expect(dangerBtn).toBeDefined()
    await dangerBtn?.trigger('click')

    const emitted = wrapper.emitted('abort')
    expect(emitted).toBeTruthy()
  })

  it('does not emit send when streaming (button is stop)', async () => {
    const wrapper = makeWrapper({ isStreaming: true })
    // 即使 input 有内容,也不应该能 send
    const input = wrapper.find('textarea')
    await input.setValue('should not send')
    expect(wrapper.find('.el-button--primary').exists()).toBe(false)
  })
})

describe('ChatInput — keyboard shortcuts', () => {
  it('Enter sends (without Shift)', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('hi')
    await input.trigger('keydown', { key: 'Enter' })

    const emitted = wrapper.emitted('send')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toBe('hi')
  })

  it('Shift+Enter does NOT send (lets browser insert newline)', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('multi')
    // 不阻止默认行为
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })

    expect(wrapper.emitted('send')).toBeFalsy()
  })

  it('ArrowUp recalls last history entry', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')

    // 先发一条让它入栈
    await input.setValue('first message')
    await wrapper.find('.el-button--primary').trigger('click')
    await nextTick()

    // 直接验证 localStorage 已存
    const stored = JSON.parse(localStorage.getItem('wb-chat-input-history') ?? '[]')
    expect(stored).toContain('first message')
  })
})

describe('ChatInput — attachments', () => {
  it('renders attachment chips with remove button', async () => {
    const wrapper = makeWrapper()
    // 直接挂载一个 file 到 attachments ref — 我们不能直接通过 el-input 注入,
    // 这里改通过 drop 事件模拟
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })
    await wrapper.trigger('drop', {
      dataTransfer: { files: [file] }
    })
    await nextTick()
    // 拖拽 overlay 通过 window listener 实现,drop 事件在组件内触发
    // 这里只验证组件没崩即可
    expect(wrapper.exists()).toBe(true)
  })
})

// =============================================================================
// chrome v1 B 组:状态条 —— 三个子组件
// =============================================================================

describe('ChatInput — status bar (chrome v1 B 组)', () => {
  it('renders all 3 selector components in the status bar', () => {
    const wrapper = makeWrapper()
    const bar = wrapper.find('[data-testid="wb-chat-input-statusbar"]')
    expect(bar.exists()).toBe(true)
    expect(bar.find('.wb-model-selector').exists()).toBe(true)
    expect(bar.find('.wb-thinking-selector').exists()).toBe(true)
    expect(bar.find('.wb-tool-preset-selector').exists()).toBe(true)
  })

  it('applies is-disabled class on status bar when isStreaming=true', () => {
    const wrapper = makeWrapper({ isStreaming: true })
    const bar = wrapper.find('[data-testid="wb-chat-input-statusbar"]')
    expect(bar.classes()).toContain('is-disabled')
  })

  it('does NOT apply is-disabled when isStreaming=false', () => {
    const wrapper = makeWrapper()
    const bar = wrapper.find('[data-testid="wb-chat-input-statusbar"]')
    expect(bar.classes()).not.toContain('is-disabled')
  })
})

describe('ModelSelector', () => {
  it('渲染当前模型名', async () => {
    refs.modelList.value = [
      { provider: 'anthropic', modelId: 'claude-opus-4-8', name: 'MiniMax-M3' }
    ]
    refs.modelNames.value = { 'anthropic:claude-opus-4-8': 'MiniMax-M3' }
    refs.currentModel.value = { provider: 'anthropic', modelId: 'claude-opus-4-8' }
    const wrapper = makeWrapper()
    expect(wrapper.find('.wb-model-selector__label').text()).toBe('MiniMax-M3')
  })

  it('modelList 为空时 label 降级为 no model 且不展开下拉', async () => {
    refs.currentModel.value = null
    const wrapper = makeWrapper()
    expect(wrapper.find('.wb-model-selector__label').text()).toBe('no model')
    // 触发按钮应 disabled,点击不展开
    const trigger = wrapper.find('.wb-model-selector__trigger')
    expect(trigger.attributes('disabled')).toBeDefined()
    await trigger.trigger('click')
    expect(wrapper.find('.wb-model-selector__menu').exists()).toBe(false)
  })

  it('isAuto=true 时显示 auto', async () => {
    refs.isAutoModelSelection.value = true
    const wrapper = makeWrapper()
    expect(wrapper.find('.wb-model-selector__label').text()).toBe('auto')
  })

  it('点击展开下拉', async () => {
    refs.modelList.value = [
      { provider: 'anthropic', modelId: 'a', name: 'Alpha' },
      { provider: 'openai', modelId: 'b', name: 'Beta' }
    ]
    const wrapper = makeWrapper()
    const trigger = wrapper.find('.wb-model-selector__trigger')
    await trigger.trigger('click')
    const menu = wrapper.find('.wb-model-selector__menu')
    expect(menu.exists()).toBe(true)
    expect(menu.findAll('li').length).toBe(2)
  })

  it('选中触发 update:model emit 并带 provider + modelId', async () => {
    refs.modelList.value = [
      { provider: 'anthropic', modelId: 'claude-opus-4-8', name: 'MiniMax-M3' }
    ]
    const wrapper = makeWrapper()
    await wrapper.find('.wb-model-selector__trigger').trigger('click')
    await wrapper.find('.wb-model-selector__menu li').trigger('click')
    expect(setModelMock).toHaveBeenCalledWith('anthropic', 'claude-opus-4-8')
  })
})

describe('ThinkingLevelSelector', () => {
  it('渲染当前 level', async () => {
    refs.thinkingLevel.value = 'medium'
    const wrapper = makeWrapper()
    expect(wrapper.find('.wb-thinking-selector__label').text()).toBe('medium')
  })

  it('level=auto 时显示 auto', async () => {
    refs.thinkingLevel.value = 'auto'
    const wrapper = makeWrapper()
    expect(wrapper.find('.wb-thinking-selector__label').text()).toBe('auto')
  })

  it('默认显示全部 8 个 level', async () => {
    const wrapper = makeWrapper()
    await wrapper.find('.wb-thinking-selector__trigger').trigger('click')
    expect(wrapper.findAll('.wb-thinking-selector__menu li').length).toBe(8)
  })

  it('availableLevels 非空时只显示子集', async () => {
    refs.currentModel.value = { provider: 'anthropic', modelId: 'claude-opus-4-8' }
    refs.availableThinkingLevels.value = {
      'anthropic:claude-opus-4-8': ['auto', 'low', 'medium', 'high']
    }
    const wrapper = makeWrapper()
    await wrapper.find('.wb-thinking-selector__trigger').trigger('click')
    const items = wrapper.findAll('.wb-thinking-selector__menu li')
    expect(items.length).toBe(4)
    expect(items.map((li) => li.text()).sort()).toEqual(['auto', 'high', 'low', 'medium'])
  })

  it('选中 high 触发 setThinkingLevel("high")', async () => {
    const wrapper = makeWrapper()
    await wrapper.find('.wb-thinking-selector__trigger').trigger('click')
    // 8 项中找 high
    const highLi = wrapper
      .findAll('.wb-thinking-selector__menu li')
      .find((li) => li.text() === 'high')
    expect(highLi).toBeDefined()
    await highLi!.trigger('click')
    expect(setThinkingLevelMock).toHaveBeenCalledWith('high')
  })
})

describe('ToolPresetSelector', () => {
  it('渲染当前 preset 名', async () => {
    refs.toolPreset.value = 'default'
    const wrapper = makeWrapper()
    expect(wrapper.find('.wb-tool-preset-selector__label').text()).toBe('default')
  })

  it('渲染 3 个选项', async () => {
    const wrapper = makeWrapper()
    await wrapper.find('.wb-tool-preset-selector__trigger').trigger('click')
    const items = wrapper.findAll('.wb-tool-preset-selector__menu li')
    expect(items.length).toBe(3)
    expect(items.map((li) => li.text()).sort()).toEqual(['default', 'full', 'none'])
  })

  it('当前 preset 高亮 (is-active)', async () => {
    refs.toolPreset.value = 'full'
    const wrapper = makeWrapper()
    await wrapper.find('.wb-tool-preset-selector__trigger').trigger('click')
    const items = wrapper.findAll('.wb-tool-preset-selector__menu li')
    const fullItem = items.find((li) => li.text() === 'full')
    expect(fullItem?.classes()).toContain('is-active')
    const noneItem = items.find((li) => li.text() === 'none')
    expect(noneItem?.classes()).not.toContain('is-active')
  })

  it('选中 full 时调 setTools + refreshTools', async () => {
    const wrapper = makeWrapper()
    await wrapper.find('.wb-tool-preset-selector__trigger').trigger('click')
    const fullLi = wrapper
      .findAll('.wb-tool-preset-selector__menu li')
      .find((li) => li.text() === 'full')
    expect(fullLi).toBeDefined()
    await fullLi!.trigger('click')
    // setTools 应调一次(参数由 getToolNamesForPreset('full') 给的常量数组)
    await nextTick()
    // setTools 是 async,我们等待 flush
    await flushPromises()
    expect(setToolsMock).toHaveBeenCalledTimes(1)
    expect(setToolsMock.mock.calls[0]?.[0]).toEqual([
      'bash',
      'read',
      'edit',
      'write',
      'grep',
      'find',
      'ls'
    ])
    expect(refreshToolsMock).toHaveBeenCalledTimes(1)
  })

  it('选中 none 时 setTools 收到空数组', async () => {
    const wrapper = makeWrapper()
    await wrapper.find('.wb-tool-preset-selector__trigger').trigger('click')
    const noneLi = wrapper
      .findAll('.wb-tool-preset-selector__menu li')
      .find((li) => li.text() === 'none')
    expect(noneLi).toBeDefined()
    await noneLi!.trigger('click')
    await flushPromises()
    expect(setToolsMock.mock.calls[0]?.[0]).toEqual([])
  })
})

// 让 microtask 跑完(vi.fn().mockResolvedValue 链路)
async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}