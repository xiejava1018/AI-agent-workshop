/**
 * useSessionTree —— 把扁平会话列表构造为 fork tree + 管理 collapsed 状态。
 *
 * 对齐 apps/web SessionSidebar.tsx 的 buildSessionTree + SessionTreeItem 逻辑:
 *   - 每个 session 可能拥有 `parentSessionId`(表示它从哪个 session fork 出去)
 *   - 一个父 session 可以有多个子 session(并行分支)
 *   - 用 Set<sessionId> 维护折叠状态;仅顶层 node 的“折叠”按钮可见
 *
 * 实现要点:
 *   - 幂等性:同一个 id 只进 byId 一次;可能 id 出现在多 session 中的重名不会发生
 *   - 环防护:走 parentOf 链时 visited Set 防护循环引用
 *   - 隐藏被折叠子树的会话不参与 filter 排序(仍保留层级位置以便 expand)
 *   - filteredFlat:从 root DFS 取出仍未被隐藏的节点,按“pinned 优先 + updatedAt desc”
 *     在每层排序(apps/web 也是这样)
 */
import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import type { AgentSession } from '@/api/agent'

export interface SessionTreeNode {
  session: AgentSession
  /** 子 fork 节点(可能为空) */
  children: SessionTreeNode[]
  /** 在树中的深度(0 = 顶层),给缩进用 */
  depth: number
}

export interface UseSessionTreeOptions {
  /** 可选外部搜索词;搜索命中后隐藏折叠子树内不命中的分支 */
  searchQuery?: Ref<string>
}

export interface UseSessionTreeResult {
  /** 顶层节点(无 parent) */
  roots: ComputedRef<SessionTreeNode[]>
  /** 给虚拟列表用的扁平数组:仅未被折叠隐藏的节点,按渲染顺序 */
  flat: ComputedRef<SessionTreeNode[]>
  /** 是否被折叠的 id Set */
  collapsedIds: Ref<Set<string>>
  /** toggle 子树折叠 */
  toggle: (sessionId: string) => void
  /** 是否是父(有子节点) */
  hasChildren: (sessionId: string) => boolean
  /** 是否被折叠 */
  isCollapsed: (sessionId: string) => boolean
}

/**
 * 构造 tree(纯函数)。节点按子节点 updatedAt desc 排序,
 * 同级里 pinned 优先。
 */
export function buildSessionTree(
  sessions: ReadonlyArray<AgentSession>
): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>()
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [], depth: 0 })
  }

  const parentOf = new Map<string, string>()
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId)
  }

  /**
   * 走 parentOf 链找到最近的有 id 祖先。
   * 环检测:双向引用(a→b 且 b→a)用下面两趟方式拆:
   *   - 第一趟计算 bestParent(只考虑中间 id 链上的 byId 命中)
   *   - 第二趟:发现 x→y 且 y 链会跳回 x,二者都升级为 root
   * 理论上能处理任意长度的环,这里只防护实践中的双向引用。
   */
  const bestParent = new Map<string, string | null>()
  function resolveAncestor(id: string): string | null {
    if (bestParent.has(id)) return bestParent.get(id)!
    let cur = parentOf.get(id)
    const visited = new Set<string>()
    while (cur) {
      if (visited.has(cur)) {
        bestParent.set(id, null)
        return null
      }
      visited.add(cur)
      if (byId.has(cur)) {
        bestParent.set(id, cur)
        return cur
      }
      cur = parentOf.get(cur)
    }
    bestParent.set(id, null)
    return null
  }

  // 第二趟:检测双向挂
  for (const node of byId.values()) {
    if (!bestParent.has(node.session.id)) {
      resolveAncestor(node.session.id)
    }
    const ancVal = bestParent.get(node.session.id)
    if (!ancVal) continue // null = root, undefined = 未计算
    // node 挂在 anc 下,但 anc 的祖先链是否会跳回 node?
    if (!bestParent.has(ancVal)) resolveAncestor(ancVal)
    let cur: string | null | undefined = bestParent.get(ancVal)
    if (cur === undefined) cur = resolveAncestor(ancVal)
    const visited2 = new Set<string>([ancVal])
    while (cur) {
      if (cur === node.session.id) {
        // 双向挂,anc 和 node 都升级为 root
        bestParent.set(ancVal, null)
        bestParent.set(node.session.id, null)
        break
      }
      if (visited2.has(cur)) break
      visited2.add(cur)
      if (!bestParent.has(cur)) resolveAncestor(cur)
      cur = bestParent.get(cur)
    }
  }

  const roots: SessionTreeNode[] = []
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id)
    if (ancestor) {
      byId.get(ancestor)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // 子节点: pinned 优先(updatedAt desc 决胜)
  function sortChildren(nodes: SessionTreeNode[]) {
    nodes.sort((a, b) => {
      const ap = a.session.pinned === true
      const bp = b.session.pinned === true
      if (ap !== bp) return ap ? -1 : 1
      return (b.session.updatedAt ?? '').localeCompare(a.session.updatedAt ?? '')
    })
    for (const n of nodes) {
      sortChildren(n.children)
      n.children.forEach((c) => (c.depth = n.depth + 1))
    }
  }

  sortChildren(roots)
  return roots
}

