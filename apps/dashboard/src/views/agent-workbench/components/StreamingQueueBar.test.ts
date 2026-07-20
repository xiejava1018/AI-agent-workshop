/**
 * StreamingQueueBar 组件测试 —— streaming 期间 composer 顶部的队列条
 * (B7 — queued messages 显示)
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StreamingQueueBar from './StreamingQueueBar.vue'
import type { QueueItem } from '../types'

function makeItem(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: over.id ?? 'q-1',
    kind: over.kind ?? 'steer',
    text: over.text ?? 'hello world',
    createdAt: over.createdAt ?? '2026-07-20T00:00:00Z'
  }
}

function makeWrapper(
  propsOverride: Partial<{ items: readonly QueueItem[]; isStreaming: boolean }> = {}
) {
  return mount(StreamingQueueBar, {
    props: {
      items: propsOverride.items ?? [],
      isStreaming: propsOverride.isStreaming ?? true
    }
  })
}

beforeEach(() => {
  // 不需要重置全局状态,每个测试自包含
})

describe('StreamingQueueBar — empty / non-streaming', () => {
  it('items 为空时不渲染 ul', () => {
    const wrapper = makeWrapper({ items: [], isStreaming: true })
    expect(wrapper.find('[data-testid="wb-stream-queue"]').exists()).toBe(false)
  })

  it('isStreaming=false 不渲染 ul(即使有 items)', () => {
    const wrapper = makeWrapper({
      items: [makeItem({ id: 'q-1' })],
      isStreaming: false
    })
    expect(wrapper.find('[data-testid="wb-stream-queue"]').exists()).toBe(false)
  })
})

describe('StreamingQueueBar — render', () => {
  it('render items 中的每条(kind 标签 + text + × 按钮)', () => {
    const wrapper = makeWrapper({
      items: [
        makeItem({ id: 'q-1', kind: 'steer', text: 'first' }),
        makeItem({ id: 'q-2', kind: 'followUp', text: 'second' })
      ],
      isStreaming: true
    })
    const items = wrapper.findAll('.wb-stream-queue__item')
    expect(items.length).toBe(2)
    expect(items[0]?.find('.wb-stream-queue__preview').text()).toBe('first')
    expect(items[1]?.find('.wb-stream-queue__preview').text()).toBe('second')
    expect(wrapper.findAll('.wb-stream-queue__recall').length).toBe(2)
  })

  it('text 超 60 字符截断 + ...', () => {
    const long = 'a'.repeat(80)
    const wrapper = makeWrapper({
      items: [makeItem({ id: 'q-1', text: long })],
      isStreaming: true
    })
    const preview = wrapper.find('.wb-stream-queue__preview').text()
    expect(preview.length).toBe(63) // 60 chars + '...'
    expect(preview.endsWith('...')).toBe(true)
    expect(preview.startsWith('a'.repeat(60))).toBe(true)
  })

  it('text 正好 60 字符不截断', () => {
    const exact = 'b'.repeat(60)
    const wrapper = makeWrapper({
      items: [makeItem({ id: 'q-1', text: exact })],
      isStreaming: true
    })
    const preview = wrapper.find('.wb-stream-queue__preview').text()
    expect(preview).toBe(exact)
  })

  it('text 为空时显示 (image attached)', () => {
    const wrapper = makeWrapper({
      items: [makeItem({ id: 'q-1', text: '' })],
      isStreaming: true
    })
    expect(wrapper.find('.wb-stream-queue__preview').text()).toBe('(image attached)')
  })
})

describe('StreamingQueueBar — recall', () => {
  it('× 按钮点击触发 recall emit 并带 item.id', async () => {
    const wrapper = makeWrapper({
      items: [makeItem({ id: 'q-42', kind: 'steer', text: 'x' })],
      isStreaming: true
    })
    const btn = wrapper.find('.wb-stream-queue__recall')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')

    const emitted = wrapper.emitted('recall')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toBe('q-42')
  })

  it('多条 items 时点击第二个按钮只 emit 第二个的 id', async () => {
    const wrapper = makeWrapper({
      items: [
        makeItem({ id: 'q-1', kind: 'steer', text: 'a' }),
        makeItem({ id: 'q-2', kind: 'followUp', text: 'b' })
      ],
      isStreaming: true
    })
    const buttons = wrapper.findAll('.wb-stream-queue__recall')
    await buttons[1]?.trigger('click')
    const emitted = wrapper.emitted('recall')
    expect(emitted?.[0]?.[0]).toBe('q-2')
  })
})

describe('StreamingQueueBar — kind tag colors', () => {
  it('followUp 项用 primary tag', () => {
    const wrapper = makeWrapper({
      items: [makeItem({ id: 'q-1', kind: 'followUp', text: 'x' })],
      isStreaming: true
    })
    const tag = wrapper.find('.wb-stream-queue__kind')
    expect(tag.text()).toBe('followUp')
    // el-tag 根元素有 el-tag--primary modifier class
    const html = tag.html()
    expect(html).toContain('el-tag--primary')
  })

  it('steer 项用 info tag', () => {
    const wrapper = makeWrapper({
      items: [makeItem({ id: 'q-1', kind: 'steer', text: 'x' })],
      isStreaming: true
    })
    const tag = wrapper.find('.wb-stream-queue__kind')
    expect(tag.text()).toBe('steer')
    const html = tag.html()
    expect(html).toContain('el-tag--info')
  })
})

describe('StreamingQueueBar — a11y', () => {
  it('所有 × 按钮都有 aria-label 含 kind', () => {
    const wrapper = makeWrapper({
      items: [
        makeItem({ id: 'q-1', kind: 'steer', text: 'a' }),
        makeItem({ id: 'q-2', kind: 'followUp', text: 'b' })
      ],
      isStreaming: true
    })
    const buttons = wrapper.findAll('.wb-stream-queue__recall')
    expect(buttons[0]?.attributes('aria-label')).toBe('Recall queued steer message')
    expect(buttons[1]?.attributes('aria-label')).toBe('Recall queued followUp message')
  })
})
