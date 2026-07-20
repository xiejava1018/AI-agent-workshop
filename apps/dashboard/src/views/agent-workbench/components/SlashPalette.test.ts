/**
 * SlashPalette 组件测试 —— 渲染 / 3 档匹配 / a11y / select 事件。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import SlashPalette from './SlashPalette.vue'
import type { SlashCommandPaletteItem } from '../types'
import { BUILTIN_SLASH_COMMANDS } from '../slash/builtin'

function makeWrapper(propsOverride: Partial<{
  query: string
  items: SlashCommandPaletteItem[]
  activeIndex: number
}> = {}) {
  return mount(SlashPalette, {
    props: {
      query: '',
      items: [...BUILTIN_SLASH_COMMANDS],
      activeIndex: 0,
      ...propsOverride
    }
  })
}

beforeEach(() => {
  // no-op;每个 case 用各自的 props 构造新 wrapper
})

describe('SlashPalette — 渲染', () => {
  it('渲染 role="listbox" 容器,每项 role="option"', () => {
    const wrapper = makeWrapper()
    const listbox = wrapper.find('[role="listbox"]')
    expect(listbox.exists()).toBe(true)
    const options = wrapper.findAll('[role="option"]')
    expect(options.length).toBe(BUILTIN_SLASH_COMMANDS.length)
  })

  it('items 为空时显示 "无匹配命令" 占位项', () => {
    const wrapper = makeWrapper({ items: [] })
    expect(wrapper.find('.wb-slash-palette__empty').exists()).toBe(true)
    expect(wrapper.findAll('[role="option"]').length).toBe(0)
  })

  it('query="/" 时按父级传入的 items 原样展示(不自行过滤)', () => {
    const wrapper = makeWrapper({ query: '/' })
    const options = wrapper.findAll('[role="option"]')
    expect(options.length).toBe(BUILTIN_SLASH_COMMANDS.length)
    expect(options[0]?.text()).toContain('/compact')
  })
})

describe('SlashPalette — a11y', () => {
  it('aria-activedescendant 指向 activeIndex 对应项的 id', () => {
    const wrapper = makeWrapper({ activeIndex: 2 })
    const listbox = wrapper.find('[role="listbox"]')
    const aid = listbox.attributes('aria-activedescendant')
    expect(aid).toBe('wb-slash-palette-listbox-option-2')
  })

  it('activeIndex 对应项 aria-selected="true",其余为 "false"', () => {
    const wrapper = makeWrapper({ activeIndex: 1 })
    const options = wrapper.findAll('[role="option"]')
    expect(options[0]?.attributes('aria-selected')).toBe('false')
    expect(options[1]?.attributes('aria-selected')).toBe('true')
    expect(options[2]?.attributes('aria-selected')).toBe('false')
  })

  it('activeIndex 越界时不输出 aria-activedescendant', () => {
    const wrapper = makeWrapper({ activeIndex: 99 })
    const listbox = wrapper.find('[role="listbox"]')
    expect(listbox.attributes('aria-activedescendant')).toBeUndefined()
  })
})

describe('SlashPalette — select 事件', () => {
  it('点击 item 触发 select 事件并携带完整 item', async () => {
    const wrapper = makeWrapper({ activeIndex: 0 })
    const firstOption = wrapper.find('[role="option"]')
    await firstOption.trigger('click')

    const emitted = wrapper.emitted('select')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toEqual(BUILTIN_SLASH_COMMANDS[0])
  })

  it('mouseenter 触发 update:activeIndex 同步 active 项', async () => {
    const wrapper = makeWrapper({ activeIndex: 0 })
    const options = wrapper.findAll('[role="option"]')
    await options[2]?.trigger('mouseenter')

    const emitted = wrapper.emitted('update:activeIndex')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toBe(2)
  })

  it('mouseenter 当前 active 项不重复 emit update:activeIndex', async () => {
    const wrapper = makeWrapper({ activeIndex: 1 })
    const options = wrapper.findAll('[role="option"]')
    await options[1]?.trigger('mouseenter')
    expect(wrapper.emitted('update:activeIndex')).toBeFalsy()
  })
})

describe('SlashPalette — 父级过滤契约', () => {
  it('Palette 自身不做模糊匹配,只展示 props.items(3 档过滤由父级 ChatInput 负责)', () => {
    // 即使 query 是 "/zzz" 不可能命中任何 builtin,palette 也原样展示父级给的 items,
    // 因为过滤责任在父级;palette 只是 dumb renderer。
    const wrapper = makeWrapper({ query: '/zzz' })
    const options = wrapper.findAll('[role="option"]')
    expect(options.length).toBe(BUILTIN_SLASH_COMMANDS.length)
  })

  it('父级传 1 项时,palette 仅渲染 1 项', async () => {
    const wrapper = makeWrapper({
      query: '/comp',
      items: [BUILTIN_SLASH_COMMANDS[0]!]
    })
    await nextTick()
    const options = wrapper.findAll('[role="option"]')
    expect(options.length).toBe(1)
    expect(options[0]?.attributes('data-slash-name')).toBe('/compact')
  })
})
