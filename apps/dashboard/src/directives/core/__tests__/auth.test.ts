/**
 * T8-TEST — v-auth 指令单元测试（characterization）。
 *
 * v-auth 指令已存在于 directives/core/auth.ts（基于 route.meta.authList）。
 * 本测试锁定其真实行为契约：从当前路由 meta.authList 读取权限标记，
 * 无匹配时将元素从 DOM 移除（不是隐藏），mounted/updated 均生效。
 *
 * 通过 vi.mock 控制路由的 currentRoute.meta.authList，用真实 DOM 元素
 * 直接驱动指令 hook，验证 DOM 移除/保留。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

// 可变的路由 mock：测试间改写 meta.authList
const mockRoute = {
  value: { meta: { authList: [] as Array<{ authMark: string }> } }
}

vi.mock('@/router', () => ({
  router: {
    currentRoute: mockRoute
  }
}))

const { setupAuthDirective } = await import('../auth')

/** 设置当前路由的 authList */
function setAuthList(authMarks: string[]): void {
  mockRoute.value.meta.authList = authMarks.map((authMark) => ({ authMark }))
}

/** 取回注册后的 v-auth 指令对象 */
function getAuthDirective(): { mounted: Function; updated: Function } {
  const app = createApp({})
  setupAuthDirective(app)
  return app.directive('auth') as unknown as { mounted: Function; updated: Function }
}

/** 构造一个已挂到父节点的元素，并对它触发给定 hook */
function mountWith(bindingValue: string, hook: 'mounted' | 'updated'): { parent: HTMLElement; el: HTMLElement } {
  const dir = getAuthDirective()
  const parent = document.createElement('div')
  const el = document.createElement('button')
  parent.appendChild(el)
  dir[hook](el, { value: bindingValue, oldValue: undefined, modifiers: {}, dir: {} } as any, null as any, null as any)
  return { parent, el }
}

describe('v-auth directive', () => {
  beforeEach(() => {
    setAuthList([])
  })

  it('keeps the element when authMark matches the binding value (mounted)', () => {
    setAuthList(['add', 'edit'])
    const { parent } = mountWith('add', 'mounted')
    expect(parent.children.length).toBe(1)
  })

  it('removes the element from DOM when no authMark matches (mounted)', () => {
    setAuthList(['edit', 'delete'])
    const { parent } = mountWith('add', 'mounted')
    expect(parent.children.length).toBe(0)
  })

  it('removes the element when authList is empty', () => {
    setAuthList([])
    const { parent } = mountWith('add', 'mounted')
    expect(parent.children.length).toBe(0)
  })

  it('removes the element when meta.authList is undefined (defensive default)', () => {
    delete (mockRoute.value.meta as { authList?: unknown }).authList
    const { parent } = mountWith('add', 'mounted')
    expect(parent.children.length).toBe(0)
  })

  it('reacts to permission changes via the updated hook', async () => {
    setAuthList(['add'])
    const dir = getAuthDirective()
    const parent = document.createElement('div')
    const el = document.createElement('button')
    parent.appendChild(el)

    // 初始有权限 → 保留
    dir.mounted(el, { value: 'add', oldValue: undefined, modifiers: {}, dir: {} } as any, null as any, null as any)
    expect(parent.children.length).toBe(1)

    // 权限被收回（updated 时 authList 不再含 add）→ 移除
    setAuthList(['edit'])
    dir.updated(el, { value: 'add', oldValue: 'add', modifiers: {}, dir: {} } as any, null as any, null as any)
    await nextTick()
    expect(parent.children.length).toBe(0)
  })

  it('does not throw when the element has no parentNode (orphan guard)', () => {
    setAuthList(['edit']) // 无 add 权限 → 触发 removeElement
    const dir = getAuthDirective()
    const el = document.createElement('button') // 未 append 到任何父节点
    expect(() => {
      dir.mounted(el, { value: 'add', oldValue: undefined, modifiers: {}, dir: {} } as any, null as any, null as any)
    }).not.toThrow()
  })
})
