/**
 * TabBar —— 标题截断样式契约测试。
 *
 * CSS 关键点:
 *   - .wb-tab { max-width: 200px; min-width: 0; flex-shrink: 1 }
 *     让单个 tab 在 tabbar 拥挤时被压缩到 max-width。
 *   - .wb-tab-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
 *       min-width: 0 }
 *     让 label 在 tab 被压缩时优雅省略。
 *
 * happy-dom 不加载样式表,所以从 workbench.css 源码读 max-width / flex-shrink
 * 等关键规则(对齐 ChatInput.test.ts 中锁定 820px column-width 的做法)。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import TabBar from './TabBar.vue'
import type { WorkbenchTab } from '../types'

function tabs(): WorkbenchTab[] {
  return [
    { id: 'a', sessionId: 'a', title: '会话 xxxxxxxxxxxxxxxxxxxxxxxx', running: false },
    { id: 'b', sessionId: 'b', title: '帮我设计智能问答接口', running: true }
  ]
}

function css(): string {
  return readFileSync(
    resolve(__dirname, '../styles/workbench.css'),
    'utf-8'
  )
}

describe('TabBar — 标题友好显示 + CSS 截断契约', () => {
  it('渲染每个 tab 的 title 作为可见文字', () => {
    const wrapper = mount(TabBar, {
      props: { tabs: tabs(), activeTabId: 'a' }
    })
    expect(wrapper.findAll('.wb-tab')).toHaveLength(2)
    const labels = wrapper.findAll('.wb-tab-label').map((l) => l.text())
    expect(labels[0]).toBe('会话 xxxxxxxxxxxxxxxxxxxxxxxx')
    expect(labels[1]).toBe('帮我设计智能问答接口')
  })

  it('.wb-tab-label 包含 ellipsis 必备 CSS(text-overflow + overflow:hidden + white-space:nowrap)', () => {
    // scoped CSS 不出现在 wrapper 实际渲染中(happy-dom 不导入 stylesheet),
    // 改为读取源文件锁定该契约。
    const source = readFileSync(resolve(__dirname, './TabBar.vue'), 'utf-8')
    expect(source).toMatch(/\.wb-tab-label\s*\{[^}]*overflow:\s*hidden/)
    expect(source).toMatch(/\.wb-tab-label\s*\{[^}]*text-overflow:\s*ellipsis/)
    expect(source).toMatch(/\.wb-tab-label\s*\{[^}]*white-space:\s*nowrap/)
  })

  it('.wb-tab 有 max-width + flex-shrink:1(由 .wb-tabbar 兄弟受限)', () => {
    const source = css()
    // 锁定 “.wb-tab { ... max-width: 200px ... }” + shrink:1
    expect(source).toMatch(/\.wb-tab\s*\{[^}]*max-width:\s*200px/)
    expect(source).toMatch(/\.wb-tab\s*\{[^}]*flex-shrink:\s*1/)
    expect(source).toMatch(/\.wb-tab\s*\{[^}]*min-width:\s*0/)
  })

  it('.wb-tab-label 在 scoped 样式里有 min-width: 0(允许 ellipsis 生效)', () => {
    const source = readFileSync(resolve(__dirname, './TabBar.vue'), 'utf-8')
    expect(source).toMatch(/\.wb-tab-label\s*\{[^}]*min-width:\s*0/)
  })

  it('active tab 高亮 + 添加 active 类', () => {
    const wrapper = mount(TabBar, {
      props: { tabs: tabs(), activeTabId: 'b' }
    })
    const tabsNodes = wrapper.findAll('.wb-tab')
    expect(tabsNodes[1]?.classes()).toContain('active')
    expect(tabsNodes[0]?.classes()).not.toContain('active')
  })

  it('running tab 显示 wb-running-dot', () => {
    const wrapper = mount(TabBar, {
      props: { tabs: tabs(), activeTabId: 'a' }
    })
    const dots = wrapper.findAll('.wb-running-dot')
    expect(dots).toHaveLength(1)
    expect(dots[0]?.element.parentElement?.classList.contains('active')).toBe(false)
  })
})