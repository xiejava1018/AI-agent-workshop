/**
 * Agent API
 */
import request from '@/utils/http'
import type { HttpClient } from '@/utils/http'

const httpClient = request as HttpClient

const PREFIX = '/api/agent'

export interface AgentSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  userId?: string
  teamId?: string | null
  /** M4: false = session 文件不在/未启动(老 M2.x session),不能聊天 */
  available?: boolean
  /** M3 follow-up (issue #4): 从 session-prefs 拉取的 pin 状态 */
  pinned?: boolean
}

export interface SendMessageParams {
  sessionId: string
  content: string
  userId: string
}

/** 会话列表 */
export const listSessions = (params?: { page?: number; page_size?: number }) => {
  return httpClient.get<Http.BaseResponse<{ items: AgentSession[]; total: number }>>({
    url: `${PREFIX}/sessions`,
    params: { page: 1, page_size: 20, ...params },
    keepFullResponse: true
  })
}

/** 创建会话
 * 改:原 /api/agent/sessions 404(后端无)。改调 /api/agent/new,
 * body 必含 type 字段(后端 startRpcSession 必需,否则 500)。
 * type:'ensure_session' 只创建 runtime 不发消息(推荐用于先建后发)。
 *
 * 注意:keepFullResponse 时,后端返回形如
 *   { success: true, sessionId: string, data: null }
 * 不是 BaseResponse 风格。调用方需自己读 sessionId。
 */
export const createSession = (userId: string) => {
  return httpClient.post<Http.BaseResponse<AgentSession>>({
    url: `${PREFIX}/new`,
    data: { type: 'ensure_session', title: '新会话', userId },
    keepFullResponse: true
  })
}

/** 发送消息
 * 改:原 /api/agent/sessions/[id]/messages 404。
 * 后端真实端点是 POST /api/agent/[id](body.type 必填),
 * SSE agent type 接受 'prompt' | 'steer' | 'follow_up'。
 */
export const sendMessage = (sessionId: string, content: string, userId: string) => {
  return httpClient.post<Http.BaseResponse<{ ok: boolean }>>({
    url: `${PREFIX}/${sessionId}`,
    data: { type: 'prompt', message: content, userId },
    keepFullResponse: true
  })
}

/** 获取可用的 Digital Employees */
export const listAvailableAgents = () => {
  return httpClient.get<
    Http.BaseResponse<Array<{ id: string; name: string; description?: string }>>
  >({
    url: '/api/digital-employees',
    keepFullResponse: true
  })
}

/** 启动委托编排任务 */
export const startDelegation = (params: { task: string; mode: string; agentIds: string[] }) => {
  return httpClient.post<Http.BaseResponse<{ taskId: string }>>({
    url: '/api/delegation/start',
    data: params,
    keepFullResponse: true
  })
}

/**
 * 会话操作 (issue #4)
 *
 * 后端在 apps/web/app/api/sessions/[id]/route.ts 里暴露:
 *   PATCH  body: { name?: string, pinned?: boolean }
 *   DELETE
 *
 * Vue 端通过 Vite proxy /api 调用。
 */
export const renameSession = (sessionId: string, name: string) => {
  return httpClient.request<Http.BaseResponse<{ ok: boolean }>>({
    url: `/api/sessions/${encodeURIComponent(sessionId)}`,
    method: 'PATCH',
    data: { name }
  })
}

export const togglePinSession = (sessionId: string, pinned: boolean) => {
  return httpClient.request<Http.BaseResponse<{ ok: boolean; pinned: boolean }>>({
    url: `/api/sessions/${encodeURIComponent(sessionId)}`,
    method: 'PATCH',
    data: { pinned }
  })
}

export const deleteSession = (sessionId: string) => {
  return httpClient.del<Http.BaseResponse<{ ok: boolean }>>({
    url: `/api/sessions/${encodeURIComponent(sessionId)}`
  })
}

