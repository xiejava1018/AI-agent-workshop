import { ref, type Ref } from 'vue'
import { listFiles as requestFileList } from '@/api/agent'
import type { FileNode } from '../types'
import { safeFilePath } from '../types'

export interface FileExplorerAdapter {
  listFiles: (sessionId: string, path: string) => Promise<FileNode[]>
}

export interface UseFileExplorerOptions extends FileExplorerAdapter {
  /**
   * Fall back to an in-memory mock tree when the backend has no files route
   * (or returns 404 / network error). Defaults to false: the Vue side
   * trusts that apps/web has the GET /api/agent/[id]/files endpoints
   * (added in the same change-set as this composable). Tests inject mock
   * adapters explicitly instead of flipping this flag.
   */
  useMockFallback?: boolean
}

const MOCK_FILES: Record<string, FileNode[]> = {
  '': [
    { name: 'src', path: 'src', isDir: true },
    { name: 'README.md', path: 'README.md', isDir: false, size: 1024 }
  ],
  src: [
    { name: 'main.ts', path: 'src/main.ts', isDir: false, size: 1400 },
    { name: 'components', path: 'src/components', isDir: true }
  ],
  'src/components': [{ name: 'App.vue', path: 'src/components/App.vue', isDir: false, size: 2100 }]
}

function normalizeMockPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '')
}

function getMockFiles(path: string): FileNode[] {
  const normalizedPath = normalizeMockPath(path)
  return (MOCK_FILES[normalizedPath] ?? []).map((node) => ({
    ...node,
    children: node.isDir ? undefined : node.children
  }))
}

function findNode(nodes: readonly FileNode[], path: string): FileNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.isDir && node.children) {
      const found = findNode(node.children, path)
      if (found) return found
    }
  }
  return undefined
}

function updateNode(nodes: readonly FileNode[], path: string, children: FileNode[]): FileNode[] {
  return nodes.map((node) => {
    if (node.path === path) return { ...node, children }
    if (!node.isDir || !node.children) return node
    return { ...node, children: updateNode(node.children, path, children) }
  })
}

function validatePath(path: string, allowEmpty = false): string {
  if (allowEmpty && path === '') return path
  const validPath = safeFilePath(path)
  if (!validPath) throw new Error('Invalid file path')
  return validPath
}

/**
 * Manage the workspace tree for a session. The API adapter is injectable so
 * tree behavior can be tested without a browser or a running backend.
 */
export function useFileExplorer(
  sessionId: string | Ref<string>,
  options?: Partial<UseFileExplorerOptions>
) {
  const tree = ref<FileNode[]>([])
  const expanded = ref<Set<string>>(new Set())
  const selectedPath = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const currentRootPath = ref('')
  // 默认禁用 mock：apps/web 已补 GET /api/agent/[id]/files 端点。
  // 测试/e2e 注入自定义 adapter 时才走 mock fallback。
  const allowMockFallback = options?.useMockFallback ?? false

  const getSessionId = () => (typeof sessionId === 'string' ? sessionId : sessionId.value)
  const listFiles =
    options?.listFiles ??
    (async (id: string, path: string) => {
      const response = await requestFileList(id, path)
      return response
    })

  const loadTree = async (rootPath = ''): Promise<void> => {
    const validRootPath = validatePath(rootPath, true)
    loading.value = true
    error.value = null
    currentRootPath.value = validRootPath
    try {
      let files: FileNode[]
      try {
        files = await listFiles(getSessionId(), validRootPath)
      } catch (requestError) {
        if (!allowMockFallback) throw requestError
        files = getMockFiles(validRootPath)
      }
      tree.value = files.map((node) => ({ ...node }))
      expanded.value = new Set()
      selectedPath.value = null
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : String(requestError)
      error.value = message
      throw requestError
    } finally {
      loading.value = false
    }
  }

  const toggleExpand = async (path: string): Promise<void> => {
    const validPath = validatePath(path)
    const node = findNode(tree.value, validPath)
    if (!node?.isDir) return

    const nextExpanded = new Set(expanded.value)
    if (nextExpanded.has(validPath)) {
      nextExpanded.delete(validPath)
      expanded.value = nextExpanded
      return
    }

    if (node.children === undefined) {
      error.value = null
      try {
        let children: FileNode[]
        try {
          children = await listFiles(getSessionId(), validPath)
        } catch (requestError) {
          if (!allowMockFallback) throw requestError
          children = getMockFiles(validPath)
        }
        tree.value = updateNode(
          tree.value,
          validPath,
          children.map((child) => ({ ...child }))
        )
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : String(requestError)
        error.value = message
        throw requestError
      }
    }

    nextExpanded.add(validPath)
    expanded.value = nextExpanded
  }

  const select = (path: string | null): void => {
    if (path === null) {
      selectedPath.value = null
      return
    }
    selectedPath.value = validatePath(path)
  }

  return {
    tree,
    expanded,
    selectedPath,
    loading,
    error,
    currentRootPath,
    loadTree,
    toggleExpand,
    select
  }
}
