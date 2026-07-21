import request from '@/utils/http'

/**
 * 模型配置 API
 *
 * 对应 app/web 的模型配置能力，复用同一后端（Next.js /api/models-config 等）。
 */

export interface ModelEntry {
  id: string
  name?: string
  api?: string
  reasoning?: boolean
  thinkingLevelMap?: Record<string, string | null>
  input?: string[]
  contextWindow?: number
  maxTokens?: number
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
  compat?: Record<string, unknown>
}

export interface ProviderEntry {
  baseUrl?: string
  api?: string
  apiKey?: string
  headers?: Record<string, string>
  compat?: Record<string, unknown>
  models?: ModelEntry[]
  modelOverrides?: Record<string, unknown>
}

export interface ModelsConfig {
  providers?: Record<string, ProviderEntry>
  defaultModel?: unknown
  fallbackOrder?: unknown
  [key: string]: unknown
}

export interface OAuthProvider {
  id: string
  name: string
  usesCallbackServer: boolean
  loggedIn: boolean
}

export interface ApiKeyProvider {
  id: string
  displayName: string
  configured: boolean
  source?: string
  modelCount: number
}

export interface ModelTestResult {
  ok?: boolean
  error?: string
  latencyMs?: number
  status?: number
  responseText?: string
}

/** 模型/供应商的 API 协议可选项（与 app/web 保持一致） */
export const API_OPTIONS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai'
] as const

/** 思考等级 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** DeepSeek thinking 兼容配置 */
export const DEEPSEEK_COMPAT = {
  thinkingFormat: 'deepseek',
  requiresReasoningContentOnAssistantMessages: true
} as const

/** 判断模型是否启用了 DeepSeek 兼容 */
export function hasDeepseekCompat(model: ModelEntry): boolean {
  return (model.compat as { thinkingFormat?: string } | undefined)?.thinkingFormat === 'deepseek'
}

/** 设置/取消模型的 DeepSeek 兼容 */
export function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } }
  }
  if (!model.compat) return model
  const rest = { ...model.compat }
  delete (rest as { thinkingFormat?: unknown }).thinkingFormat
  delete (rest as { requiresReasoningContentOnAssistantMessages?: unknown })
    .requiresReasoningContentOnAssistantMessages
  return { ...model, compat: Object.keys(rest).length ? rest : undefined }
}

/** 读取模型配置 */
export function getModelsConfig() {
  return request.get<ModelsConfig>({ url: '/api/models-config' })
}

/** 保存模型配置 */
export function saveModelsConfig(data: ModelsConfig) {
  return request.put<{ success?: boolean; error?: string }>({ url: '/api/models-config', data })
}

/**
 * 测试单个模型连接。后端超时 20s，此处放宽到 25s，避免前端默认 15s 超时先于后端返回。
 */
export function testModel(payload: {
  providerName: string
  provider: ProviderEntry
  model: ModelEntry
}) {
  return request.post<ModelTestResult>({
    url: '/api/models-config/test',
    data: payload,
    timeout: 25000
  })
}

/** OAuth 订阅类供应商列表 */
export function getOAuthProviders() {
  return request.get<{ providers: OAuthProvider[] }>({ url: '/api/auth/providers' })
}

/** API Key 类供应商列表 */
export function getApiKeyProviders() {
  return request.get<{ providers: ApiKeyProvider[] }>({ url: '/api/auth/all-providers' })
}

/** 设置某供应商的 API Key */
export function setApiKey(provider: string, apiKey: string) {
  return request.post<{ success?: boolean; error?: string }>({
    url: `/api/auth/api-key/${encodeURIComponent(provider)}`,
    data: { apiKey }
  })
}

/** 删除某供应商的 API Key */
export function deleteApiKey(provider: string) {
  return request.del<{ success?: boolean; error?: string }>({
    url: `/api/auth/api-key/${encodeURIComponent(provider)}`
  })
}

/** 解除 OAuth 绑定 */
export function logoutOAuth(provider: string) {
  return request.post<{ success?: boolean; error?: string }>({
    url: `/api/auth/logout/${encodeURIComponent(provider)}`
  })
}

/**
 * 提交 OAuth 手动输入（重定向 URL / 授权码 / 选择项）。
 * 走原生 fetch：这是 SSE 流程的伴随调用，成功后由 SSE 推送 success 事件。
 */
export function submitOAuthCode(provider: string, token: string, code: string) {
  return fetch(`/api/auth/login/${encodeURIComponent(provider)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ token, code: code.trim() })
  })
}

/** OAuth 登录 SSE 端点地址（供 EventSource 订阅） */
export function oauthLoginStreamUrl(provider: string) {
  return `/api/auth/login/${encodeURIComponent(provider)}`
}
