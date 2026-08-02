/**
 * useSessionTree —— fork tree 构造 + collapsed 状态管理测试。
 *
 * 覆盖:
 *   - buildSessionTree 把扁平列表构造成 root + children 两层
 *   - parentSessionId 链解析(链中可能存在丢失的中间节点)
 *   - cycle 防护(双向引用不会死循环)
 *   - 排序:同层 pinned 优先(updatedAt desc 决胜)
 *   - 折叠后 flat 跳过 children
 *   - searchQuery 命中后保留命中路径上的祖先
 */
import { describe, expect, it } from 'vitest'
import { ref, computed } from 'vue'
import {
  buildSessionTree,
  flattenTree,
  useSessionTree
} from './useSessionTree'
import type { AgentSession } from '@/api/agent'

function sess(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    title: `Session ${id}`,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('buildSessionTree', () => {
  it('空列表返回空 roots', () => {
    expect(buildSessionTree([])).toEqual([])
  })

  it('无 parent 的会话都成为 root', () => {
    const tree = buildSessionTree([sess('a'), sess('b'), sess('c')])
    expect(tree.map((n) => n.session.id)).toEqual(['a', 'b', 'c'])
    expect(tree.every((n) => n.depth === 0)).toBe(true)
    expect(tree.every((n) => n.children.length === 0)).toBe(true)
  })

  it('parentSessionId 指向 root 时,子节点挂到对应 root 下', () => {
    const tree = buildSessionTree([
      sess('a'),
      sess('b', { parentSessionId: 'a' }),
      sess('c', { parentSessionId: 'a' })
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0]?.session.id).toBe('a')
    expect(tree[0]?.children.map((c) => c.session.id).sort()).toEqual(['b', 'c'])
    expect(tree[0]?.children.every((c) => c.depth === 1)).toBe(true)
  })

  it('parentSessionId 链中间有缺失节点时,中间节点变 root,后续子挂中间', () => {
    // b 的 parentSessionId='missing',但 missing 不在 byId 中 → b 找不到祖先,变 root
    // c 的 parentSessionId='b'(是 byId 中),c 挂到 b.children 下
    const tree = buildSessionTree([
      sess('a'),
      sess('b', { parentSessionId: 'missing' }),
      sess('c', { parentSessionId: 'b' })
    ])
    expect(tree.map((n) => n.session.id).sort()).toEqual(['a', 'b'])
    const b = tree.find((n) => n.session.id === 'b')
    expect(b?.children.map((c) => c.session.id)).toEqual(['c'])
  })

  it('cycle(双向引用)不会死循环', () => {
    // 构造 a.parent = b, b.parent = a — 防护应把两者都视为 root
    const tree = buildSessionTree([
      sess('a', { parentSessionId: 'b' }),
      sess('b', { parentSessionId: 'a' })
    ])
    expect(tree.map((n) => n.session.id).sort()).toEqual(['a', 'b'])
  })

  it('同层 pinned 优先(updatedAt desc 决胜)', () => {
    const tree = buildSessionTree([
      sess('a', { updatedAt: '2025-01-01T10:00:00.000Z' }),
      sess('b', { updatedAt: '2025-01-02T10:00:00.000Z', pinned: true }),
      sess('c', { updatedAt: '2025-01-03T10:00:00.000Z' }),
      sess('d', { updatedAt: '2025-01-04T10:00:00.000Z', pinned: true })
    ])
    // 同层排序结果: d (pinned,更新) > b (pinned,较旧) > c (未 pin,最新) > a (未 pin,较旧)
    expect(tree.map((n) => n.session.id)).toEqual(['d', 'b', 'c', 'a'])
  })
})

describe('flattenTree', () => {
  it('默认全展开,深度优先遍历', () => {
    const roots = buildSessionTree([
      sess('a'),
      sess('b', { parentSessionId: 'a' }),
      sess('c', { parentSessionId: 'a' }),
      sess('d', { parentSessionId: 'b' })
    ])
    const flat = flattenTree(roots, new Set())
    expect(flat.map((n) => n.session.id)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('collapsed 节点保留自身但跳过 children', () => {
    const roots = buildSessionTree([
      sess('a'),
      sess('b', { parentSessionId: 'a' }),
      sess('c', { parentSessionId: 'a' }),
      sess('d', { parentSessionId: 'b' })
    ])
    const flat = flattenTree(roots, new Set(['b']))
    expect(flat.map((n) => n.session.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('useSessionTree composable', () => {
  it('computed 派生 roots + flat,响应式变化跟随 sessions', () => {
    const sessions = ref<AgentSession[]>([
      sess('a', { updatedAt: '2025-01-02T10:00:00.000Z' }),
      sess('b', { updatedAt: '2025-01-01T10:00:00.000Z' })
    ])
    const tree = useSessionTree(computed(() => sessions.value))
    expect(tree.flat.value.map((n) => n.session.id)).toEqual(['a', 'b'])
    // 切换 sessions
    sessions.value = [sess('a'), sess('b', { parentSessionId: 'a' })]
    expect(tree.flat.value.map((n) => n.session.id)).toEqual(['a', 'b'])
    expect(tree.flat.value[1]?.depth).toBe(1)
  })

  it('toggle 切换 collapsed 状态,flat 跟随', () => {
    const sessions = ref<AgentSession[]>([
      sess('a'),
      sess('b', { parentSessionId: 'a' })
    ])
    const tree = useSessionTree(computed(() => sessions.value))
    expect(tree.flat.value).toHaveLength(2)
    tree.toggle('a')
    expect(tree.isCollapsed('a')).toBe(true)
    expect(tree.flat.value).toHaveLength(1)
    tree.toggle('a')
    expect(tree.isCollapsed('a')).toBe(false)
    expect(tree.flat.value).toHaveLength(2)
  })

  it('hasChildren 反映真实父子关系', () => {
    const sessions = ref<AgentSession[]>([
      sess('a'),
      sess('b', { parentSessionId: 'a' }),
      sess('c')
    ])
    const tree = useSessionTree(computed(() => sessions.value))
    expect(tree.hasChildren('a')).toBe(true)
    expect(tree.hasChildren('b')).toBe(false)
    expect(tree.hasChildren('c')).toBe(false)
  })

  it('searchQuery 命中后只保留命中路径上的祖先', () => {
    const sessions = ref<AgentSession[]>([
      sess('a', { title: 'top' }),
      sess('b', { parentSessionId: 'a', title: 'child-b' }),
      sess('c', { parentSessionId: 'b', title: 'grandchild-c' }),
      sess('d', { parentSessionId: 'a', title: 'child-d' })
    ])
    const searchQuery = ref('grandchild')
    const tree = useSessionTree(computed(() => sessions.value), {
      searchQuery
    })
    // 命中 c('grandchild-c'),但 a 和 b 是其祖先应保留
    const ids = tree.flat.value.map((n) => n.session.id)
    expect(ids).toContain('c')
    expect(ids).toContain('a')
    expect(ids).toContain('b')
    // d 整支都不命中 → 应被剪枝
    expect(ids).not.toContain('d')
  })
})