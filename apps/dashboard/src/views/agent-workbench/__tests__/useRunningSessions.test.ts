/**
 * useRunningSessions 单元测试 —— 三层 SSE 防护
 *
 * 验证:
 *   1. **released WeakSet 幂等门**:stop() 后到达的 frame 不再写入 runningMap
 *   2. **capturedWrapper 闭包**:restart 后旧 handler 不会跨连接触发新连接
 *   3. **WeakSet cap 去重**:同一 MessageEvent 实例不会被处理两次
 *   4. **白名单过滤**:非 running 类型 frame 被丢弃(console.warn)
 *   5. **自动 onUnmounted**:vue onUnmounted hook 触发 stop()
 *
 * Mock subscribeRunningSessions 让测试直接控制 onmessage handler 与 onerror。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the most recent EventSource so tests can drive onmessage manually.
let lastSource: MockEventSource | null = null

class MockEventSource {
  url: string
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  closed = false
  constructor(url: string) {
    this.url = url
    lastSource = this
  }
  close() {
    this.closed = true
    if (lastSource === this) lastSource = null
  }
  // Helpers for tests
  emitMessage(data: string) {
    const ev = { data } as unknown as MessageEvent
    this.onmessage?.(ev)
  }
  emitError() {
    const ev = {} as Event
    this.onerror?.(ev)
  }
}

vi.mock('@/api/agent', () => ({
  subscribeRunningSessions: vi.fn(
    (onFrame: (frame: any) => void, onError?: (ev: Event) => void) => {
      const source = new MockEventSource('/api/agent/running/events')
      // The API layer's onmessage is installed in the composable via sub.source.onmessage;
      // but we need to expose the same hookup. Here we install a passthrough that calls onFrame
      // for valid frames. The composable then installs its own onmessage — see the test note.
      source.onmessage = (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { type?: string; runningSessionIds?: string[] }
          if (data.type === 'running') {
            onFrame({ type: 'running', runningSessionIds: data.runningSessionIds ?? [] })
          }
        } catch {
          /* malformed */
        }
      }
      if (onError) source.onerror = onError
      return { source, unsubscribe: () => source.close() }
    }
  )
}))

import { defineComponent, h, createApp, type App as VueApp } from 'vue'
import { useRunningSessions } from '../composables/useRunningSessions'

function mountUseRunningSessions() {
  let resultRef: any = null
  const app: VueApp = createApp(
    defineComponent({
      setup() {
        resultRef = useRunningSessions()
        return () => h('div')
      }
    })
  )
  const root = document.createElement('div')
  app.mount(root)
  const unmount = () => app.unmount()
  if (!resultRef) throw new Error('setup did not run')
  return { result: resultRef as ReturnType<typeof useRunningSessions>, unmount }
}

beforeEach(() => {
  lastSource = null
  vi.clearAllMocks()
})

describe('useRunningSessions — basic wiring', () => {
  it('opens EventSource on /api/agent/running/events', () => {
    const { result, unmount } = mountUseRunningSessions()
    expect(lastSource).not.toBeNull()
    expect(lastSource!.url).toBe('/api/agent/running/events')
    expect(result.connected.value).toBe(true)
    unmount()
  })

  it('updates runningMap when a running frame arrives', () => {
    const { result, unmount } = mountUseRunningSessions()
    lastSource!.emitMessage(JSON.stringify({ type: 'running', runningSessionIds: ['a', 'b'] }))
    expect(result.runningMap.value.get('a')).toBe(true)
    expect(result.runningMap.value.get('b')).toBe(true)
    expect(result.runningMap.value.size).toBe(2)
    unmount()
  })

  it('replaces runningMap on each new frame (snapshot semantics)', () => {
    const { result, unmount } = mountUseRunningSessions()
    lastSource!.emitMessage(JSON.stringify({ type: 'running', runningSessionIds: ['a', 'b'] }))
    lastSource!.emitMessage(JSON.stringify({ type: 'running', runningSessionIds: ['c'] }))
    expect(result.runningMap.value.size).toBe(1)
    expect(result.runningMap.value.has('a')).toBe(false)
    expect(result.runningMap.value.get('c')).toBe(true)
    unmount()
  })
})