/**
 * 深度遍历:返回渲染顺序的扁平节点列表(已考虑 collapsed 状态)。
 * 遇到折叠的节点仍保留该节点,但跳过其 children。
 */
export function flattenTree(
  roots: ReadonlyArray<SessionTreeNode>,
  collapsedIds: ReadonlySet<string>
): SessionTreeNode[] {
  const out: SessionTreeNode[] = []
  function visit(n: SessionTreeNode) {
    out.push(n)
    if (collapsedIds.has(n.session.id)) return
    for (const c of n.children) visit(c)
  }
  for (const r of roots) visit(r)
  return out
}

/**
 * useSessionTree composable —— 提供 collapsed 状态 + 计算 roots / flat。
 *
 * 用 reactive Set 而不是 ref<Set> —— Set 的 .add() 是原地变更,
 * reactive 触发追踪依赖;ref 会要求 .value.add()。
 */
export function useSessionTree(
  sessions: ComputedRef<ReadonlyArray<AgentSession>> | Ref<ReadonlyArray<AgentSession>>,
  opts: UseSessionTreeOptions = {}
): UseSessionTreeResult {
  const collapsedIds = reactive(new Set<string>())

  const roots = computed(() => {
    const base = buildSessionTree(sessions.value as AgentSession[])
    if (!opts.searchQuery) return base
    const q = opts.searchQuery.value.trim().toLowerCase()
    if (!q) return base
    // 搜索模式:只保留 title 命中或任意子孙命中的节点;其余整体隐藏。
    // 简化:直接走 DFS,命中的祖先保留(即便自身不命中)。
    function prune(nodes: SessionTreeNode[]): SessionTreeNode[] {
      const out: SessionTreeNode[] = []
      for (const n of nodes) {
        const selfHit = (n.session.title ?? '').toLowerCase().includes(q)
        const kids = prune(n.children)
        if (selfHit || kids.length > 0) {
          out.push({ ...n, children: kids })
        }
      }
      return out
    }
    return prune(base)
  })

  const flat = computed(() => {
    // 计算 collapsedIds 的依赖需要在 reactive Set 上读取来追踪;
    // 这里在 flat computed 内部迭代 Set → Vue 会收集 .has() 的依赖。
    const snapshot: ReadonlySet<string> = collapsedIds
    return flattenTree(roots.value, snapshot)
  })

  function toggle(sessionId: string) {
    if (collapsedIds.has(sessionId)) collapsedIds.delete(sessionId)
    else collapsedIds.add(sessionId)
  }

  function hasChildren(sessionId: string): boolean {
    function find(nodes: SessionTreeNode[]): boolean {
      for (const n of nodes) {
        if (n.session.id === sessionId) return n.children.length > 0
        if (find(n.children)) return true
      }
      return false
    }
    return find(roots.value)
  }

  function isCollapsed(sessionId: string): boolean {
    return collapsedIds.has(sessionId)
  }

  return { roots, flat, collapsedIds: collapsedIds as unknown as Ref<Set<string>>, toggle, hasChildren, isCollapsed }
}