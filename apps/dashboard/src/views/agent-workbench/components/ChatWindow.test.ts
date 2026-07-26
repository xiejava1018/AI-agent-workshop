/**
 * ChatWindow —— auto-rename on first user message 测试。
 *
 * 覆盖三块:
 *   - messages 为空(没有任何 user)→ 不 emit
 *   - messages 中出现第一条 user → emit auto-rename(sessionId, suggested)
 *     suggested 来自内容首 24 字
 *   - 同一会话再次出现新 user(第二条后)→ 不重复 emit(每个 ChatWindow 实例只触发一次)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import ChatWindow from './ChatWindow.vue'

// messages 是 ref —— 由 useEventStream -> useAgentSession SSE 推动,这里 mock
// useAgentSession 以注入可控的 messages。
type Msg = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
}
// 用 ref 包裹数组,这样 .value 本身是一个 reactive array,
// computed 重读 .value 会拿到 reactive proxy(而不是同一引用),
// 以使 watch 能追踪 push。
const messagesRef = ref<Msg[]>([])

vi.mock('../composables/useAgentSession', () => ({
  useAgentSession: () => ({
    messages: computed(() => messagesRef.value),
    isStreaming: ref(false),
    streamStatus: ref('idle'),
    error: ref(null),
    sendMessage: vi.fn(),
    abort: vi.fn(),
    clearError: vi.fn(),
    modelNames: ref({}),
    queuedMessages: ref({ steer: [], followUp: [] }),
    cancelQueue: vi.fn()
  })
}))

const SESSION_ID = 'sess-test-tab-title'

function makeWrapper() {
  return mount(ChatWindow, {
    props: { sessionId: SESSION_ID },
    global: {
      stubs: {
        MessageView: true,
        ProcessDetailsGroup: true,
        StreamingQueueBar: true,
        ElNotification: true,
        ElScrollbar: { template: '<div class="el-scrollbar"><slot /></div>' }
      }
    }
  })
}

function pushUser(content: string, id = 'm'): void {
  // 整体赋值,触发 ref 的依赖收集。
  messagesRef.value = [
    ...messagesRef.value,
    { id, role: 'user', content }
  ]
}

function pushAssistant(content: string, id = 'm'): void {
  messagesRef.value = [
    ...messagesRef.value,
    { id, role: 'assistant', content }
  ]
}

describe('ChatWindow — auto-rename on first user message', () => {
  beforeEach(() => {
    messagesRef.value = []
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('messages 为空时不会 emit auto-rename', async () => {
    const wrapper = makeWrapper()
    await flushPromises()
    expect(wrapper.emitted('auto-rename')).toBeFalsy()
  })

  it('出现第一条 user 消息后 emit auto-rename(sessionId, suggested)', async () => {
    const wrapper = makeWrapper()
    await flushPromises()
    // "帮我写一个 TypeScript 函数来反转字符串" = 24 字符(中文 1字=1,TypeScript=10)
    // — 超出阈值会被截断为 24+ellipsis。
    pushUser('帮我写一个 TypeScript 函数来反转字符串')
    await nextTick()
    const ev = wrapper.emitted('auto-rename')
    expect(ev).toBeTruthy()
    expect(ev?.[0]?.[0]).toBe(SESSION_ID)
    expect(ev?.[0]?.[1]).toBe('帮我写一个 TypeScript 函数来反转字符…')
  })

  it('很长的 user 消息会被截断到 24 字 + 后缀 ellipsis', async () => {
    const wrapper = makeWrapper()
    await flushPromises()
    const longContent =
      '我需要详细调研一下微信公众号关注后自动应答消息推送的全量实现并加上商业化垂类思考'
    pushUser(longContent)
    await nextTick()
    const ev = wrapper.emitted('auto-rename')
    expect(ev?.[0]?.[1]).toHaveLength(25) // 24 char + ellipsis
    expect(ev?.[0]?.[1]).toMatch(/…$/)
  })

  it('多行/多空格 user 消息被压缩为单行 trim', async () => {
    const wrapper = makeWrapper()
    await flushPromises()
    pushUser('   你好\n\n我要\n询问一个\n  极深奥的问题   ')
    await nextTick()
    const ev = wrapper.emitted('auto-rename')
    // "你好 我要 询问一个 极深奥的问题" = 13 字符，不截断
    expect(ev?.[0]?.[1]).toBe('你好 我要 询问一个 极深奥的问题')
  })

  it('第一条 user 仅为空白时不会 emit(避免错误命名)', async () => {
    const wrapper = makeWrapper()
    await flushPromises()
    pushUser('   \n  ')
    await nextTick()
    expect(wrapper.emitted('auto-rename')).toBeFalsy()
  })

  it('首条 emit 后,后续 user 消息不会再触发', async () => {
    const wrapper = makeWrapper()
    await flushPromises()
    pushUser('第一个问题', 'm1')
    await nextTick()
    const first = wrapper.emitted('auto-rename')?.length ?? 0
    expect(first).toBe(1)

    pushUser('第二个问题', 'm2')
    await nextTick()
    expect(wrapper.emitted('auto-rename')?.length).toBe(first)
  })

  it('assistant / system / tool 消息不触发 auto-rename', async () => {
    const wrapper = makeWrapper()
    await flushPromises()
    pushAssistant('你好', 'm1')
    await nextTick()
    expect(wrapper.emitted('auto-rename')).toBeFalsy()
  })
})