/**
 * useAgentSession —— useEventStream 的薄包装,加消息合并 / 状态机 / chrome v1 业务 ref。
 *
 * 主要差异:
 *   - messages 按 messageId 索引(同 messageId 的 delta 自动合并 content)
 *   - 暴露稳定 messageId 派发(useAgentSession 由调用方控制 merge 规则)
 *   - 与 useEventStream 同形 API,Vue 端组件可以无差别切换
 *   - chrome v1 增量:暴露 16+ ref + 7 method wrapper(setModel / setThinkingLevel
 *     / setTools / refreshTools / loadSlashCommands / sendSteer / sendFollowUp /
 *     cancelQueue);监听 useEventStream 的 pendingQueueUpdate / pendingThinkingLevel /
 *     pendingModelUpdate 自动 reconcile 到本地业务 ref。
 *
 * 这里为了符合"消息按 messageId 索引"的契约,我们用一个 Map<id, message> 维护,
 * 暴露的 messages 仍是数组(由 Map 派生),保证 :key 列表渲染稳定。
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { ElNotification } from 'element-plus'
import { useEventStream } from './useEventStream'
import {
  cancelQueue as rpcCancelQueue,
  fetchSessionMessages,
  getSlashCommands as rpcGetSlashCommands,
  getTools as rpcGetTools,
  sendAgentCommand,
  setModel as rpcSetModel,
  setThinkingLevel as rpcSetThinkingLevel,
  setTools as rpcSetTools
} from '@/api/agent'
import type {
  AgentMessage,
  QueueItem,
  SlashCommandInfo,
  StreamStatus,
  ThinkingLevel,
  ToolEntry,
  ToolPreset
} from '../types'

export interface UseAgentSessionReturn {
  // —— 基础 SSE 流状态(既有)——
  messages: ComputedRef<readonly AgentMessage[]>
  isStreaming: ComputedRef<boolean>
  streamStatus: Ref<StreamStatus>
  error: Ref<string | null>
  sendMessage: (text: string, attachments?: File[]) => Promise<void>
  abort: () => void
  clearError: () => void
  /** 切换 session 时由调用方主动调 — 清空本地消息缓存 */
  resetSession: () => void
  /** Bug 2:拉历史消息回填(切 tab 时自动调用,也可手动触发刷新) */
  fetchHistory: (limit?: number) => Promise<void>

  // ↓ chrome v1:模型 + thinking + tool preset + slash 命令 + streaming 队列 + 操作方法

  /** 模型名查找表:{ 'provider/modelId' -> displayName };由 modelList 派生 */
  modelNames: Ref<Record<string, string>>
  /** 全部模型列表(provider + modelId + name);一次性拉取缓存 */
  modelList: Ref<Array<{ provider: string; modelId: string; name: string }>>
  /** 当前 thinking level(由 SSE thinking_level_changed 事件 reconcile,或 setThinkingLevel 乐观) */
  thinkingLevel: Ref<ThinkingLevel>
  /** 当前模型限定可用的 thinking level 集合(按 provider/modelId 索引);阶段 1 简化为空表 */
  availableThinkingLevels: Ref<Record<string, string[]>>
  /** 当前 model 的 provider/modelId(由 SSE model_changed 或 setModel 乐观) */
  currentModel: Ref<{ provider: string; modelId: string } | null>
  /** 当前 tool preset(由 setTools 推断或 UI 直接设置) */
  toolPreset: Ref<ToolPreset>
  /** 全部 tool 列表(从 get_tools 拉) */
  tools: Ref<ToolEntry[]>
  /** Streaming-time queue:后端 { steering, followUp } 字符串数组 → 本地 { steer, followUp } QueueItem[] */
  queuedMessages: Ref<{ steer: QueueItem[]; followUp: QueueItem[] }>
  /** Slash 命令(get_commands 拉) */
  slashCommands: Ref<SlashCommandInfo[]>

  /** 拉一次 slash 命令(get_commands) */
  loadSlashCommands: () => Promise<void>
  /** 拉一次 tool 列表(get_tools) */
  refreshTools: () => Promise<void>
  /** 切换模型(乐观更新 currentModel + SSE 失败回滚) */
  setModel: (provider: string, modelId: string) => Promise<void>
  /** 切换 thinking level(乐观 + 回滚) */
  setThinkingLevel: (level: ThinkingLevel) => Promise<void>
  /** 设置激活 tool 列表(set_tools);成功后 refreshTools 同步 */
  setTools: (toolNames: string[]) => Promise<void>
  /** 排队一条 steer 消息(steer command) */
  sendSteer: (text: string, attachments?: File[]) => Promise<void>
  /** 排队一条 followUp 消息(follow_up command) */
  sendFollowUp: (text: string, attachments?: File[]) => Promise<void>
  /** 取消队列中某项(OQ-2:SDK 无 cancel_queue,这里降级为本地移除 + warning) */
  cancelQueue: (id: string) => Promise<void>
}

