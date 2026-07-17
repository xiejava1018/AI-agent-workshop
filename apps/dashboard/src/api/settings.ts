import request from '@/utils/http'

const httpClient = request as import('@/utils/http').HttpClient

/**
 * 获取当前用户信息
 * GET /api/auth/me
 */
export function getProfile() {
  return httpClient.get<{ username: string; email: string }>({
    url: '/api/auth/me',
  })
}

/**
 * 更新当前用户信息
 * PATCH /api/auth/me
 */
export function updateProfile(data: { email?: string }) {
  return httpClient.request<any>({ url: '/api/auth/me', data, method: 'PATCH' })
}

/**
 * 获取当前用户的 API Key 列表
 * GET /api/user/api-keys
 */
export function getApiKeys() {
  return httpClient.get<Array<{ id: string; provider: string; secretEnc?: string }>>({
    url: '/api/user/api-keys',
  })
}

/**
 * 设置用户的 API Key
 * POST /api/user/api-keys
 */
export function setApiKey(data: { provider: string; secret: string }) {
  return httpClient.post({ url: '/api/user/api-keys', data })
}

/**
 * 获取用户设置
 * GET /api/user/settings
 */
export function getSettings() {
  return httpClient.get<{ defaultModel?: string; fallbackEnabled?: boolean }>({
    url: '/api/user/settings',
  })
}

/**
 * 更新用户设置
 * PATCH /api/user/settings
 */
export function updateSettings(data: { defaultModel?: string; fallbackEnabled?: boolean }) {
  return httpClient.request<any>({ url: '/api/user/settings', data, method: 'PATCH' })
}

/**
 * 获取用户配额
 * GET /api/user/quota
 */
export function getQuota() {
  return httpClient.get<{
    tokenUsed: number
    tokenLimit: number
    concurrentSessions: number
    maxConcurrentSessions: number
  }>({ url: '/api/user/quota' })
}
