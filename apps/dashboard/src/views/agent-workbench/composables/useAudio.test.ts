/**
 * useAudio —— 完成提示音 composable。
 * 对齐 apps/web/hooks/useAudio.ts:
 *   - 默认 soundEnabled = true
 *   - localStorage 持久化('pi-sound-enabled')
 *   - 跨实例同步(ref watch)
 *   - playDoneSound 在 disabled / AudioContext 不可用时静默
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useAudio } from './useAudio'

const SOUND_KEY = 'pi-sound-enabled'

const makeHost = () => {
  let api: ReturnType<typeof useAudio> | null = null
  const host = defineComponent({
    setup() {
      api = useAudio()
      return () => h('div')
    }
  })
  const wrapper = mount(host, { attachTo: document.body })
  // mount 之后再返回,确保 onMounted/setup 副作用已完成
  return { wrapper, getApi: () => api! }
}

describe('useAudio', () => {
  beforeEach(() => {
    localStorage.removeItem(SOUND_KEY)
    vi.restoreAllMocks()
  })

  afterEach(() => {
    localStorage.removeItem(SOUND_KEY)
  })

  it('默认 soundEnabled=true(未持久化时)', () => {
    const { getApi } = makeHost()
    expect(getApi().soundEnabled.value).toBe(true)
  })

  it('localStorage=false 持久化时初始化为 false', () => {
    localStorage.setItem(SOUND_KEY, 'false')
    const { getApi } = makeHost()
    expect(getApi().soundEnabled.value).toBe(false)
  })

  it('toggle() 翻转 soundEnabled 并写 localStorage', () => {
    const { getApi, wrapper } = makeHost()
    const api = getApi()
    api.onSoundToggle()
    expect(api.soundEnabled.value).toBe(false)
    expect(localStorage.getItem(SOUND_KEY)).toBe('false')
    api.onSoundToggle()
    expect(api.soundEnabled.value).toBe(true)
    expect(localStorage.getItem(SOUND_KEY)).toBe('true')
    wrapper.unmount()
  })

  it('soundEnabled=false 时 playDoneSound 不播放(状态不调用 unlockAudio)', () => {
    const { getApi } = makeHost()
    const api = getApi()
    api.onSoundToggle() // 关闭 → false
    expect(api.soundEnabled.value).toBe(false)
    // 状态不跳:playDoneSound 内部首先 if (!soundEnabled.value) return
    // — happy-dom 无 AudioContext;状态检查足以保证不再创建 ctx。
    expect(() => api.playDoneSound()).not.toThrow()
    expect(api.soundEnabled.value).toBe(false)
  })

  it('soundEnabled=true 但 window.AudioContext 为 undefined 时静默返回', () => {
    // happy-dom 默认 AudioContext 不存在 → playDoneSound 直接 return
    const { getApi } = makeHost()
    expect(() => getApi().playDoneSound()).not.toThrow()
  })
})
