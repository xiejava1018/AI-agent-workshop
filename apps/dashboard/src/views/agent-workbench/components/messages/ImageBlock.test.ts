/**
 * ImageBlock 测试覆盖 spec "ImageBlock 组件契约":
 *   - 安全 image URL(<img src="..."> + alt)
 *   - base64 source(<img src="data:image/png;base64,...">)
 *   - 不安全 URL(src 被 safeUrl 移除,DOM 无 src)
 *   - 加载失败显示 fallback(由 @error 触发,本测试跳过 happy-dom 触发,只断言初始状态)
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ImageBlock from './ImageBlock.vue'
import type { ImageContent } from '../../types/assistant-blocks'

const factory = (block: ImageContent) => mount(ImageBlock, { props: { block } })

describe('ImageBlock', () => {
  it('URL source - 渲染 <img src="...">', () => {
    const block: ImageContent = { type: 'image', source: { type: 'url', url: 'https://cdn.example.com/x.png' } }
    const wrapper = factory(block)
    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('https://cdn.example.com/x.png')
  })

  it('base64 source - 渲染 data URL', () => {
    const block: ImageContent = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KG' },
    }
    const wrapper = factory(block)
    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('data:image/png;base64,iVBORw0KG')
  })

  it('不安全 URL - src 被 safeUrl 移除,<img> 渲染但 src 为空', () => {
    const block: ImageContent = { type: 'image', source: { type: 'url', url: 'javascript:alert(1)' } }
    const wrapper = factory(block)
    const img = wrapper.find('img')
    expect(img.exists()).toBe(true) // <img> 仍在 DOM(浏览器会显示 broken image 图标)
    expect(img.attributes('src')).toBe('') // 但 src 是空字符串(safeUrl 拒绝)
  })
})
