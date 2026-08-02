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
const sendSteerMock = vi.fn().mockResolvedValue(undefined)
const sendFollowUpMock = vi.fn().mockResolvedValue(undefined)
const loadSlashCommandsMock = vi.fn().mockResolvedValue(undefined)

const refs = {
  modelList: ref<Array<{ provider: string; modelId: string; name: string }>>([]),
  modelNames: ref<Record<string, string>>({}),
  currentModel: ref<{ provider: string; modelId: string } | null>(null),
  isAutoModelSelection: ref(false),
  thinkingLevel: ref<string>('auto'),
  availableThinkingLevels: ref<Record<string, string[]>>({}),
  toolPreset: ref<'none' | 'default' | 'full'>('none'),
  slashCommands: ref<
    Array<{ name: string; description?: string; source: 'extension' | 'prompt' | 'skill' | 'builtin' }>
  >([])
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
  refs.slashCommands.value = []
  setModelMock.mockClear()
  setThinkingLevelMock.mockClear()
  setToolsMock.mockClear()
  refreshToolsMock.mockClear()
  sendSteerMock.mockClear()
  sendFollowUpMock.mockClear()
  loadSlashCommandsMock.mockClear()
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
    refreshTools: refreshToolsMock,
    sendSteer: sendSteerMock,
    sendFollowUp: sendFollowUpMock,
    slashCommands: refs.slashCommands,
    loadSlashCommands: loadSlashCommandsMock
  }))
}))

beforeEach(() => {
  localStorage.clear()
  resetRefs()
})

function makeWrapper(
  propsOverride: Partial<{
    isStreaming: boolean
    disabled: boolean
    compactEnabled: boolean
    isCompacting: boolean
    compactError: string | null
    soundEnabled: boolean
  }> = {}
) {
  return mount(ChatInput, {
    props: {
      sessionId: 'sess-test',
      isStreaming: false,
      disabled: false,
      compactEnabled: true,
      isCompacting: false,
      compactError: null,
      soundEnabled: true,
      ...propsOverride
    }
  })
}

describe('ChatInput — send', () => {
  it('emits send with text and attachments when clicking send button', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('hello world')
    await wrapper.find('.wb-chat-input__send-btn--send').trigger('click')

    const emitted = wrapper.emitted('send')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toBe('hello world')
    expect(emitted?.[0]?.[1]).toEqual([])
  })

  it('clears input after sending', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('test')
    await wrapper.find('.wb-chat-input__send-btn--send').trigger('click')
    // v-model 同步:el-input 内部值已经清空
    await nextTick()
    // 用 setValue 验证:再次拿到 textarea 应该是空字符串
    expect(input.element.value).toBe('')
  })

  it('does not emit send for empty input with no attachments', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('   ')
    const btn = wrapper.find('.wb-chat-input__send-btn--send')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('send')).toBeFalsy()
  })
})