// ============================================================================
// Track A 扩展(v1.2 设计文档)
// ============================================================================

/**
 * Bug 2 修复:按 session 拉历史消息
 *
 * 后端: GET /api/agent/[id]/messages?limit=50&before=<isoTimestamp>
 *   响应: { code, data: { messages: AgentMessage[], hasMore, total } }
 *
 * 用于切 tab / 刷新页面时回填 useAgentSession 的本地 messages(否则只靠 SSE
 * 实时事件流,历史全丢)。
 */
export interface FetchSessionMessagesResponse {
  messages: import('@/views/agent-workbench/types').AgentMessage[]
  hasMore: boolean
  total: number
}

export const fetchSessionMessages = (
  sessionId: string,
  opts?: { limit?: number; before?: string }
) => {
  return httpClient.get<Http.BaseResponse<FetchSessionMessagesResponse>>({
    url: `${PREFIX}/${encodeURIComponent(sessionId)}/messages`,
    params: opts,
    keepFullResponse: true
  })
}

/**
 * 订阅全局「哪些 session 在跑」SSE。
 *
 * 后端: GET /api/agent/running/events
 *   frame: { type: 'running', runningSessionIds: string[] }
 *   另发心跳 `:\n\n`,不解码为 JSON,客户端应忽略。
 *
 * Vue 端通过 SSE 直接消费;不进入 axios(axios 不支持流式响应)。
 * 返回 unsubscribe 函数。EventSource 实例由调用方持有以便 close()。
 */
export interface RunningSubscription {
  /** EventSource 句柄,用于 close() 终止连接 */
  source: EventSource
  /** 取消订阅(关闭 SSE) */
  unsubscribe: () => void
}

/**
 * 创建全局 running sessions 订阅。
 * 解析后通过 onFrame 回调推送;onError 仅用于提示,不重连(EventSource 自动重连)。
 */
export const subscribeRunningSessions = (
  onFrame: (frame: { type: 'running'; runningSessionIds: string[] }) => void,
  onError?: (ev: Event) => void
): RunningSubscription => {
  const url = '/api/agent/running/events'
  const source = new EventSource(url)
  source.onmessage = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as { type?: string; runningSessionIds?: string[] }
      if (data.type === 'running') {
        onFrame({ type: 'running', runningSessionIds: data.runningSessionIds ?? [] })
      }
    } catch {
      // 忽略畸形 frame
    }
  }
  if (onError) source.onerror = onError
  const unsubscribe = () => source.close()
  return { source, unsubscribe }
}

// ----------------------------------------------------------------------------
// Models / Skills / Plugins 配置
// ----------------------------------------------------------------------------

/** /api/models-config GET 响应(精简版,只暴露 UI 需要的字段) */
export interface ModelConfigEntry {
  id: string
  name: string
  provider: string
  enabled: boolean
  selected?: boolean
  contextWindow?: number
}

/**
 * 获取模型配置列表。
 *
 * 后端: GET /api/models-config
 *   响应: { providers: Record<string, { models?: Array<{ id, name?, ... }> }> }
 *   此处展开为扁平 UI 模型条目。
 */
export const getModelConfig = async (): Promise<ModelConfigEntry[]> => {
  const res = await httpClient.get<Http.BaseResponse<{
    providers?: Record<string, { models?: Array<{ id: string; name?: string; contextWindow?: number }> }>
  }>>({
    url: '/api/models-config',
    keepFullResponse: true
  })
  const payload = res.data
  const providers = (payload.providers ?? {}) as Record<string, { models?: Array<{ id: string; name?: string; contextWindow?: number }> }>
  const items: ModelConfigEntry[] = []
  for (const [providerName, provider] of Object.entries(providers)) {
    for (const m of provider.models ?? []) {
      if (!m.id) continue
      items.push({
        id: m.id,
        name: m.name ?? m.id,
        provider: providerName,
        enabled: true,
        contextWindow: m.contextWindow
      })
    }
  }
  return items
}

