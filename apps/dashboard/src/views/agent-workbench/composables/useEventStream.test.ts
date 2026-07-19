/**
 * useEventStream 单测 —— 三层防护 + 窄白名单 + abort + 超时
 *
 * 测试策略:
 *   - EventSource 不能直接 mock constructor 复杂,改用一个简单的 EventSource
 *     stub,捕获每个实例的 handlers(.onmessage / .onerror / .onopen),然后
 *     测试驱动 emit MessageEvent 来验证行为。
 *   - 这是 happy-dom 环境下的 ESM 测试,不能用 jsdom。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'

// ────────── EventSource stub ──────────
type Handler = (e: MessageEvent) => void

// 用 class 同时充当类型 + 实现,避免 lint 报告 unsafe declaration merging
class StubEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  url: string
  readyState = StubEventSource.OPEN
  onopen: Handler | null = null
  onerror: Handler | null = null
  onmessage: Handler | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    stubInstances.push(this)
  }

  close(): void {
    this.closed = true
    this.readyState = StubEventSource.CLOSED
  }

  /** 测试驱动用:模拟一个 message 事件 */
  emitMessage(data: unknown): void {
    const ev = { data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent
    this.onmessage?.(ev)
  }

  /** 测试驱动用:模拟 error */
  emitError(): void {
    const ev = {} as MessageEvent
    this.onerror?.(ev)
  }
}

const stubInstances: StubEventSource[] = []

// 必须在 import composable 之前替换全局 EventSource
;(globalThis as { EventSource?: unknown }).EventSource = StubEventSource

// sendMessage mock(避免真发请求)
vi.mock('@/api/agent', () => ({
  sendMessage: vi.fn().mockResolvedValue({ data: { ok: true } })
}))

import { useEventStream } from '../composables/useEventStream'

beforeEach(() => {
  stubInstances.length = 0
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useEventStream — EventSource lifecycle', () => {
  it('connects on mount when sessionId is non-empty', () => {
    const sessionId = ref('sess-1')
    useEventStream(sessionId, 'user-1')
    expect(stubInstances.length).toBe(1)
    expect(stubInstances[0]?.url).toBe('/api/agent/sess-1/events')
  })

  it('does not connect when sessionId is empty', () => {
    const sessionId = ref('')
    useEventStream(sessionId, 'user-1')
    expect(stubInstances.length).toBe(0)
  })

  it('rebuilds connection when sessionId changes', async () => {
    const sessionId = ref('sess-1')
    useEventStream(sessionId, 'user-1')
    expect(stubInstances.length).toBe(1)

    sessionId.value = 'sess-2'
    await nextTick()
    expect(stubInstances.length).toBe(2)
    expect(stubInstances[0]?.closed).toBe(true)
    expect(stubInstances[1]?.url).toBe('/api/agent/sess-2/events')
  })
})

