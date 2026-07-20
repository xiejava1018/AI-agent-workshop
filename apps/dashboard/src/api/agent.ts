/**
 * Agent API
 *
 * v1.6 (chrome v1):引入通用 RPC 包装 `sendAgentCommand<T>`;
 *   - sendMessage 重构为 sendAgentCommand 内部调用,签名不变
 *   - 新增 6 个 chrome v1 command:
 *       getSlashCommands / setModel / setThinkingLevel / setTools / getTools / cancelQueue
 *   - 新增 ToolEntry / SlashCommandInfo / SlashCommandsResponse 类型(自包含,
 *     不依赖 apps/web 的类型导出)
 *   - 新增 ToolPreset 常量(对齐 apps/web/lib/tool-presets.ts PRESET_*) + 纯函数
 *     getToolNamesForPreset(preset)
 */
import request from '@/utils/http'
import type { HttpClient } from '@/utils/http'

const httpClient = request as HttpClient

const PREFIX = '/api/agent'

/** 工具预设常量(对齐 apps/web/lib/tool-presets.ts) */
export const PRESET_NONE: string[] = []
export const PRESET_DEFAULT: string[] = ['read', 'bash', 'edit', 'write']
export const PRESET_FULL: string[] = ['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls']

/**
 * 工具 preset(对齐 apps/web/lib/tool-presets.ts ToolPreset):"none" 而非 "off"。
 * Vue 端在 types.ts ToolPreset 已对齐这里。
 */
export type ToolPreset = 'none' | 'default' | 'full'

/**
 * get_tools 响应单条(对齐 apps/web/lib/tool-presets.ts ToolEntry)。
 * description / active 在 SDK 里通常都会带,Vue 端保留可选。
 */
export interface ToolEntry {
  name: string
  description?: string
  active?: boolean
}

/**
 * get_commands 单条(对齐 apps/web/hooks/useAgentSession.ts SlashCommandInfo)。
 * 这里复制完整 sourceInfo 形状以备 T5 palette 渲染,apps/dashboard 自包含。
 */
export interface SlashCommandInfo {
  name: string
  description?: string
  source: 'extension' | 'prompt' | 'skill' | 'builtin'
  sourceInfo?: {
    path: string
    source: string
    scope: 'user' | 'project' | 'temporary'
    origin: 'package' | 'top-level'
    baseDir?: string
  }
}

/** get_commands 响应:服务端包成 `{ commands?: SlashCommandInfo[] }` */
export interface SlashCommandsResponse {
  commands?: SlashCommandInfo[]
}

/**
 * 通用 RPC 包装 —— POST /api/agent/[id],body 是任意 `{ type: ... }` command。
 *
 * 为什么放在这里:apps/web 的 apps/web/lib/agent-client.ts 有同样的
 * sendAgentCommand<T>(sid, command);Vue 端之前只有 sendMessage(sid, text, userId)
 * 这个特殊化包装,所有新 command 都要在它身上重复 6 次样板代码;这里抽到一处。
 *
 * 错误约定:httpClient 已把 2xx 之外的响应 reject。调用方只需要 catch 业务错。
 */
export const sendAgentCommand = <T = unknown>(
  sessionId: string,
  body: Record<string, unknown>
) => {
  return httpClient.post<Http.BaseResponse<T>>({
    url: `${PREFIX}/${encodeURIComponent(sessionId)}`,
    data: body,
    keepFullResponse: true
  })
}

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

/**
 * 发送消息。
 *
 * 历史:之前每个新 command 都手写一次 POST /api/agent/[id] 的样板代码;
 *      现在统一走 sendAgentCommand 通用包装。这里只做 {type:'prompt'} 专属包装,
 *      保留 (sessionId, content, userId) 三参签名,useEventStream.send() 调用方不破。
 *
 * 后端:`POST /api/agent/[id]`,body 必含 `type` 字段(否则 500)。
 *   `'prompt' | 'steer' | 'follow_up' | 'get_commands'` 触发会话状态变更,
 *   其它 type 走 apps/web/lib/rpc-manager.ts 的 withFinalRunningNotification 路径。
 */
export const sendMessage = (sessionId: string, content: string, userId: string) => {
  return sendAgentCommand<{ ok: boolean }>(sessionId, {
    type: 'prompt',
    message: content,
    userId
  })
}

// ============================================================================
// chrome v1:6 个新 RPC 包装(sendAgentCommand 复用层)
// ============================================================================

/**
 * 拉取 slash 命令列表。
 *
 * 后端:`{ type: 'get_commands' }` → 响应 `{ commands?: SlashCommandInfo[] }`。
 * 响应实际由 apps/web/lib/rpc-manager.ts `case 'get_commands'` 返回。
 */
export const getSlashCommands = (sessionId: string) => {
  return sendAgentCommand<SlashCommandsResponse>(sessionId, { type: 'get_commands' })
}

/**
 * 切换模型。
 *
 * 后端:`{ type: 'set_model', provider, modelId }` →
 *   apps/web/lib/rpc-manager.ts `case 'set_model'` 直接调 registry.find + setModel。
 */
export const setModel = (sessionId: string, provider: string, modelId: string) => {
  return sendAgentCommand<{ id: string; provider: string }>(sessionId, {
    type: 'set_model',
    provider,
    modelId
  })
}

/**
 * 切换 thinking level。
 *
 * 后端:`{ type: 'set_thinking_level', level }` → 直接调 inner.setThinkingLevel。
 * 注意:某些 model 上 xhigh 自动 clamp 到 high,client 端按用户原始选择显示,但
 * SSE thinking_level_changed 会回传真实生效的 level(若 SDK 实现)。
 */
