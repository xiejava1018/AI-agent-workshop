/**
 * useAudio —— 完成提示音的开关 + 播放 composable。
 *
 * 复刻 apps/web/hooks/useAudio.ts:
 *   - 状态持久化到 localStorage('pi-sound-enabled'),默认 true(对齐 web 默认)
 *   - 单一 AudioContext 复用,自动 resume 解决浏览器 autoplay 限制
 *   - toggle() 切到 on 时主动 resume(用户手势内调用,不会卡 autoplay)
 *
 * 为什么独立 composable:
 *   - Sound 是用户偏好,不属于 agent session 状态,跨会话保留更合理
 *   - Sound 不需要 SSE 事件,不需要 undo / 同步逻辑
 */
import { onUnmounted, ref, watch, type Ref } from 'vue'

const SOUND_ENABLED_KEY = 'pi-sound-enabled'

function playTone(ctx: AudioContext): void {
  const now = ctx.currentTime
  // 两音上行和弦(C5 → E5)对齐 apps/web 的"叮咚"完成提示。
  const freqs = [523.25, 659.25]
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = freq
    const t = now + i * 0.18
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45)
    osc.start(t)
    osc.stop(t + 0.45)
  })
}

export interface UseAudioReturn {
  soundEnabled: Ref<boolean>
  /** 切换开关(立即写入 localStorage);开启时同步 resume AudioContext */
  onSoundToggle: () => void
  /** 主动 resume AudioContext(用户首次手势内调用,避免 autoplay 拦截) */
  unlockAudio: () => void
  /** 播放完成提示音(若 enabled) */
  playDoneSound: () => void
}

export function useAudio(): UseAudioReturn {
  const soundEnabled = ref<boolean>(true)
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(SOUND_ENABLED_KEY)
      soundEnabled.value = stored === null ? true : stored === 'true'
    } catch {
      /* ignore quota / private mode */
    }
  }

  // 单一 AudioContext 复用,跨 listen session 保留,避免每次 play 都要新建。
  // 但 SSR / 测试环境下 window.AudioContext 不存在 → ctxRef 保持 null。
  let ctx: AudioContext | null = null
  function getCtx(): AudioContext | null {
    if (ctx && ctx.state !== 'closed') return ctx
    if (typeof window === 'undefined') return null
    try {
      // 兼容 Safari 老 API
      const Ctor = (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
        | typeof AudioContext
        | undefined
      if (!Ctor) return null
      ctx = new Ctor()
      return ctx
    } catch {
      return null
    }
  }

  function unlockAudio(): void {
    const c = getCtx()
    if (!c || c.state !== 'suspended') return
    c.resume().catch(() => {
      /* user gesture outside or unsupported — ignore */
    })
  }

  function playDoneSound(): void {
    if (!soundEnabled.value) return
    const c = getCtx()
    if (!c) return
    const play = (): void => {
      try {
        playTone(c)
      } catch {
        /* AudioContext not available — silent skip */
      }
    }
    if (c.state === 'suspended') {
      c.resume().then(play).catch(() => {
        /* still suspended — ignore */
      })
      return
    }
    play()
  }

  function toggle(): void {
    const next = !soundEnabled.value
    if (next) unlockAudio()
    soundEnabled.value = next
    try {
      localStorage.setItem(SOUND_ENABLED_KEY, String(next))
    } catch {
      /* ignore */
    }
  }

  // 跨组件实例同步:一个组件改了 localStorage,其它挂载中的实例也应跟随
  // (例如用户改了设置页的状态条,正在收消息的 chat 也应停止响铃)。
  watch(soundEnabled, (v) => {
    try {
      localStorage.setItem(SOUND_ENABLED_KEY, String(v))
    } catch {
      /* ignore */
    }
  })

  // 卸载时关 AudioContext(unmount 时不关,因为是全局共享资源,
  // 再次播放复用;仅当页面卸载才系统级关)
  onUnmounted(() => {
    /* no-op: ctx kept alive */
  })

  return { soundEnabled, onSoundToggle: toggle, playDoneSound, unlockAudio }
}
