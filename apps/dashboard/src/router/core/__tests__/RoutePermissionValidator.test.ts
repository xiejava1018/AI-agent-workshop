/**
 * T8-ROUTE — RoutePermissionValidator 单元测试（characterization）。
 *
 * RoutePermissionValidator 是纯静态方法类（无 router 单例依赖、无副作用），
 * 负责动态路由注册后的权限校验：验证目标路径是否落在用户菜单权限范围内。
 * 本测试锁定其契约：精确匹配 / 动态参数(:id) / 前缀匹配 / 嵌套 children /
 * 根路径放行 / 无权限时回退首页。
 */
import { describe, it, expect } from 'vitest'
import { RoutePermissionValidator } from '../RoutePermissionValidator'
import type { AppRouteRecord } from '@/types/router'

// 构造一棵示例菜单树：工作区(目录) → agent(session:view) + 详情(:id)
function sampleMenu(): AppRouteRecord[] {
  return [
    {
      path: '/workspace',
      name: 'Workspace',
      children: [
        { path: '/workspace/agent', name: 'Agent' },
        { path: '/workspace/agent/:id', name: 'AgentDetail' }
      ]
    } as AppRouteRecord,
    {
      path: '/system/user',
      name: 'SystemUser'
    } as AppRouteRecord
  ]
}

describe('RoutePermissionValidator.validatePath', () => {
  const menu = sampleMenu()

  it('returns the target path with hasPermission=true when permitted', () => {
    const result = RoutePermissionValidator.validatePath('/system/user', menu, '/home')
    expect(result).toEqual({ path: '/system/user', hasPermission: true })
  })

  it('falls back to homePath with hasPermission=false when forbidden', () => {
    const result = RoutePermissionValidator.validatePath('/admin/secret', menu, '/home')
    expect(result).toEqual({ path: '/home', hasPermission: false })
  })

  it('defaults homePath to "/" when not provided', () => {
    const result = RoutePermissionValidator.validatePath('/nope', menu)
    expect(result).toEqual({ path: '/', hasPermission: false })
  })
})

describe('RoutePermissionValidator.hasPermission', () => {
  const menu = sampleMenu()

  it('always allows the root path "/"', () => {
    expect(RoutePermissionValidator.hasPermission('/', [])).toBe(true)
    expect(RoutePermissionValidator.hasPermission('/', menu)).toBe(true)
  })

  it('returns true for an exact menu path', () => {
    expect(RoutePermissionValidator.hasPermission('/system/user', menu)).toBe(true)
  })

  it('returns true for a nested child path', () => {
    expect(RoutePermissionValidator.hasPermission('/workspace/agent', menu)).toBe(true)
  })

  it('returns false for a path not in the menu', () => {
    expect(RoutePermissionValidator.hasPermission('/admin/secret', menu)).toBe(false)
  })

  it('returns false for an empty menu list', () => {
    expect(RoutePermissionValidator.hasPermission('/system/user', [])).toBe(false)
  })
})

describe('RoutePermissionValidator.matchRoute', () => {
  const menu = sampleMenu()

  it('matches a deeply nested path via prefix short-circuit (/workspace/agent/42 under /workspace)', () => {
    // 注:此处经 /workspace 前缀短路命中,:id 正则路径由 isDynamicRouteMatch 套件单独覆盖
    expect(RoutePermissionValidator.matchRoute('/workspace/agent/42', menu)).toBe(true)
  })

  it('matches a path that starts with a menu route (prefix)', () => {
    expect(RoutePermissionValidator.matchRoute('/system/user/extra', menu)).toBe(true)
  })

  it('matches exact path', () => {
    expect(RoutePermissionValidator.matchRoute('/workspace', menu)).toBe(true)
  })

  it('returns false when nothing matches', () => {
    expect(RoutePermissionValidator.matchRoute('/forbidden', menu)).toBe(false)
  })
})

describe('RoutePermissionValidator.isDynamicRouteMatch', () => {
  it('returns false for a static route path (no colon)', () => {
    expect(RoutePermissionValidator.isDynamicRouteMatch('/system/user', '/system/user')).toBe(false)
  })

  it('matches a single :param segment', () => {
    expect(RoutePermissionValidator.isDynamicRouteMatch('/user/123', '/user/:id')).toBe(true)
  })

  it('does not match when param segment has a different shape', () => {
    expect(RoutePermissionValidator.isDynamicRouteMatch('/user/123/edit', '/user/:id')).toBe(false)
  })
})

describe('RoutePermissionValidator.buildMenuPathSet', () => {
  it('flattens nested menu paths into a set, normalizing leading slashes', () => {
    const set = RoutePermissionValidator.buildMenuPathSet(sampleMenu())
    expect(set.has('/workspace')).toBe(true)
    expect(set.has('/workspace/agent')).toBe(true)
    expect(set.has('/workspace/agent/:id')).toBe(true)
    expect(set.has('/system/user')).toBe(true)
  })

  it('normalizes paths without a leading slash', () => {
    const set = RoutePermissionValidator.buildMenuPathSet([
      { path: 'dashboard', name: 'Dashboard' } as AppRouteRecord
    ])
    expect(set.has('/dashboard')).toBe(true)
    expect(set.has('dashboard')).toBe(false)
  })

  it('skips menu items without a path', () => {
    const set = RoutePermissionValidator.buildMenuPathSet([
      { path: '', name: 'Empty' } as AppRouteRecord,
      { path: '/kept', name: 'Kept' } as AppRouteRecord
    ])
    expect(set.size).toBe(1)
    expect(set.has('/kept')).toBe(true)
  })

  it('returns an empty set for empty/non-array input', () => {
    expect(RoutePermissionValidator.buildMenuPathSet([]).size).toBe(0)
  })
})

describe('RoutePermissionValidator.checkPathPrefix', () => {
  it('returns true when targetPath starts with a menuPath + "/"', () => {
    const set = new Set(['/system/user'])
    expect(RoutePermissionValidator.checkPathPrefix('/system/user/123', set)).toBe(true)
  })

  it('returns false when targetPath equals a menuPath exactly (no trailing slash)', () => {
    const set = new Set(['/system/user'])
    expect(RoutePermissionValidator.checkPathPrefix('/system/user', set)).toBe(false)
  })

  it('returns false when no prefix matches', () => {
    const set = new Set(['/system/user'])
    expect(RoutePermissionValidator.checkPathPrefix('/workspace/agent', set)).toBe(false)
  })
})