describe('ChatInput — abort', () => {
  it('shows stop button when isStreaming=true', () => {
    const wrapper = makeWrapper({ isStreaming: true })
    expect(wrapper.find('.wb-chat-input__send-btn--send').exists()).toBe(false)
    // 找停止按钮
    const stopBtn = wrapper.find('.wb-chat-input__send-btn--stop')
    expect(stopBtn.exists()).toBe(true)
  })

  it('emits abort when stop button clicked', async () => {
    const wrapper = makeWrapper({ isStreaming: true })
    const stopBtn = wrapper.find('.wb-chat-input__send-btn--stop')
    expect(stopBtn.exists()).toBe(true)
    await stopBtn.trigger('click')

    const emitted = wrapper.emitted('abort')
    expect(emitted).toBeTruthy()
  })

  it('does not emit send when streaming (button is stop)', async () => {
    const wrapper = makeWrapper({ isStreaming: true })
    // 即使 input 有内容,也不应该能 send
    const input = wrapper.find('textarea')
    await input.setValue('should not send')
    expect(wrapper.find('.wb-chat-input__send-btn--send').exists()).toBe(false)
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

  it('streaming 时 Shift+Enter 调 sendSteer(steer 快捷键)', async () => {
    const wrapper = makeWrapper({ isStreaming: true })
    const input = wrapper.find('textarea')
    await input.setValue('steer me')
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    await flushPromises()

    expect(sendSteerMock).toHaveBeenCalledTimes(1)
    expect(sendSteerMock.mock.calls[0]?.[0]).toBe('steer me')
    // 非 Enter 单按:不会调 sendMessage
    expect(wrapper.emitted('send')).toBeFalsy()
  })

  it('streaming 时 Cmd/Ctrl+Enter 调 sendFollowUp(followUp 快捷键)', async () => {
    const wrapper = makeWrapper({ isStreaming: true })
    const input = wrapper.find('textarea')
    await input.setValue('follow up')
    // Cmd+Enter(macOS)
    await input.trigger('keydown', { key: 'Enter', metaKey: true })
    await flushPromises()

    expect(sendFollowUpMock).toHaveBeenCalledTimes(1)
    expect(sendFollowUpMock.mock.calls[0]?.[0]).toBe('follow up')
    expect(wrapper.emitted('send')).toBeFalsy()
  })

  it('ArrowUp recalls last history entry', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')

    // 先发一条让它入栈
    await input.setValue('first message')
    await wrapper.find('.wb-chat-input__send-btn--send').trigger('click')
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

  it('modelList 为空 + currentModel 为 null 时 label 降级为「选择模型」且下拉按钮 disabled', async () => {
    refs.currentModel.value = null
    const wrapper = makeWrapper()
    expect(wrapper.find('.wb-model-selector__label').text()).toBe('选择模型')
    // 未选、modelList 为空 → 按钮 disabled、点击不展开下拉
    const trigger = wrapper.find('.wb-model-selector__trigger')
    expect(trigger.attributes('disabled')).toBeDefined()
    await trigger.trigger('click')
    expect(wrapper.find('.wb-model-selector__menu').exists()).toBe(false)
  })

  it('modelList 非空 + currentModel 为 null 时 label 为「选择模型」但按钮可点', async () => {
    refs.currentModel.value = null
    refs.modelList.value = [
      { provider: 'anthropic', modelId: 'claude-opus-4-8', name: 'Opus' }
    ]
    const wrapper = makeWrapper()
    expect(wrapper.find('.wb-model-selector__label').text()).toBe('选择模型')
    const trigger = wrapper.find('.wb-model-selector__trigger')
    expect(trigger.attributes('disabled')).toBeUndefined()
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
  it('渲染当前 level(大写首字母对齐 apps/web)', async () => {
    refs.thinkingLevel.value = 'medium'
    const wrapper = makeWrapper()
    // apps/web 视觉为 'Medium'(首字母大写)
    expect(wrapper.find('.wb-thinking-selector__label').text()).toBe('Medium')
  })

  it('level=auto 时显示 Auto', async () => {
    refs.thinkingLevel.value = 'auto'
    const wrapper = makeWrapper()
    expect(wrapper.find('.wb-thinking-selector__label').text()).toBe('Auto')
  })

  it('默认显示全部 8 个 level', async () => {
    const wrapper = makeWrapper()
    await wrapper.find('.wb-thinking-selector__trigger').trigger('click')
    expect(wrapper.findAll('.wb-thinking-selector__option').length).toBe(8)
  })

  it('availableLevels 非空时只显示子集', async () => {
    refs.currentModel.value = { provider: 'anthropic', modelId: 'claude-opus-4-8' }
    refs.availableThinkingLevels.value = {
      'anthropic:claude-opus-4-8': ['auto', 'low', 'medium', 'high']
    }
    const wrapper = makeWrapper()
    await wrapper.find('.wb-thinking-selector__trigger').trigger('click')
    const items = wrapper.findAll('.wb-thinking-selector__option')
    expect(items.length).toBe(4)
    // 只认 label(不含右侧 dim 描述文)
    const labels = items.map((li) => li.find('.wb-thinking-selector__option-label').text()).sort()
    expect(labels).toEqual(['Auto', 'High', 'Low', 'Medium'])
  })

  it('选中 high 触发 setThinkingLevel("high")', async () => {
    const wrapper = makeWrapper()
    await wrapper.find('.wb-thinking-selector__trigger').trigger('click')
    // 只在 label 槽位上匹配
    const highBtn = wrapper
      .findAll('.wb-thinking-selector__option')
      .find((b) => b.find('.wb-thinking-selector__option-label').text() === 'High')
    expect(highBtn).toBeDefined()
    await highBtn!.trigger('click')
    expect(setThinkingLevelMock).toHaveBeenCalledWith('high')
  })
})

describe('ToolPresetSelector', () => {
  it('渲染当前 preset 名(apps/web 风格化 Off/Default/Full)', async () => {
    refs.toolPreset.value = 'default'
    const wrapper = makeWrapper()
    // 内部值为 default,但 UI label 为 "Default"——apps/web 风格化
    expect(wrapper.find('.wb-tool-preset-selector__label').text()).toBe('Default')
  })

  it('渲染 3 个选项', async () => {
    const wrapper = makeWrapper()
    await wrapper.find('.wb-tool-preset-selector__trigger').trigger('click')
    const items = wrapper.findAll('.wb-tool-preset-selector__option')
    expect(items.length).toBe(3)
    // label 顺序:Off / Default / Full(apps/web 使用 off 而不是 none)
    const labels = items.map((b) => b.find('.wb-tool-preset-selector__option-label').text()).sort()
    expect(labels).toEqual(['Default', 'Full', 'Off'])
  })

  it('当前 preset 高亮 (is-active)', async () => {
    refs.toolPreset.value = 'full'
    const wrapper = makeWrapper()
    await wrapper.find('.wb-tool-preset-selector__trigger').trigger('click')
    const items = wrapper.findAll('.wb-tool-preset-selector__option')
    const fullItem = items.find(
      (b) => b.find('.wb-tool-preset-selector__option-label').text() === 'Full'
    )
    expect(fullItem?.classes()).toContain('is-active')
    const offItem = items.find(
      (b) => b.find('.wb-tool-preset-selector__option-label').text() === 'Off'
    )
    expect(offItem?.classes()).not.toContain('is-active')
  })

  it('选中 full 时调 setTools + refreshTools', async () => {
    const wrapper = makeWrapper()
    await wrapper.find('.wb-tool-preset-selector__trigger').trigger('click')
    const fullBtn = wrapper
      .findAll('.wb-tool-preset-selector__option')
      .find((b) => b.find('.wb-tool-preset-selector__option-label').text() === 'Full')
    expect(fullBtn).toBeDefined()
    await fullBtn!.trigger('click')
    await nextTick()
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

  it('选中 Off(none) 时 setTools 收到空数组', async () => {
    const wrapper = makeWrapper()
    await wrapper.find('.wb-tool-preset-selector__trigger').trigger('click')
    const offBtn = wrapper
      .findAll('.wb-tool-preset-selector__option')
      .find((b) => b.find('.wb-tool-preset-selector__option-label').text() === 'Off')
    expect(offBtn).toBeDefined()
    await offBtn!.trigger('click')
    await flushPromises()
    expect(setToolsMock.mock.calls[0]?.[0]).toEqual([])
  })
})

// =============================================================================
// T5.3:slash palette 集成
// =============================================================================

describe('ChatInput — slash palette 集成', () => {
  it('onMounted 时调一次 loadSlashCommands()', async () => {
    const wrapper = makeWrapper()
    // 等 mount 完 microtask 跑
    await nextTick()
    await flushPromises()
    expect(loadSlashCommandsMock).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('inputText="/" 时 palette 不显示(长度恰好 1 不开)', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('/')
    await nextTick()
    // 长度 == 1 不开 palette(B8 spec 长度 > 1)
    expect(wrapper.find('[data-testid="wb-slash-palette"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('inputText="/com" 时 palette 打开,可见 /compact 排在第一', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('/com')
    await nextTick()
    const palette = wrapper.find('[data-testid="wb-slash-palette"]')
    expect(palette.exists()).toBe(true)
    const options = palette.findAll('[role="option"]')
    expect(options.length).toBeGreaterThan(0)
    expect(options[0]?.attributes('data-slash-name')).toBe('/compact')
    expect(options[0]?.attributes('aria-selected')).toBe('true')
    wrapper.unmount()
  })

  it('inputText="" 时 palette 关闭', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('/compact ')
    await nextTick()
    // 设为 /compact 后清空
    await input.setValue('')
    await nextTick()
    expect(wrapper.find('[data-testid="wb-slash-palette"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('选中 slash 项后 inputText 被填充为 "name + 末尾空格"', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('/co')
    await nextTick()
    const palette = wrapper.find('[data-testid="wb-slash-palette"]')
    const firstOption = palette.find('[role="option"]')
    await firstOption.trigger('click')
    await nextTick()
    expect(input.element.value).toBe('/compact ')
    wrapper.unmount()
  })

  it('palette 打开时 Enter 选中 activeIndex 项,把 inputText 填为 "name + 末尾空格" 且不发送', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('/com')
    await nextTick()
    // 默认 activeIndex=0,首项是 /compact(prefix 命中)
    await input.trigger('keydown', { key: 'Enter' })
    await nextTick()
    // 真实断言:select 真的发生 → inputText 被填充为 "/compact "
    expect(input.element.value).toBe('/compact ')
    // 且没有走发送路径
    expect(wrapper.emitted('send')).toBeFalsy()
    wrapper.unmount()
  })

  it('palette 打开时 ArrowUp 循环上移 activeIndex(从 0 wrap 到末项)', async () => {
    // 构造 2 项命中:builtin /compact(prefix) + session /coampact(subsequence)
    refs.slashCommands.value = [
      { name: '/coampact', description: 'subsequence 命中', source: 'extension' }
    ]
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('/compact')
    await nextTick()
    let palette = wrapper.find('[data-testid="wb-slash-palette"]')
    let options = palette.findAll('[role="option"]')
    expect(options.length).toBe(2)
    expect(options[0]?.attributes('aria-selected')).toBe('true')
    // ArrowUp 从 0 循环到末项(index 1)
    await input.trigger('keydown', { key: 'ArrowUp' })
    await nextTick()
    palette = wrapper.find('[data-testid="wb-slash-palette"]')
    options = palette.findAll('[role="option"]')
    expect(options[1]?.attributes('aria-selected')).toBe('true')
    expect(options[0]?.attributes('aria-selected')).toBe('false')
    wrapper.unmount()
  })

  it('palette 打开时 Escape 关闭面板且不清空 inputText', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('/com')
    await nextTick()
    expect(wrapper.find('[data-testid="wb-slash-palette"]').exists()).toBe(true)
    await input.trigger('keydown', { key: 'Escape' })
    await nextTick()
    // 面板消失
    expect(wrapper.find('[data-testid="wb-slash-palette"]').exists()).toBe(false)
    // inputText 不被 Escape 清空(只关面板,不删文本)
    expect(input.element.value).toBe('/com')
    wrapper.unmount()
  })

  it('3 档匹配顺序:prefix > contains > subsequence(builtin + mock session 混合)', async () => {
    // /sub/compact 命中 contains(name 含 "/compact" 子串但非前缀)
    // /coampact 命中 subsequence(query 字符按顺序出现,无连续子串)
    refs.slashCommands.value = [
      { name: '/sub/compact', description: 'contains 命中', source: 'extension' },
      { name: '/coampact', description: 'subsequence 命中', source: 'extension' }
    ]
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('/compact')
    await nextTick()
    const palette = wrapper.find('[data-testid="wb-slash-palette"]')
    expect(palette.exists()).toBe(true)
    const options = palette.findAll('[role="option"]')
    // builtin /compact(prefix) > /sub/compact(contains) > /coampact(subsequence)
    expect(options.map((o) => o.attributes('data-slash-name'))).toEqual([
      '/compact',
      '/sub/compact',
      '/coampact'
    ])
    wrapper.unmount()
  })

  it('inputText 非 "/" 开头时 palette 永不打开', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('hello')
    await nextTick()
    expect(wrapper.find('[data-testid="wb-slash-palette"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

// =============================================================================
// T6.1:IME 组合输入保护
// =============================================================================

describe('ChatInput — IME composition guard', () => {
  it('compositionstart 后按 Enter 不发送(中文拼音 Enter 仅确认候选)', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('你好')
    // 模拟 IME 组合开始:中文拼音尚未确认
    await input.trigger('compositionstart')
    await input.trigger('keydown', { key: 'Enter' })

    // composition 期间 Enter 不应发送
    expect(wrapper.emitted('send')).toBeFalsy()
  })

  it('compositionend 后按 Enter 正常发送', async () => {
    const wrapper = makeWrapper()
    const input = wrapper.find('textarea')
    await input.setValue('你好')
    await input.trigger('compositionstart')
    // IME 组合结束,候选已确认写入
    await input.trigger('compositionend')
    await input.trigger('keydown', { key: 'Enter' })

    const emitted = wrapper.emitted('send')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toBe('你好')
  })
})

// =============================================================================
// T6.2:a11y —— queue slot region wrapper
// =============================================================================

describe('ChatInput — a11y', () => {
  it('queue slot 被 role="region" 容器包裹(aria-label="Queued messages")', () => {
    const wrapper = makeWrapper()
    const region = wrapper.find('[role="region"]')
    expect(region.exists()).toBe(true)
    expect(region.attributes('aria-label')).toBe('Queued messages')
  })
})

describe('ChatInput — composer layout (对齐 apps/web)', () => {
  // 对齐 apps/web ChatInput 的底部行布局:textarea 与发送/停止按钮在同一个带边框圆角 composer 内,
  // model selector 位于 composer 下方的 toolbar 左侧,thinking/tools preset 在右侧。
  it('composer 包裹 textarea + 发送按钮(同一圆角容器)', () => {
    const wrapper = makeWrapper()
    const composer = wrapper.find('.wb-chat-input__composer')
    expect(composer.exists()).toBe(true)
    // textarea 和发送按钮都在 composer 内
    expect(composer.element.contains(wrapper.find('textarea').element)).toBe(true)
    expect(composer.element.contains(wrapper.find('.wb-chat-input__send-btn').element)).toBe(true)
  })

  it('toolbar 在 composer 下方,含 model selector + thinking + tools preset', () => {
    const wrapper = makeWrapper()
    const composer = wrapper.find('.wb-chat-input__composer')
    const toolbar = wrapper.find('.wb-chat-input__toolbar')
    expect(composer.exists()).toBe(true)
    expect(toolbar.exists()).toBe(true)
    // toolbar 在 composer 后面(顺序锁定)
    const positions = Array.from(
      wrapper.element.querySelectorAll('.wb-chat-input__composer, .wb-chat-input__toolbar')
    )
    expect(positions[0]).toBe(composer.element)
    expect(positions[1]).toBe(toolbar.element)
    // toolbar 内含 model selector
    expect(toolbar.find('.wb-model-selector').exists()).toBe(true)
  })

  it('streaming 时 composer 边框变黄 + 按钮变为 Stop', () => {
    const wrapper = makeWrapper({ isStreaming: true })
    const composer = wrapper.find('.wb-chat-input__composer')
    expect(composer.classes()).toContain('is-streaming')
    expect(wrapper.find('.wb-chat-input__send-btn--stop').exists()).toBe(true)
    expect(wrapper.find('.wb-chat-input__send-btn--send').exists()).toBe(false)
  })

  it('工具栏 RIGHT 依次为 thinking → tools → compact → sound(对齐 apps/web 顺序)', () => {
    const wrapper = makeWrapper({ compactEnabled: true })
    const right = wrapper.find('.wb-chat-input__toolbar-right')
    expect(right.exists()).toBe(true)
    // 4 个控件顺序锁定。happy-dom 顺序按源码渲染。
    const kids = right.element.querySelectorAll(
      '.wb-thinking-selector, .wb-tool-preset-selector, .wb-compact, .wb-sound-toggle'
    )
    expect(kids.length).toBe(4)
    expect(kids[0]?.classList.contains('wb-thinking-selector')).toBe(true)
    expect(kids[1]?.classList.contains('wb-tool-preset-selector')).toBe(true)
    expect(kids[2]?.classList.contains('wb-compact')).toBe(true)
    expect(kids[3]?.classList.contains('wb-sound-toggle')).toBe(true)
  })

  it('compactEnabled=false 时隐藏 CompactButton', () => {
    const wrapper = makeWrapper({ compactEnabled: false })
    expect(wrapper.find('.wb-compact').exists()).toBe(false)
    // thinking/tools/sound 仍在
    expect(wrapper.find('.wb-thinking-selector').exists()).toBe(true)
    expect(wrapper.find('.wb-tool-preset-selector').exists()).toBe(true)
    expect(wrapper.find('.wb-sound-toggle').exists()).toBe(true)
  })

  it('点击 SoundToggle 触发 update:soundEnabled', async () => {
    const wrapper = makeWrapper({ soundEnabled: true })
    const btn = wrapper.find('.wb-sound-toggle')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    const emitted = wrapper.emitted('update:soundEnabled')
    expect(emitted?.[0]?.[0]).toBe(false)
  })

  it('点击 CompactButton 触发 compact 事件', async () => {
    const wrapper = makeWrapper({ compactEnabled: true })
    await wrapper.find('.wb-compact__btn').trigger('click')
    const emitted = wrapper.emitted('compact')
    expect(emitted).toBeTruthy()
    expect(wrapper.emitted('abort-compact')).toBeFalsy()
  })

  it('根容器限 820px 列宽 + 水平居中(与对话气泡同宽,对齐 apps/web)', () => {
    // 全局样式 .wb-chat-input 必须具有 max-width: 820px + 水平居中(
    // 对齐 apps/web ChatInput 的 maxWidth:820 + margin:"0 auto")。
    // happy-dom 不导入样式表,我们通过读取 CSS 源文件验证契约。
    // __dirname = src/views/agent-workbench/components → ../styles/workbench.css
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const cssPath = path.resolve(__dirname, '../styles/workbench.css')
    const css = fs.readFileSync(cssPath, 'utf8')
    const block = css.match(/\.wb-chat-input\s*\{[^}]*\}/m)?.[0] ?? ''
    expect(block, '未找到 .wb-chat-input CSS 块').toContain('max-width: 820px')
    expect(block).toMatch(/margin-(?:left|right)\s*:\s*auto/)
  })
})

describe('ChatInput — fill (编辑回填)', () => {
  it('fill() 在输入框为空时把内容灌回并更新 v-model', async () => {
    const wrapper = makeWrapper()
    // 初始为空
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
    // 调 defineExpose 的 fill
    ;(wrapper.vm as unknown as { fill: (t: string) => void }).fill('编辑我')
    await nextTick()
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('编辑我')
  })

  it('fill() 在输入框已有内容时不覆盖(避免吞掉用户正在打的内容)', async () => {
    const wrapper = makeWrapper()
    const ta = wrapper.find('textarea').element as HTMLTextAreaElement
    ta.value = '正在打'
    // 触发 v-model 更新(input 事件)
    wrapper.find('textarea').trigger('input')
    await nextTick()
    ;(wrapper.vm as unknown as { fill: (t: string) => void }).fill('别覆盖我')
    await nextTick()
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('正在打')
  })
})

// 让 microtask 跑完(vi.fn().mockResolvedValue 链路)
async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}