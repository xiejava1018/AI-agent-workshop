/**
 * AppShell —— tab title 友好命名 wiring 契约。
 *
 * AppShell.vue 太重(包含 Sidebar/ModelsConfig/SkillsConfig/FileExplorer 等大量子组件,
 * 不能直接 mount)。这里只锁 AppShell 源文件中关键接线:
 *
 *   - resolveTabTitle 由 composables/useTabTitles 提供
 *   - handleSelect 用 resolveTabTitle
 *   - ChatWindow @auto-rename 事件接住到 handleAutoRename
 *   - handleAutoRename 调用 sessionList.rename
 *
 * 这些是源码层契约 — 防止有人误改接线让 hash 前缀 tab title 复活。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SOURCE = readFileSync(
  resolve(__dirname, './AppShell.vue'),
  'utf-8'
)

describe('AppShell — tab title wiring', () => {
  it('从 useTabTitles composable 导入 resolveTabTitle', () => {
    expect(SOURCE).toMatch(/import\s*\{\s*resolveTabTitle\s+as\s+resolveTabTitlePure\s*\}\s*from\s+['"]\.\/composables\/useTabTitles['"]/)
  })

  it('handleSelect 用 resolveTabTitle(而非 hash 前缀)', () => {
    // 锁定 handleSelect 函数体内调用 resolveTabTitle,而非手写的 `会话 ${id.slice(0, 8)}`
    const idx = SOURCE.search(/function\s+handleSelect\s*\(/)
    expect(idx).toBeGreaterThanOrEqual(0)
    // handleSelect 函数体在下个 2 空格缩进紧邻的空行前结束,
    // 需动态查后面第一个函数起点的位置。
    const after = SOURCE.slice(idx)
    const nextFunc = after.match(/\n  function\s+\w+\s*\(/)
    const body = after.slice(0, nextFunc?.index ?? after.length)
    expect(body).toContain('resolveTabTitle(')
    // 旧 hash prefix 写法应已清除
    expect(body).not.toMatch(/会话\s*\$\{sessionId\.slice\(/)
  })

  it('ChatWindow 接 auto-rename 事件', () => {
    expect(SOURCE).toMatch(/@auto-rename\s*=\s*["']handleAutoRename["']/)
  })

  it('handleAutoRename 调用 sessionList.rename 写后端', () => {
    const match = SOURCE.match(/function\s+handleAutoRename\s*\(/)
    expect(match).toBeTruthy()
    const startIdx = match?.index ?? 0
    const bodyStart = SOURCE.indexOf('{', startIdx)
    // 找下一个 2空格缩进函数起点为函数结束标记
    const after = SOURCE.slice(bodyStart)
    const nextFuncMatch = after.match(/\n  function\s+\w+\s*\(/)
    const bodyEnd = nextFuncMatch?.index ?? after.length
    const body = SOURCE.slice(bodyStart, bodyStart + bodyEnd)
    expect(body).toMatch(/sessionList\.rename\(/)
    expect(body).toMatch(/handleRename\(/)
  })

  it('tabs.title 默认值不再用 hash 前缀(整个文件搜索)', () => {
    // 任何 `title:\`会话 \${...slice...}\`` 都已清除
    expect(SOURCE).not.toMatch(/title:\s*`会话\s*\$\{[^`]*slice\([^)]+\)/)
  })

  it('AppShell 监听 sessions 列表变化以同步 tab.title', () => {
    expect(SOURCE).toMatch(/watch\s*\(\s*\(\s*\)\s*=>\s*sessionList\.sessions\.value/)
  })
})