/**
 * 启用/禁用指定模型。
 *
 * 后端: PUT /api/models-config 接受完整 JSON;此处采用「拉取 + 改 enabled + 回写」策略,
 * 仅修改目标模型在 providers 中的存在,避免覆盖其他用户配置。
 *
 * 注意:后端 models.json 结构里没有原生 `enabled` 字段;此函数把 disabled 模型从
 * providers[*].models 中过滤掉来表达 enabled=false;重新启用时恢复。
 * 因此需要先缓存原始配置列表,详见 useConfigPanel。
 */
export const setModelConfig = async (
  modelId: string,
  enabled: boolean
): Promise<void> => {
  // 拉取当前全量配置
  const cur = await httpClient.get<Http.BaseResponse<any>>({
    url: '/api/models-config',
    keepFullResponse: true
  })
  const root = cur.data ?? { providers: {} }
  const providers = (root.providers ?? {}) as Record<string, { models?: any[] }>
  // 在所有 providers 里搜目标 modelId
  let found = false
  for (const [providerName, provider] of Object.entries(providers)) {
    const idx = (provider.models ?? []).findIndex((m: any) => m.id === modelId)
    if (idx === -1) continue
    found = true
    const model = provider.models![idx]
    if (enabled) {
      // 启用:确保模型在数组里(从 hidden 列表恢复需要 client 端 tracking,此处不做)
      // disabled 模型已被 setModelConfig(enabled=false) 过滤掉,这里 no-op
      continue
    } else {
      // 禁用:从 models 数组移除
      provider.models!.splice(idx, 1)
    }
  }
  if (!found && enabled) {
    // 启用一个原本就 disabled 的模型:此处无法恢复(无客户端缓存),由 useConfigPanel
    // 通过记忆原始列表处理,详见 useConfigPanel.setModelEnabled
    return
  }
  await httpClient.request<Http.BaseResponse<{ success: boolean }>>({
    url: '/api/models-config',
    method: 'PUT',
    data: root
  })
}

/** /api/skills?cwd=<path> 响应中单个 skill 条目 */
export interface SkillConfigEntry {
  id: string
  name: string
  description?: string
  enabled: boolean
  source?: string
}

/**
 * 获取技能列表。
 *
 * 后端: GET /api/skills?cwd=<path>
 *   响应: { skills: Array<{ name, description?, ... }>, diagnostics }
 *
 * Vue 端约定:
 *   - 不传 cwd 表示使用全局 cwd(由后端拒绝 400)
 *   - enabled 默认为 true(SKILL.md 文件存在即视为启用)
 */
export const getSkills = async (cwd: string): Promise<SkillConfigEntry[]> => {
  const res = await httpClient.get<Http.BaseResponse<{
    skills?: Array<{ name: string; description?: string; filePath?: string }>
    diagnostics?: unknown
  }>>({
    url: '/api/skills',
    params: { cwd },
    keepFullResponse: true
  })
  const payload = res.data
  const items = (payload.skills ?? []) as Array<{ name: string; description?: string; filePath?: string }>
  return items.map((s) => ({
    id: s.filePath ?? s.name,
    name: s.name,
    description: s.description,
    enabled: true,
    source: s.filePath
  }))
}

/**
 * 启用/禁用技能(切换 SKILL.md 的 disable-model-invocation frontmatter)。
 *
 * 后端: PATCH /api/skills body: { filePath, disableModelInvocation }
 */
export const setSkillEnabled = async (
  filePath: string,
  enabled: boolean
): Promise<void> => {
  await httpClient.request<Http.BaseResponse<{ success: boolean }>>({
    url: '/api/skills',
    method: 'PATCH',
    data: { filePath, disableModelInvocation: !enabled }
  })
}

/** /api/plugins 响应中单个 plugin package 条目 */
export interface PluginConfigEntry {
  id: string
  name: string
  version?: string
  enabled: boolean
  description?: string
}

