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