describe('useEventStream — three-layer guard', () => {
  it('drops events arriving on an EventSource that was closed (released WeakSet)', async () => {
    const sessionId = ref('sess-1')
    let snapshot: () => { length: number } = () => ({ length: 0 })
    const Harness = defineComponent({
      setup() {
        const { messages } = useEventStream(sessionId, 'user-1')
        snapshot = () => messages.value
        return () => h('div')
      }
    })
    const wrapper = mount(Harness)

    const oldEs = stubInstances[0]
    expect(oldEs).toBeDefined()

    // 模拟「reconnect」:sessionId 变化触发 disconnect+connect
    sessionId.value = 'sess-2'
    await nextTick()
    await nextTick()

    // 旧 es 仍然试图投递一个尾部事件(浏览器行为)
    oldEs?.emitMessage({ type: 'message_start' })
    await nextTick()

    // messages 应该只有新 es 上的事件(目前还没有),不应该被旧 es 的尾巴污染
    expect(snapshot().length).toBe(0)

    wrapper.unmount()
  })

  it('does not double-process the SAME MessageEvent object across reconnect', async () => {
    // cap WeakSet 的真正作用:跨重连路径下,如果浏览器重发 SSE 时把同一
    // MessageEvent 对象传进 onmessage 两次(罕见但有可能),应该只处理一次。
    // 我们用 stub 把同一个 MessageEvent 对象复用,模拟这种边界。
    const sessionId = ref('sess-1')
    let snapshot: () => ReadonlyArray<{ role: string }> = () => []
    const Harness = defineComponent({
      setup() {
        const { messages } = useEventStream(sessionId, 'user-1')
        snapshot = () => messages.value
        return () => h('div')
      }
    })
    const wrapper = mount(Harness)

    const es = stubInstances[0]
    expect(es).toBeDefined()

    // 复用同一个 MessageEvent 对象投递两次
    const reusedEvent = {
      data: JSON.stringify({ type: 'message_start', message: { role: 'assistant' } })
    } as MessageEvent
    es?.onmessage?.(reusedEvent)
    es?.onmessage?.(reusedEvent)
    await nextTick()

    // 应该只有一条 assistant 占位
    const assistantMsgs = snapshot().filter((m) => m.role === 'assistant')
    expect(assistantMsgs.length).toBe(1)

    wrapper.unmount()
  })

  it('capturedWrapper: old close() does not affect new EventSource', async () => {
    const sessionId = ref('sess-1')
    const Harness = defineComponent({
      setup() {
        useEventStream(sessionId, 'user-1')
        return () => h('div')
      }
    })
    const wrapper = mount(Harness)

    const first = stubInstances[0]
    expect(first).toBeDefined()

    sessionId.value = 'sess-2'
    await nextTick()
    await nextTick()
    const second = stubInstances[1]
    expect(second).toBeDefined()
    expect(second?.closed).toBe(false)
    expect(first?.closed).toBe(true)

    // 新连接仍能正常接收事件
    second?.emitMessage({ type: 'message_start', message: { role: 'assistant' } })

    wrapper.unmount()
  })
})