/**
 * @param sessionId 当前 session id(可以是 Ref<string> 或固定字符串)
 * @param userId sendMessage 时的 body 字段
 * @param messageIdResolver 可选:从 SDK 事件里提取 messageId。某些后端
 *   会在 message_start / message_delta 上附一个稳定的 messageId 字段,
 *   没附时退化为"每条 delta 都合并到最后一条 assistant 消息上"。
 */
export function useAgentSession(
  sessionId: Ref<string> | string,
  userId: string,
  messageIdResolver?: (raw: Record<string, unknown>) => string | null
): UseAgentSessionReturn {
  // 由 useEventStream 维护的"原始"消息流(已经按事件顺序累积)
  const {
    messages: rawMessages,
    isStreaming,
    streamStatus,
    error,
    sendMessage: rawSend,
    abort: rawAbort,
    clearError,
    resetMessages: rawReset,
    prependMessages: rawPrepend,
    // chrome v1:3 个 pending ref
    pendingQueueUpdate,
    pendingThinkingLevel,
    pendingModelUpdate
  } = useEventStream(sessionId, userId)

  // —— 合并层:把同 messageId 的相邻 delta 合并成单条消息 ——
  // 实现思路:维护一个 Map<stableId, AgentMessage>,每次 rawMessages 变化时
  // 重新合并导出 messages。
  //
  // 但当前 useEventStream 已经把同一 assistant 流合并到最后一条上了,
  // 这里主要职责是把"按事件序累积的简单列表"再做一次按 messageId 的稳定
  // 派生(messageIdResolver 没给时 → 与 rawMessages 等价)。
  const messageById = ref<Map<string, AgentMessage>>(new Map())

  function rebuildIndex(): void {
    const next = new Map<string, AgentMessage>()
    for (const msg of rawMessages.value) {
      // 优先使用 messageIdResolver(若 raw 上有 messageId 字段)
      const stableId =
        (messageIdResolver ? messageIdResolver(msg as unknown as Record<string, unknown>) : null) ??
        msg.id
      // 同 id 后续覆盖前序(append content)
      const existing = next.get(stableId)
      if (existing) {
        next.set(stableId, { ...existing, content: existing.content + msg.content })
      } else {
        next.set(stableId, msg)
      }
    }
    messageById.value = next
  }

  // 监听 raw 变化时重算
  watch(rawMessages, rebuildIndex, { immediate: true, deep: true })

  const messages = computed<readonly AgentMessage[]>(() => {
    // 用 rawMessages 的顺序(append 顺序)而不是 Map 迭代序,保证 UI 渲染稳定
    const seen = new Set<string>()
    const out: AgentMessage[] = []
    for (const msg of rawMessages.value) {
      const stableId =
        (messageIdResolver ? messageIdResolver(msg as unknown as Record<string, unknown>) : null) ??
        msg.id
      if (seen.has(stableId)) continue
      seen.add(stableId)
      out.push(messageById.value.get(stableId) ?? msg)
    }
    return out
  })

  async function sendMessage(text: string, attachments?: File[]): Promise<void> {
    await rawSend(text, attachments)
  }

  function abort(): void {
    rawAbort()
  }

  function resetSession(): void {
    rawReset()
    messageById.value = new Map()
    // chrome v1:design §1.3 要求 session 切换时清空所有 ref,避免跨会话串味。
    // 实际生产路径通常靠 `<ChatWindow :key="currentSessionId">` 重建组件来掩盖,
    // 但任何直接 resetSession() 调用方仍可能 leak 旧 session 的 model/queue/commands。
    currentModel.value = null
    thinkingLevel.value = 'auto'
    toolPreset.value = 'none'
    tools.value = []
    queuedMessages.value = { steer: [], followUp: [] }
    slashCommands.value = []
    modelNames.value = {}
    modelList.value = []
    availableThinkingLevels.value = {}
  }

  /**
   * Bug 2 修复:拉历史消息回填。切 tab 时由 watch(sessionId) 自动触发,
   * 也可手动调用(如"加载更多")。
   *
   * 防 race:用 fetchHistorySeq 记录最新请求序号,只有"最后一次"请求的响应
   * 才写回 messageById,否则快速切两次时,旧响应的 messages 会污染新会话。
   *
   * merge 策略:按 messageId 去重,如果 SSE 实时流已在 messageById 中推过同 id
   * 消息,优先保留 SSE 的(因为它含最新 streaming 状态)。
   */
  let fetchHistorySeq = 0
  async function fetchHistory(limit = 100): Promise<void> {
    const sid = typeof sessionId === 'string' ? sessionId : sessionId.value
    if (!sid) return
    const seq = ++fetchHistorySeq
    try {
      const resp = await fetchSessionMessages(sid, { limit })
      const data = (resp as { data?: { messages?: AgentMessage[] } }).data
      const history = data?.messages ?? []
      // race 检查:若期间 sessionId 已切换,放弃本次结果
      if (seq !== fetchHistorySeq) return
      rawPrepend(history)
    } catch {
      // 静默失败:历史拉不到不影响 SSE 实时流,UI 只是没历史不会崩
      if (seq !== fetchHistorySeq) return
    }
  }

  // ==========================================================================
  // chrome v1:模型 / thinking / tool preset / slash / streaming 队列 业务状态
  // ==========================================================================

  /** 模型查找表:{ 'provider/modelId' -> displayName };阶段 1 不主动拉,由 modelList 派生 */
  const modelNames = ref<Record<string, string>>({})
  /** 当前 model(provider + modelId);null 表示还没拿到 */
  const currentModel = ref<{ provider: string; modelId: string } | null>(null)
  /**
   * 当前 thinking level。'auto' 作为初始无值状态(由后端 SSE thinking_level_changed
   * 推真实值,或 setThinkingLevel 乐观设置)。
   */
  const thinkingLevel = ref<ThinkingLevel>('auto')
  /** 当前模型限定可用的 thinking level 子集。阶段 1 简化为空 Map(不限制) */
  const availableThinkingLevels = ref<Record<string, string[]>>({})
  /** Tool preset:setTools 时推断(对比 preset 常量数组) */
  const toolPreset = ref<ToolPreset>('none')
  /** Tool 全表(get_tools 拉) */
  const tools = ref<ToolEntry[]>([])
  /** Streaming 队列:SSE queue_update 事件推送覆盖 */
  const queuedMessages = ref<{ steer: QueueItem[]; followUp: QueueItem[] }>({
    steer: [],
    followUp: []
  })
  /** Slash 命令(get_commands 拉) */
  const slashCommands = ref<SlashCommandInfo[]>([])
  /**
   * 模型全表。阶段 1 暂不主动拉 getModelConfig,留给 T3 状态条;
   * modelList 留作 forward-compatible 的空数组,前端状态条未接时不出错。
   */
  const modelList = ref<Array<{ provider: string; modelId: string; name: string }>>([])

  // —— SSE reconcile:把 useEventStream 的 pending* 拷到本地业务 ref ——

  watch(pendingQueueUpdate, (q) => {
    if (q) queuedMessages.value = q
  })
  watch(pendingThinkingLevel, (level) => {
    if (typeof level === 'string') {
      // SSE 推的字符串是 ThinkingLevel union;保险起见 narrow 一遍
      const allowed: ThinkingLevel[] = [
        'auto',
        'off',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max'
      ]
      if ((allowed as string[]).includes(level)) {
        thinkingLevel.value = level as ThinkingLevel
      } else {
        console.warn('[useAgentSession] thinking_level_changed 未知 level:', level)
      }
    }
  })
  watch(pendingModelUpdate, (m) => {
    if (m) currentModel.value = m
  })

  // —— chrome v1:7 个方法包装 ——

  async function loadSlashCommands(): Promise<void> {
    const sid = typeof sessionId === 'string' ? sessionId : sessionId.value
    if (!sid) return
    try {
      const resp = await rpcGetSlashCommands(sid)
      // 响应可能是 BaseResponse 套一层,也可能直出(看 httpClient 包装)
      const data = (resp as { data?: { commands?: SlashCommandInfo[] } }).data ?? resp
      const cmds = (data as { commands?: SlashCommandInfo[] }).commands ?? []
      slashCommands.value = cmds
    } catch {
      // 静默:slash 命令拉不到时 UI 显示空白面板即可,不打扰用户
    }
  }

  async function refreshTools(): Promise<void> {
    const sid = typeof sessionId === 'string' ? sessionId : sessionId.value
    if (!sid) return
    try {
      const resp = await rpcGetTools(sid)
      const data = (resp as { data?: unknown }).data ?? resp
      // data 可能是数组(裸)、{ data: ToolEntry[] }(套一层)、或 { tools: ToolEntry[] }
      // 都尝试展开;走 unknown → narrow,避免把 BaseResponse 强转成 tools 字段。
      const list: ToolEntry[] = Array.isArray(data)
        ? (data as ToolEntry[])
        : Array.isArray((data as { tools?: ToolEntry[] }).tools)
          ? ((data as { tools: ToolEntry[] }).tools as ToolEntry[])
          : Array.isArray((data as { data?: ToolEntry[] }).data)
            ? ((data as { data: ToolEntry[] }).data as ToolEntry[])
            : []
      tools.value = list
    } catch {
      // 静默
    }
  }

  async function setModel(provider: string, modelId: string): Promise<void> {
    const sid = typeof sessionId === 'string' ? sessionId : sessionId.value
    if (!sid) return
    const prev = currentModel.value
    // 乐观更新
    currentModel.value = { provider, modelId }
    try {
      await sendAgentCommand(sid, { type: 'set_model', provider, modelId })
    } catch (e) {
      // 回滚 + warning
      currentModel.value = prev
      ElNotification({
        title: '切换模型失败',
        message: e instanceof Error ? e.message : '未知错误',
        type: 'warning'
      })
    }
  }

  async function setThinkingLevel(level: ThinkingLevel): Promise<void> {
    const sid = typeof sessionId === 'string' ? sessionId : sessionId.value
    if (!sid) return
    const prev = thinkingLevel.value
    thinkingLevel.value = level
    try {
      await rpcSetThinkingLevel(sid, level)
    } catch (e) {
      thinkingLevel.value = prev
      ElNotification({
        title: '切换思考档位失败',
        message: e instanceof Error ? e.message : '未知错误',
        type: 'warning'
      })
    }
  }

  async function setTools(toolNames: string[]): Promise<void> {
    const sid = typeof sessionId === 'string' ? sessionId : sessionId.value
    if (!sid) return
    try {
      await rpcSetTools(sid, toolNames)
      // 成功后同步 tool 列表
      await refreshTools()
    } catch (e) {
      ElNotification({
        title: '设置工具失败',
        message: e instanceof Error ? e.message : '未知错误',
        type: 'warning'
      })
    }
  }

  async function sendSteer(text: string, attachments?: File[]): Promise<void> {
    const sid = typeof sessionId === 'string' ? sessionId : sessionId.value
    if (!sid) return
    if (!text.trim()) return
    // 乐观 push 一条 QueueItem(SSE queue_update 会被 useEventStream 覆盖)
    const now = new Date().toISOString()
    const optimisticId = `q-steer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    queuedMessages.value = {
      ...queuedMessages.value,
      steer: [
        ...queuedMessages.value.steer,
        { id: optimisticId, kind: 'steer', text, createdAt: now }
      ]
    }
    try {
      await sendAgentCommand(sid, {
        type: 'steer',
        message: text,
        images: attachments && attachments.length > 0 ? attachments : undefined
      })
    } catch (e) {
      // 回滚乐观项 + warning(后端 queue_update 会再次覆盖,这里只清自己那一条)
      queuedMessages.value = {
        ...queuedMessages.value,
        steer: queuedMessages.value.steer.filter((q) => q.id !== optimisticId)
      }
      ElNotification({
        title: '排队失败',
        message: e instanceof Error ? e.message : '未知错误',
        type: 'warning'
      })
    }
  }

  async function sendFollowUp(text: string, attachments?: File[]): Promise<void> {
    const sid = typeof sessionId === 'string' ? sessionId : sessionId.value
    if (!sid) return
    if (!text.trim()) return
    const now = new Date().toISOString()
    const optimisticId = `q-follow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    queuedMessages.value = {
      ...queuedMessages.value,
      followUp: [
        ...queuedMessages.value.followUp,
        { id: optimisticId, kind: 'followUp', text, createdAt: now }
      ]
    }
    try {
      await sendAgentCommand(sid, {
        type: 'follow_up',
        message: text,
        images: attachments && attachments.length > 0 ? attachments : undefined
      })
    } catch (e) {
      queuedMessages.value = {
        ...queuedMessages.value,
        followUp: queuedMessages.value.followUp.filter((q) => q.id !== optimisticId)
      }
      ElNotification({
        title: '排队失败',
        message: e instanceof Error ? e.message : '未知错误',
        type: 'warning'
      })
    }
  }

  /**
   * 取消排队(OQ-2:SDK 无 cancel_queue 单一命令,只有 clear_queue 清空全部)。
   * 这里降级为本地移除 + warning —— 后端不会同步,刷新会被 queue_update 覆盖回来。
   */
  async function cancelQueue(id: string): Promise<void> {
    const prev = queuedMessages.value
    queuedMessages.value = {
      steer: prev.steer.filter((q) => q.id !== id),
      followUp: prev.followUp.filter((q) => q.id !== id)
    }
    // 仍尝试调用后端 rpcCancelQueue(若后端 type 不存在,会 fail;catch 兜底)
    const sid = typeof sessionId === 'string' ? sessionId : sessionId.value
    if (sid) {
      try {
        await rpcCancelQueue(sid, id)
      } catch {
        // 静默 — OQ-2 已知 type 可能不存在;本地已移除,UI 已经看到效果
      }
    }
    ElNotification({
      title: '队列项已在本地移除',
      // 给个轻量提示让用户知道这是降级行为
      message:
        '当前后端未提供 cancel_queue 单项指令,仅在本地视图中隐藏(下次刷新可能被后端 queue_update 覆盖)',
      type: 'warning',
      duration: 4000
    })
  }

  // sessionId 变化时:resetSession → fetchHistory(自动回填)
  //
  // immediate: true 很关键:组件因 :key=sessionId 重建时,新 useAgentSession 实例
  // 的 sessionId 是新值,但 watch 默认 lazy 不会 fire,首次切 tab 拉不到历史。
  // 走 immediate 让挂载即触发,等同 useEventStream 的 connect() fallback 模式。
  watch(
    () => (typeof sessionId === 'string' ? sessionId : sessionId.value),
    (newSid, oldSid) => {
      if (!newSid) return
      if (newSid === oldSid) return
      resetSession()
      void fetchHistory()
    },
    { immediate: true }
  )

  return {
    messages,
    isStreaming,
    streamStatus,
    error,
    sendMessage,
    abort,
    clearError,
    resetSession,
    fetchHistory,
    // chrome v1
    modelNames,
    modelList,
    thinkingLevel,
    availableThinkingLevels,
    currentModel,
    toolPreset,
    tools,
    queuedMessages,
    slashCommands,
    loadSlashCommands,
    refreshTools,
    setModel,
    setThinkingLevel,
    setTools,
    sendSteer,
    sendFollowUp,
    cancelQueue
  }
}
