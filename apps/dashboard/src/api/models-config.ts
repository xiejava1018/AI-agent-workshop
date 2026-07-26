/**
 * api/models-config.ts
 *
 * 类型化 HTTP 包装,给 system/models 页面用。 后端路由全是裸 JSON(no envelope):
 *   GET /api/models-config                       → ModelsConfig
 *   PUT /api/models-config  body=ModelsConfig    → { success } | { error }
 *   POST /api/models-config/test body=TestReq    → TestResult
 *   GET /api/auth/providers                      → { providers: OAuthProvider[] }
 *   GET /api/auth/all-providers                  → { providers: ApiKeyProvider[] }
 *   POST/DELETE /api/auth/api-key/[id]           → 200 | { error }
 *   POST /api/auth/logout/[id]                   → 200 | { error }
 *   POST /api/auth/login/[id]  body={ token, code } → { ok, error? }
 *
 * 参考实现: apps/dashboard/src/api/agent.ts:450 (getModelConfig) 的 keepFullResponse 模式
 *           apps/web/components/ModelsConfig.tsx 端点的对应 React 客户端
 */
import request from '@/utils/http'

// 后端路由全是裸 JSON(no envelope)。 Http.BaseResponse<T> 是
// 全局可见的 augment 命名空间(见 apps/dashboard/src/types/api/api.d.ts),
// 这里直接复用。

// ----------------------------------------------------------------------------
// Shapes
// ----------------------------------------------------------------------------

export interface ModelEntryShape {
  id: string
  name?: string
  api?: string
  reasoning?: boolean
  thinkingLevelMap?: Record<string, string | null>
  input?: string[]
  contextWindow?: number
  maxTokens?: number
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
  }
  compat?: Record<string, unknown>
}

export interface ProviderEntryShape {
  baseUrl?: string
  api?: string
  apiKey?: string
  headers?: Record<string, string>
  compat?: Record<string, unknown>
  models?: ModelEntryShape[]
  modelOverrides?: Record<string, unknown>
}

export interface ModelsConfigShape {
  providers?: Record<string, ProviderEntryShape>
  defaultModel?: unknown
  fallbackOrder?: unknown
}

export interface ModelTestResult {
  ok: boolean
  error?: string
  latencyMs?: number
  status?: number
  responseText?: string
}

export interface OAuthProviderShape {
  id: string
  name: string
  usesCallbackServer: boolean
  loggedIn: boolean
}

export interface ApiKeyProviderShape {
  id: string
  displayName: string
  configured: boolean
  source?: string
  modelCount: number
}

// 后端 (apps/web/app/api/models-config/route.ts, lib/models-config.ts) 接受的常量
export const API_OPTIONS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai'
] as const
export type ApiOption = (typeof API_OPTIONS)[number]

// 兼容老用法: 从 agent.ts 重新导出 ModelConfigEntry (type-only)
// 让 dashboard 老 consumers 仍能 type-import 此类型,避免重复定义漂移
export type { ModelConfigEntry } from '@/api/agent'

// ----------------------------------------------------------------------------
// Models config
// ----------------------------------------------------------------------------

/**
 * GET /api/models-config — 后端裸 JSON(没有 envelope)。
 * 用 keepFullResponse:true,此时 `request.get<T>` 直接返回 raw body (T 本身就是 ModelsConfig)。
 * 注意: 项目其它 module (例如 api/agent.ts) 有 'res.data' 的写法,那是因为他们假设后端
 * 会包 `Http.BaseResponse` 信封; 此处后端实际返回裸 JSON,所以直接拿 T 即可。
 */
export const fetchModelsConfig = async (): Promise<ModelsConfigShape> => {
  const cfg = await request.get<ModelsConfigShape>({
    url: '/api/models-config',
    keepFullResponse: true
  })
  return cfg ?? { providers: {} }
}

/**
 * PUT /api/models-config — 写完整树。 后端在 success 时返回 { success: true } 或
 * error 时返回 { error: string } + 500。 抛非 2xx 错误由 request 自动抛出。
 */
export const saveModelsConfig = async (cfg: ModelsConfigShape): Promise<void> => {
  await request.put({
    url: '/api/models-config',
    data: cfg
  })
}

/**
 * POST /api/models-config/test — 给单个模型做连通性测试。
 */
export const testModel = async (payload: {
  providerName: string
  provider: ProviderEntryShape
  model: ModelEntryShape
}): Promise<ModelTestResult> => {
  const res = await request.post<ModelTestResult>({
    url: '/api/models-config/test',
    data: payload
  })
  return res
}

// ----------------------------------------------------------------------------
// OAuth / API-Key managed providers
// ----------------------------------------------------------------------------

export const listOAuthProviders = async (): Promise<OAuthProviderShape[]> => {
  const body = await request.get<{ providers?: OAuthProviderShape[] }>({
    url: '/api/auth/providers',
    keepFullResponse: true
  })
  return body.providers ?? []
}

export const listApiKeyProviders = async (): Promise<ApiKeyProviderShape[]> => {
  const body = await request.get<{ providers?: ApiKeyProviderShape[] }>({
    url: '/api/auth/all-providers',
    keepFullResponse: true
  })
  return body.providers ?? []
}

export const saveApiKey = async (providerId: string, apiKey: string): Promise<void> => {
  await request.post({
    url: `/api/auth/api-key/${encodeURIComponent(providerId)}`,
    data: { apiKey }
  })
}

export const deleteApiKey = async (providerId: string): Promise<void> => {
  await request.del({
    url: `/api/auth/api-key/${encodeURIComponent(providerId)}`
  })
}

export const logoutOAuth = async (providerId: string): Promise<void> => {
  await request.post({
    url: `/api/auth/logout/${encodeURIComponent(providerId)}`
  })
}

/**
 * OAuth 流程的 code 提交: prompt_request 输入值 / select_request 选项 id 都走这里,
 * 后端把 token 和( code | selection )字段配对确认 pending promise。 React ModelsConfig.tsx
 * 的 select_request 也复用这个端点(把 option.id 当作 code 提交),本实现保持一致。
 */
export const submitOAuthCode = async (
  providerId: string,
  token: string,
  code: string
): Promise<{ ok: boolean; error?: string }> => {
  const res = await request.post<{ ok?: boolean; error?: string }>({
    url: `/api/auth/login/${encodeURIComponent(providerId)}`,
    data: { token, code }
  })
  return { ok: !!res.ok, error: res.error }
}