describe('useEventStream — narrow whitelist', () => {
  it('drops events whose type is not in ALLOWED_SSE_EVENTS', () => {
    const sessionId = ref('sess-1')
    const { messages } = useEventStream(sessionId, 'user-1')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const es = stubInstances[0]
    es?.emitMessage({ type: 'thinking_delta', content: 'secret thought' })
    es?.emitMessage({ type: 'toolcall_internal_mumble' })
    es?.emitMessage({ type: 'extension_ui_request' })

    expect(messages.value.length).toBe(0)
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('processes allowed events', () => {
    const sessionId = ref('sess-1')
    const { messages } = useEventStream(sessionId, 'user-1')

    const es = stubInstances[0]
    es?.emitMessage({ type: 'connected' }) // 不 push
    es?.emitMessage({ type: 'message_start', message: { role: 'assistant' } })
    es?.emitMessage({ type: 'message_delta', content: 'Hello' })
    es?.emitMessage({ type: 'message_delta', content: ' World' })
    es?.emitMessage({ type: 'message_end', message: { role: 'assistant' } })

    expect(messages.value.length).toBe(1)
    expect(messages.value[0]?.role).toBe('assistant')
    expect(messages.value[0]?.content).toBe('Hello World')
    expect(messages.value[0]?.streamStatus).toBe('done')
  })
})

describe('useEventStream — SDK event bridge', () => {
  it('renders assistant text from the SDK message_update event', () => {
    const sessionId = ref('sess-1')
    const { messages } = useEventStream(sessionId, 'user-1')
    const es = stubInstances[0]

    es?.emitMessage({ type: 'message_start', message: { role: 'assistant' } })
    es?.emitMessage({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello from SDK' }
    })
    es?.emitMessage({ type: 'message_end', message: { role: 'assistant' } })

    expect(messages.value).toHaveLength(1)
    expect(messages.value[0]?.content).toBe('Hello from SDK')
    expect(messages.value[0]?.streamStatus).toBe('done')
  })

  it('does not create an assistant placeholder for a user message_start event', () => {
    const sessionId = ref('sess-1')
    const { messages } = useEventStream(sessionId, 'user-1')
    const es = stubInstances[0]

    es?.emitMessage({ type: 'message_start', message: { role: 'user' } })

    expect(messages.value).toHaveLength(0)
  })

  it('surfaces prompt_error from the SDK as a visible stream error', () => {
    const sessionId = ref('sess-1')
    const { error, streamStatus } = useEventStream(sessionId, 'user-1')
    const es = stubInstances[0]

    es?.emitMessage({ type: 'prompt_error', errorMessage: 'Model unavailable' })

    expect(error.value).toBe('Model unavailable')
    expect(streamStatus.value).toBe('error')
  })
})

describe('useEventStream — abort()', () => {
  it('closes EventSource and marks current streaming message as cancelled', () => {
    const sessionId = ref('sess-1')
    const { messages, abort, streamStatus } = useEventStream(sessionId, 'user-1')

    const es = stubInstances[0]
    es?.emitMessage({ type: 'message_start', message: { role: 'assistant' } })
    es?.emitMessage({ type: 'message_delta', content: 'partial' })

    expect(messages.value.length).toBe(1)
    expect(messages.value[0]?.streamStatus).toBe('streaming')

    abort()

    expect(es?.closed).toBe(true)
    expect(messages.value[0]?.cancelled).toBe(true)
    expect(messages.value[0]?.streamStatus).toBe('cancelled')
    expect(streamStatus.value).toBe('cancelled')

    // abort 后,旧 es 上残余的事件不应该再处理(released 幂等门)
    es?.emitMessage({ type: 'message_delta', content: 'should not appear' })
    expect(messages.value[0]?.content).toBe('partial')
  })

  it('does nothing if no streaming message', () => {
    const sessionId = ref('sess-1')
    const { abort } = useEventStream(sessionId, 'user-1')
    expect(() => abort()).not.toThrow()
  })
})

describe('useEventStream — timeout', () => {
  it('marks streaming message partial after 90s without events', () => {
    const sessionId = ref('sess-1')
    const { messages, error, streamStatus } = useEventStream(sessionId, 'user-1')

    const es = stubInstances[0]
    es?.emitMessage({ type: 'message_start', message: { role: 'assistant' } })

    // 推进 90s
    vi.advanceTimersByTime(90_000)

    expect(messages.value[0]?.partial).toBe(true)
    expect(messages.value[0]?.streamStatus).toBe('error')
    expect(streamStatus.value).toBe('error')
    expect(error.value).toContain('超时')
  })

  it('resets timer on each event', () => {
    const sessionId = ref('sess-1')
    const { messages, streamStatus } = useEventStream(sessionId, 'user-1')

    const es = stubInstances[0]
    es?.emitMessage({ type: 'message_start', message: { role: 'assistant' } })

    // 50s 后再发事件
    vi.advanceTimersByTime(50_000)
    es?.emitMessage({ type: 'message_delta', content: 'still going' })

    // 再过 50s(累计 100s,但每次事件重置)
    vi.advanceTimersByTime(50_000)
    expect(streamStatus.value).toBe('streaming')
    expect(messages.value[0]?.partial).toBeUndefined()

    // 再过 41s(超过 90s 自上次事件)
    vi.advanceTimersByTime(41_000)
    expect(messages.value[0]?.partial).toBe(true)
  })
})

describe('useEventStream — sendMessage + resetMessages', () => {
  it('resetMessages() clears messages, status and error', async () => {
    const sessionId = ref('sess-1')
    const { messages, resetMessages, streamStatus } = useEventStream(sessionId, 'user-1')

    const es = stubInstances[0]
    es?.emitMessage({ type: 'message_start', message: { role: 'assistant' } })
    expect(messages.value.length).toBe(1)

    resetMessages()
    expect(messages.value.length).toBe(0)
    expect(streamStatus.value).toBe('idle')
  })
})
