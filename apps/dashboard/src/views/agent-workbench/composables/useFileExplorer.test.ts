import { describe, expect, it, vi } from 'vitest'
import { useFileExplorer } from './useFileExplorer'
import type { FileNode } from '../types'

describe('useFileExplorer', () => {
  it('loads the root tree and tracks selection', async () => {
    const tree: FileNode[] = [{ name: 'src', path: 'src', isDir: true }]
    const listFiles = vi.fn().mockResolvedValue(tree)
    const explorer = useFileExplorer('session-1', { listFiles })

    await explorer.loadTree('workspace')
    explorer.select('src')

    expect(explorer.tree.value).toEqual(tree)
    expect(explorer.selectedPath.value).toBe('src')
    expect(listFiles).toHaveBeenCalledWith('session-1', 'workspace')
  })

  it('expands and collapses directories without mutating the previous tree', async () => {
    const root: FileNode[] = [{ name: 'src', path: 'src', isDir: true }]
    const children: FileNode[] = [{ name: 'main.ts', path: 'src/main.ts', isDir: false }]
    const listFiles = vi.fn().mockResolvedValueOnce(root).mockResolvedValueOnce(children)
    const explorer = useFileExplorer('session-1', { listFiles })

    await explorer.loadTree('workspace')
    const rootSnapshot = explorer.tree.value
    await explorer.toggleExpand('src')
    expect(explorer.expanded.value.has('src')).toBe(true)
    expect(explorer.tree.value[0]).not.toBe(rootSnapshot[0])
    expect(explorer.tree.value[0].children).toEqual(children)

    await explorer.toggleExpand('src')
    expect(explorer.expanded.value.has('src')).toBe(false)
    expect(listFiles).toHaveBeenCalledTimes(2)
  })

  it('reports an error and rejects unsafe paths', async () => {
    const listFiles = vi.fn().mockRejectedValue(new Error('offline'))
    const explorer = useFileExplorer('session-1', { listFiles })

    await expect(explorer.loadTree('../outside')).rejects.toThrow('Invalid file path')
    await expect(explorer.loadTree('workspace')).rejects.toThrow('offline')
    expect(explorer.error.value).toBe('offline')
    expect(listFiles).toHaveBeenCalledTimes(1)
  })
})
