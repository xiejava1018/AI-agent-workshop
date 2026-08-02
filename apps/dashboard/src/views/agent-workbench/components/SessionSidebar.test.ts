/**
 * SessionSidebar.vue —— 源级别契约测试。
 *
 * 通过文件系统级读取 + 正则,锁定关键 UI 视觉合约不被未来重构破坏。
 * 主要盯:
 *   - Header 三个元素:search box / New text button / Refresh button
 *   - 54px 固定行高
 *   - active border-left:2px indicator
 *   - inline 3-segment Delete 确认(无 el-popconfirm)
 *   - 22 字标题 ellipsis + 32×32 action 按钮
 *   - pinned 行常显 unpin icon
 *   - 蓝色 hover 高亮 rgba(37,99,235,0.35)
 *   - SessionItemRow 子组件 import + correct props
 *   - useSessionTree / useUnreadSessions / useRunningSessions composables 接入
 *
 * 这些都是对齐 apps/web 视觉的核心 UX 契约;如果未来对话修改了任意一条,
 * src-locked 测试会失败提醒。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SESSION_SIDEBAR = path.resolve(
  __dirname,
  './SessionSidebar.vue'
)
const ROW = path.resolve(__dirname, './SessionItemRow.vue')

function readSource(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

describe('SessionSidebar.vue 源契约(对 apps/web)', () => {
  const src = readSource(SESSION_SIDEBAR)

  it('导入 useSessionTree 和 useUnreadSessions composables', () => {
    expect(src).toMatch(/import\s+\{[^}]*useSessionTree[^}]*\}\s+from\s+['"][^'"]*useSessionTree['"]/)
    expect(src).toMatch(/import\s+\{[^}]*useUnreadSessions[^}]*\}\s+from\s+['"][^'"]*useUnreadSessions['"]/)
  })

  it('导入 SessionItemRow 子组件(避免单文件超长)', () => {
    expect(src).toMatch(/import\s+SessionItemRow\s+from\s+['"][^'"]*SessionItemRow\.vue['"]/)
  })

  it('Header 含输入框 + New 文字按钮 + Refresh 按钮', () => {
    expect(src).toMatch(/<el-input[^>]*v-model="searchQuery"/)
    expect(src).toMatch(/wb-sidebar-new-btn/)
    expect(src).toMatch(/wb-sidebar-refresh-btn/)
    expect(src).toMatch(/wb-sidebar-new-label[^>]*>\s*New/)
  })

  it('Refresh 有 done 状态(2s 内绿色 √)', () => {
    expect(src).toMatch(/refreshDone\.value\s*=\s*true/)
    expect(src).toMatch(/done:\s*refreshDone/)
    expect(src).toMatch(/<polyline\s+points="20\s+6\s+9\s+17\s+4\s+12"\s*\/>/) // ✓ 形状
  })

  it('active 行有 left border indicator 类(row 内部)', () => {
    const rowSrc = readSource(ROW)
    expect(rowSrc).toMatch(/border-left-color:\s*var\(--wb-accent\)/)
  })

  it('用三段式 Delete 确认(无 el-popconfirm)', () => {
    // SessionItemRow 内部含 wb-confirm-text + wb-confirm-actions + 两个 wb-confirm-btn
    const rowSrc = readSource(ROW)
    expect(rowSrc).toMatch(/wb-confirm-text/)
    expect(rowSrc).toMatch(/wb-confirm-actions/)
    expect(rowSrc).toMatch(/wb-confirm-btn--danger/)
    expect(rowSrc).toMatch(/wb-confirm-btn--cancel/)
    // 主文件不再有 el-popconfirm
    expect(src).not.toMatch(/el-popconfirm/)
  })

  it('22 字 ellipsis 截断', () => {
    const rowSrc = readSource(ROW)
    expect(rowSrc).toMatch(/truncateTitle\([^,]+,\s*22/)
  })

  it('32×32 action 按钮', () => {
    const rowSrc = readSource(ROW)
    expect(rowSrc).toMatch(/width:\s*32px/)
    expect(rowSrc).toMatch(/height:\s*32px/)
  })

  it('蓝色 hover 高亮 rgba(37,99,235,0.35)', () => {
    const rowSrc = readSource(ROW)
    expect(rowSrc).toMatch(/rgba\(37,\s*99,\s*235,\s*0\.35\)/)
  })

  it('pinned 行常显 unpin icon(独立 button 元素 + wb-pin-persistent 类)', () => {
    const rowSrc = readSource(ROW)
    expect(rowSrc).toMatch(/wb-pin-persistent/)
  })

  it('worktree branch 显示在 meta 行', () => {
    const rowSrc = readSource(ROW)
    expect(rowSrc).toMatch(/v-if="s\.worktreeBranch"/)
    expect(rowSrc).toMatch(/wb-session-meta-branch/)
  })

  it('messageCount 显示', () => {
    const rowSrc = readSource(ROW)
    expect(rowSrc).toMatch(/typeof s\.messageCount === 'number'/)
    expect(rowSrc).toMatch(/msgs/)
  })

  it('fork 子节点有 indent 缩进', () => {
    expect(src).toMatch(/paddingLeft.*depth.*\*\s*14/)
  })

  it('rows 高度 54px', () => {
    const rowSrc = readSource(ROW)
    expect(rowSrc).toMatch(/height:\s*54px/)
  })

  it('el-popconfirm 替换为本地 3-segment 确认(no popconfirm)', () => {
    expect(src).not.toMatch(/el-popconfirm/)
  })

  it('使用 useRunningSessions 提供 running map', () => {
    expect(src).toMatch(/useRunningSessions/)
  })

  it('根容器是 wb-sidebar-pane 且是滚动容器', () => {
    expect(src).toMatch(/class="wb-sidebar-pane"/)
    expect(src).toMatch(/\.wb-sidebar-pane\s*\{[^}]*overflow-y:\s*auto/m)
  })
})

describe('SessionItemRow.vue 源契约', () => {
  const rowSrc = readSource(ROW)

  it('pin 按钮 no longer 带 v-if="!isPinned" — pinned 行 hover 时也能看到', () => {
    expect(rowSrc).not.toMatch(/v-if="!isPinned"/)
    expect(rowSrc).toMatch(/aria-label="(取消|置)置顶"/)
  })
})

describe('Bug #2 修复契约:1 条竖线', () => {
  const css = readSource(
    path.resolve(__dirname, '../styles/workbench.css')
  )
  // 抽出 .wb-session-item.active { ... } 块(去除 CSS 注释干扰)
  function extractBlock(src: string, selector: string): string | null {
    const lines = src.split('\n')
    let depth = 0
    let body = ''
    let inRule = false
    let braceDepthAtStart = -1
    for (const ln of lines) {
      const idx = ln.indexOf(selector)
      if (!inRule && idx >= 0) {
        inRule = true
        braceDepthAtStart = depth
      }
      if (inRule) {
        for (const ch of ln) {
          if (ch === '{') {
            depth++
            if (braceDepthAtStart < 0) braceDepthAtStart = depth - 1
          } else if (ch === '}') {
            depth--
          }
        }
        body += ln + '\n'
        if (inRule && depth <= braceDepthAtStart) return body
      }
    }
    return null
  }

  it('workbench.css 中 .wb-session-item.active 不再有 border-left', () => {
    const block = extractBlock(css, '.wb-session-item.active')
    // 如果 .wb-session-item.active 块不存在,更好 — 说明 old code 被全面清除
    if (block) {
      expect(block).not.toMatch(/border-left:\s*\d/)
    } else {
      expect(css).not.toMatch(/\.wb-session-item\.active\s*\{[^}]*border-left:/)
    }
  })

  it('outer .wb-session-item 的 padding=0/border-bottom=0(从 inner row 接管 active 样式)', () => {
    const m = css.match(/^\.wb-session-item\s*\{([^}]+)\}/m)
    expect(m, '缺失 .wb-session-item 规则').toBeTruthy()
    const body = m![1] as string
    expect(body).toMatch(/padding:\s*0/)
    expect(body).toMatch(/border-bottom:\s*0/)
  })
})

describe('AppShell.vue 与 SessionSidebar 的集成', () => {
  // AppShell 那里@select="…" 转发到 useTabTitles 已经测过,这里只锁 attribute contract
  it('AppShell 渲染 SessionSidebar(currentSessionId 属性)', () => {
    const appShell = readSource(
      path.resolve(__dirname, '../AppShell.vue')
    )
    expect(appShell).toMatch(/<SessionSidebar/)
    expect(appShell).toMatch(/current-session-id=|:current-session-id|currentSessionId/)
  })
})