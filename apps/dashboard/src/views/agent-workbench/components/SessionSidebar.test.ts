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