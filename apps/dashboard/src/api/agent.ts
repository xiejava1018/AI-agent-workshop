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

/** 创建会话 */
export const createSession = (userId: string) => {
  return httpClient.post<Http.BaseResponse<AgentSession>>({
    url: `${PREFIX}/sessions`,
    data: { userId },
    keepFullResponse: true
  })
}

/** 发送消息 */
export const sendMessage = (sessionId: string, content: string, userId: string) => {
  return httpClient.post<Http.BaseResponse<{ ok: boolean }>>({
    url: `${PREFIX}/sessions/${sessionId}/messages`,
    data: { content, userId },
    keepFullResponse: true
  })
}

/** 获取可用的 Digital Employees */
export const listAvailableAgents = () => {
  return httpClient.get<Http.BaseResponse<Array<{ id: string; name: string; description?: string }>>>({
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
