/**
 * useRunningSessions composable
 *
 * 全局 SSE 订阅:`/api/agent/running/events`
 * 维护 `runningMap: Ref<RunningStateMap>`,供侧栏列表项按 id 查询 running 状态。
 *
 * 设计要点 —— 必须完整复刻 apps/web 已验证的三层防护
 * (参考 memory: events-sse-refcount-cap-closure):
 *
 *   1. **released WeakSet 幂等门**:组件 onUnmounted 后,后续偶发到达的 frame 必须被
 *      静默丢弃,不能 setRef 重写状态(否则会把「清理后到达的迟到 frame」写入 ref)。
 *   2. **capturedWrapper 闭包**:EventSource 的 onmessage 闭包必须捕获本次连接的
 *      wrapper 对象(handler),不能跨连接复用。否则旧连接的 handler 会在新连接上触发。
 *   3. **cap WeakSet 去重**:同一 MessageEvent 实例不会被处理两次。EventSource 在某些
 *      环境下会重发(浏览器 bug / 心跳合并);不设 cap 会导致 running set 被反复写入。
 *
 * 心跳/未知事件:console.warn 后丢弃,不进 ref(防 pi SDK 事件泛洪,见 types.ts)。
 *
 * EventSource 自身有自动重连机制,这里不再加 setTimeout 重连——onerror 只 console.warn
 * 让 EventSource 自己处理恢复。
 */

import { ref, onUnmounted, type Ref } from 'vue'
import { subscribeRunningSessions } from '@/api/agent'
import type { RunningStateMap } from '../types'

export interface UseRunningSessionsResult {
  /** sessionId -> running 状态 */
  runningMap: Ref<RunningStateMap>
  /** 当前是否已建立连接 */
  connected: Ref<boolean>
  /** 显式停止订阅(组件卸载时也会自动调用) */
  stop: () => void
  /** 显式重启订阅(用于手动重连场景) */
  restart: () => void
  /** 错误状态(连接建立失败 / 反序列化错误) */
  error: Ref<string | null>
}

/**
 * 单条 SSE 连接 + handler 的闭包容器。
 * 关键:released 状态由 handler 闭包内的变量持有,不依赖外部 connection 指针
 * (teardown() 后 connection 会被置 null,但 onmessage 仍可能在 source.close() 前
 * 收到最后一帧 —— 此时 connection 已 null,需要闭包变量继续承载 released 状态)。
 */
interface Connection {
  source: EventSource
  /** 本次连接的 message handler(捕获到闭包里,跨连接不复用) */
  handler: FrameHandler
  /** released 标记:onUnmounted 后此连接的所有 frame 直接 return */
  released: boolean
  /** 释放闭包状态(teardown 时调用) */
  release: () => void
}

type FrameHandler = (raw: MessageEvent) => void

function formatError(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message || fallback
  return fallback
}

export function useRunningSessions(): UseRunningSessionsResult {
  const runningMap = ref<RunningStateMap>(new Map<string, boolean>())
  const connected = ref(false)
  const error = ref<string | null>(null)

  /** 当前活跃连接 */
  let connection: Connection | null = null
  /** 同一 MessageEvent 实例只处理一次,避免 EventSource 重发/合并造成重复处理 */
  const cap = new WeakSet<MessageEvent>()

  function applyFrame(frame: { runningSessionIds: string[] }) {
    // 用新 Map 整体替换,触发 ref 的依赖重算
    const next = new Map<string, boolean>()
    for (const id of frame.runningSessionIds) next.set(id, true)
    runningMap.value = next
  }

  function teardown() {
    if (!connection) return
    // 第一层:released 幂等门 —— 先调用 release() 让闭包变量打标,
    // 后续到达的 frame 通过闭包变量读到 released=true,直接 return。
    connection.release()
    try {
      connection.source.close()
    } catch {
      /* ignore */
    }
    connection = null
    connected.value = false
  }

  function start() {
    if (connection) return

    // released 状态由闭包变量承载 —— 即使 teardown() 把 connection 置 null,
    // 闭包内的引用仍然存在;handler 读 releasedRef 来判断是否丢弃。
    let released = false

    const handler: FrameHandler = (raw) => {
      // 第一层(released 闸门):通过闭包变量读取
      if (released) return
      // 第三层(cap 去重):同一 event 不处理两次
      if (cap.has(raw)) return
      cap.add(raw)
      const text = raw.data
      // 心跳/空帧(`:\n\n`)—— EventSource 通常不会作为 message 派发,但保险起见跳过空文本
      if (!text || text.startsWith(':')) return
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        console.warn('[useRunningSessions] malformed SSE frame:', text.slice(0, 120))
        return
      }
      const obj = parsed as { type?: string; runningSessionIds?: string[] }
      if (obj.type !== 'running') {
        console.warn('[useRunningSessions] non-whitelisted frame type:', obj.type)
        return
      }
      applyFrame({ runningSessionIds: Array.isArray(obj.runningSessionIds) ? obj.runningSessionIds : [] })
    }

    try {
      const sub = subscribeRunningSessions(
        (frame) => {
          if (released) return
          applyFrame(frame)
        },
        (ev) => {
          if (released) return
          console.warn('[useRunningSessions] SSE error (EventSource will auto-reconnect)', ev)
          connected.value = false
        }
      )
      // 第二层(capturedWrapper 闭包):handler 装进 source.onmessage,
      // handler 内部通过闭包变量 released + cap WeakSet 自我保护。
      sub.source.onmessage = handler
      connection = {
        source: sub.source,
        handler,
        released: false,
        release: () => {
          released = true
        }
      }
      connected.value = true
      error.value = null
    } catch (e: unknown) {
      error.value = formatError(e, '建立 running/events 连接失败')
      connected.value = false
    }
  }

  function stop() {
    teardown()
  }

  function restart() {
    teardown()
    start()
  }

  // 自动启动
  start()
  // 自动清理
  onUnmounted(() => {
    teardown()
  })

  return {
    runningMap,
    connected,
    stop,
    restart,
    error
  }
}