export const setThinkingLevel = (sessionId: string, level: string) => {
  return sendAgentCommand<null>(sessionId, { type: 'set_thinking_level', level })
}

/**
 * 设置激活的工具子集。
 *
 * 后端:`{ type: 'set_tools', toolNames: string[] }` → 调 inner.setActiveToolsByName。
 * 空数组会 force-empty system prompt(SDK 的工具全 off 时不希望看到工具描述)。
 */
export const setTools = (sessionId: string, toolNames: string[]) => {
  return sendAgentCommand<null>(sessionId, { type: 'set_tools', toolNames })
}

/**
 * 拉取工具列表(全表 + 是否激活)。
 *
 * 后端:`{ type: 'get_tools' }` → 返 ToolEntry[]。
 */
export const getTools = (sessionId: string) => {
  return sendAgentCommand<ToolEntry[]>(sessionId, { type: 'get_tools' })
}

/**
 * 取消某条排队项。
 *
 * OQ-2 已知后端 SDK 没有 cancel_queue 单条指令(apps/web/lib/rpc-manager.ts
 * 只有 `case 'clear_queue'` 全量清)。这里仍走 RPC 试一下:服务端若不认识该
 * type,会 rejected,composable 层捕获并降级为本地移除。详见 useAgentSession.cancelQueue。
 */
export const cancelQueue = (sessionId: string, id: string) => {
  return sendAgentCommand<null>(sessionId, { type: 'cancel_queue', id })
}

/**
 * 将 ToolPreset 映射到具体 tool name 列表(纯函数,无 IO)。
 *
 * 这里与 apps/web/lib/tool-presets.ts getToolNamesForPreset 完全对齐:不走 allTools 过滤,
 * 三档写死。这是 chrome v1 与 design §3.1 的偏差 —— design 误用了 allTools.filter,
 * React 参考实现是常量数组。
 */
export function getToolNamesForPreset(preset: ToolPreset): string[] {
  if (preset === 'none') return [...PRESET_NONE]
  if (preset === 'full') return [...PRESET_FULL]
  return [...PRESET_DEFAULT]
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
 * 改:之前调自己写的 /api/agent/[id]/messages 失败 —— SDK 在 idle/LRU 时
 *   `getEntries()` 返空。apps/web React 实测切 tab + 刷新历史完整,证明
 *   /api/sessions/[id] 走 SessionManager 累积的内存 entry,可工作。
 *
 * 这里直接复用 apps/web 的端点,响应里取 context.messages。
 * 后端: GET /api/sessions/[id]?deferThinking=1&deferMedia=1
 *   响应: { context: { messages, entryIds, thinkingLevel, model }, ... }
 *
 * 注意 shape 转换:
 * - 后端 message.content 是 Array<{type, text}>(SDK 原生)
 * - 前端 AgentMessage.content 是 string(MessageView 用 v-html 渲染)
 * - 后端 message 没有顶层 id,前端 AgentMessage.id 必填,得用 entryIds[i] 配对
 */
export interface FetchSessionMessagesResponse {
  messages: import('@/views/agent-workbench/types').AgentMessage[]
  hasMore: boolean
  total: number
}

interface SdkTextBlock {
  type?: string
  text?: string
  thinking?: string
}

interface SdkMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: SdkTextBlock[] | string
  timestamp?: number
  errorMessage?: string
  stopReason?: string
}

interface SessionDetailContext {
  messages: SdkMessage[]
  entryIds?: string[]
  thinkingLevel?: string
  model?: { provider: string; modelId: string } | null
}

interface SessionDetailResponse {
  path: string
  id: string
  leafId: string | null
  context: SessionDetailContext
}

/** 把 SDK content 数组展平成字符串(text/thinking 块拼接) */
function flattenSdkContent(content: SdkMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => {
      if (typeof b?.text === 'string') return b.text
      if (typeof b?.thinking === 'string') return b.thinking
      return ''
    })
    .join('')
}

export const fetchSessionMessages = async (
  sessionId: string,
  _opts?: { limit?: number; before?: string }
) => {
  const res = await httpClient.get<Http.BaseResponse<SessionDetailResponse>>({
    url: `/api/sessions/${encodeURIComponent(sessionId)}?deferThinking=1&deferMedia=1`,
    keepFullResponse: true
  })
  // httpClient 的 makeRequest 已把 AxiosResponse.data 展平成响应体本身(见
  // utils/http/index.ts),且 /api/sessions/[id] 是 Next.js 路由,直接返回
  //   { sessionId, filePath, info, leafId, tree, context: { messages, entryIds, ... } }
  // —— context 在顶层,没有被 { code, message, data } 再包一层(那是 Vue 侧
  // /api/agent/* 代理路由的形状,别处如 listSessions 才走 .data)。
  const ctx = (res as { context?: SessionDetailContext }).context
  const rawMsgs = ctx?.messages ?? []
  const entryIds = ctx?.entryIds ?? []
  // 转换 SDK message → 前端 AgentMessage
  // id 优先用 entryIds[i](稳定 entry id),无 entryIds 时退化为 `${role}-${timestamp}-${idx}`
  const messages = rawMsgs.map((m, idx) => {
    const text = flattenSdkContent(m.content)
    const id = entryIds[idx] ?? `hist-${m.role}-${m.timestamp ?? idx}-${idx}`
    const ts = typeof m.timestamp === 'number'
      ? new Date(m.timestamp).toISOString()
      : new Date().toISOString()
    return {
      id,
      role: m.role,
      content: text,
      createdAt: ts,
      streamStatus: 'done' as const
    } as import('@/views/agent-workbench/types').AgentMessage
  })
  return {
    data: {
      messages,
      hasMore: false,
      total: messages.length
    }
  }
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