/**
 * 获取插件列表。
 *
 * 后端: GET /api/plugins?cwd=<path>
 *   响应: { packages: Array<{ source, scope, disabled, installedPath, packageName?, version?, ... }> }
 */
export const getPlugins = async (cwd: string): Promise<PluginConfigEntry[]> => {
  const res = await httpClient.get<Http.BaseResponse<{
    packages?: Array<{
      source: string
      scope: string
      disabled: boolean
      installedPath?: string
      packageName?: string
      version?: string
    }>
  }>>({
    url: '/api/plugins',
    params: { cwd },
    keepFullResponse: true
  })
  const payload = res.data
  const items = (payload.packages ?? []) as Array<{
    source: string
    scope: string
    disabled: boolean
    installedPath?: string
    packageName?: string
    version?: string
  }>
  return items.map((p) => ({
    id: `${p.scope}::${p.source}`,
    name: p.packageName ?? p.source,
    version: p.version,
    enabled: !p.disabled,
    description: p.source
  }))
}

/**
 * 启用/禁用插件包。
 *
 * 后端: POST /api/plugins body: { action: 'disable'|'enable', source, scope, cwd }
 */
export const setPluginEnabled = async (
  cwd: string,
  scope: string,
  source: string,
  enabled: boolean
): Promise<void> => {
  await httpClient.request<Http.BaseResponse<unknown>>({
    url: '/api/plugins',
    method: 'POST',
    data: {
      action: enabled ? 'enable' : 'disable',
      source,
      scope,
      cwd
    }
  })
}

export interface FileData {
  content: string
  language?: string
  size: number
  binary?: boolean
}

export interface FileListResponse {
  items?: Array<{
    name: string
    path: string
    isDir: boolean
    size?: number
    modifiedAt?: string
    children?: never
  }>
  entries?: Array<{
    name: string
    path?: string
    isDir: boolean
    size?: number
    modifiedAt?: string
  }>
}

/**
 * File routes are not currently exposed by apps/web. Keep the wrappers ready
 * for the shared contract so the explorer can swap in the real adapter later.
 */
/**
 * File routes — apps/web exposes two GET endpoints (see d1e4100):
 *   GET /api/agent/[id]/files?path=<relative-dir>
 *     列目录(不递归),返 { code, data: { items: FileNode[] } }
 *   GET /api/agent/[id]/files/<relative-file-path>
 *     读单个文本文件,返 { code, data: { content, size, modifiedAt } }
 *
 * List endpoint takes `path` as a query param; read endpoint puts it in
 * the URL path (catch-all `[...path]`).
 */
export const listFiles = async (
  sessionId: string,
  path = ''
): Promise<import('@/views/agent-workbench/types').FileNode[]> => {
  const response = await httpClient.get<Http.BaseResponse<FileListResponse>>({
    url: `${PREFIX}/${encodeURIComponent(sessionId)}/files`,
    params: { path },
    keepFullResponse: true
  })
  const payload =
    (response as Http.BaseResponse<FileListResponse> & FileListResponse).data ?? response
  const rows = payload.items ?? payload.entries ?? []
  return rows.map((row) => ({
    name: row.name,
    path: row.path ?? (path ? `${path.replace(/\/$/, '')}/${row.name}` : row.name),
    isDir: row.isDir,
    size: row.size,
    modifiedAt: row.modifiedAt
  }))
}

export const getFile = (sessionId: string, filePath: string) => {
  // apps/web uses catch-all `[...path]` — path goes in the URL, not query.
  // Reject `..` and absolute paths client-side too (server has assertWithinRoot
  // as the authoritative gate).
  const safe = filePath.split('/').filter((seg) => seg && seg !== '..').join('/')
  if (!safe) {
    return Promise.reject(new Error('invalid file path'))
  }
  return httpClient.get<Http.BaseResponse<FileData>>({
    url: `${PREFIX}/${encodeURIComponent(sessionId)}/files/${safe}`,
    keepFullResponse: true
  })
}
