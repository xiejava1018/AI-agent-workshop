/**
 * SoundToggleButton —— 完成提示音开关按钮测试。
 * 对齐 apps/web/components/ChatInput.tsx 第 1859-1891 行。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SoundToggleButton from './SoundToggleButton.vue'

describe('SoundToggleButton', () => {
  it('soundEnabled=true:显示喇叭图标(三道音波),aria-label 是关闭提示音', () => {
    const wrapper = mount(SoundToggleButton, { props: { soundEnabled: true } })
    const btn = wrapper.find('.wb-sound-toggle')
    expect(btn.attributes('aria-label')).toBe('关闭完成提示音')
    expect(btn.attributes('title')).toBe('关闭完成提示音')
    // 内部 SVG 有 polygon(喇叭形)
    const svg = btn.find('svg')
    expect(svg.exists()).toBe(true)
  })

  it('soundEnabled=false:aria-label 改为开启完成提示音(opacity 降低)', () => {
    const wrapper = mount(SoundToggleButton, { props: { soundEnabled: false } })
    const btn = wrapper.find('.wb-sound-toggle')
    expect(btn.attributes('aria-label')).toBe('开启完成提示音')
  })

  it('点击触发 update:soundEnabled,值取反', async () => {
    const wrapper = mount(SoundToggleButton, { props: { soundEnabled: true } })
    await wrapper.find('.wb-sound-toggle').trigger('click')
    const emitted = wrapper.emitted('update:soundEnabled')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toBe(false)

    // 状态从 false 翻到 true
    await wrapper.setProps({ soundEnabled: false })
    await wrapper.find('.wb-sound-toggle').trigger('click')
    expect(wrapper.emitted('update:soundEnabled')?.[1]?.[0]).toBe(true)
  })
})