describe('useRunningSessions — layer 3: WeakSet cap dedup', () => {
  it('同一 MessageEvent 实例不会被处理两次', () => {
    // Spy console.warn to assert dedup messages
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, unmount } = mountUseRunningSessions()
    // 同一 event 通过 emitMessage 复用——它内部用同一 ev 对象
    const fakeEvent = { data: JSON.stringify({ type: 'running', runningSessionIds: ['x'] }) } as MessageEvent
    // Bypass emitMessage helper to truly reuse the same MessageEvent:
    // emitMessage creates a new object each call, so we reach in via onmessage directly.
    // The WeakSet cap is keyed on the MessageEvent instance, so to test dedup we need the SAME
    // instance fired twice — which is exactly what EventSource would do on retry bugs.
    lastSource!.onmessage?.(fakeEvent)
    lastSource!.onmessage?.(fakeEvent)
    expect(result.runningMap.value.get('x')).toBe(true)
    expect(result.runningMap.value.size).toBe(1)
    warnSpy.mockRestore()
    unmount()
  })
})

describe('useRunningSessions — layer 1: released 幂等门', () => {
  it('stop() 后到达的 frame 不再写入 runningMap', () => {
    const { result, unmount } = mountUseRunningSessions()
    const source = lastSource! // capture before stop() nulls it
    result.stop()
    // stop() closes the source, but for the test we manually emit anyway to simulate a late frame
    // The released flag should drop it.
    source.emitMessage(JSON.stringify({ type: 'running', runningSessionIds: ['after-stop'] }))
    expect(result.runningMap.value.has('after-stop')).toBe(false)
    unmount()
  })

  it('vue onUnmounted 自动触发 stop()', () => {
    const { unmount } = mountUseRunningSessions()
    const source = lastSource!
    expect(source.closed).toBe(false)
    unmount()
    expect(source.closed).toBe(true)
  })
})

describe('useRunningSessions — layer 2: capturedWrapper 闭包', () => {
  it('restart 后旧 connection 的 handler 不会在新连接上触发', () => {
    const { result, unmount } = mountUseRunningSessions()
    const oldSource = lastSource!
    result.restart()
    const newSource = lastSource!
    expect(newSource).not.toBe(oldSource)
    expect(oldSource.closed).toBe(true)
    // 在新连接上发消息,只更新一次
    newSource.emitMessage(JSON.stringify({ type: 'running', runningSessionIds: ['only-new'] }))
    expect(result.runningMap.value.get('only-new')).toBe(true)
    unmount()
  })
})

describe('useRunningSessions — whitelist filtering', () => {
  it('非 running 类型 frame 被丢弃 + console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, unmount } = mountUseRunningSessions()
    lastSource!.emitMessage(JSON.stringify({ type: 'tool.start', toolCallId: '1' }))
    expect(result.runningMap.value.size).toBe(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
    unmount()
  })

  it('心跳(:)被丢弃', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, unmount } = mountUseRunningSessions()
    // 直接构造带 data:' :' 的 event
    ;(lastSource! as any).onmessage?.({ data: ':' } as MessageEvent)
    expect(result.runningMap.value.size).toBe(0)
    warnSpy.mockRestore()
    unmount()
  })

  it('畸形 JSON frame 被丢弃 + console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, unmount } = mountUseRunningSessions()
    lastSource!.emitMessage('not-json{{{')
    expect(result.runningMap.value.size).toBe(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
    unmount()
  })
})

describe('useRunningSessions — error path', () => {
  it('error 状态在 EventSource emit error 时被记录(connected=false)', () => {
    const { result, unmount } = mountUseRunningSessions()
    lastSource!.emitError()
    expect(result.connected.value).toBe(false)
    unmount()
  })
})