/**
 * models-config API 客户端单测。
 *
 * 锁死与 app/web 后端的关键契约:
 *   - getModelsConfig   -> GET /api/models-config
 *   - saveModelsConfig  -> PUT /api/models-config
 *   - testModel         -> POST /api/models-config/test (timeout 25000ms)
 *   - getOAuthProviders -> GET /api/auth/providers
 *   - getApiKeyProviders -> GET /api/auth/all-providers
 *   - setApiKey         -> POST /api/auth/api-key/:provider
 *   - deleteApiKey      -> DELETE /api/auth/api-key/:provider
 *   - logoutOAuth       -> POST /api/auth/logout/:provider
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/utils/http', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    request: vi.fn()
  }
}))

import request from '@/utils/http'
import {
  getModelsConfig,
  saveModelsConfig,
  testModel,
  getOAuthProviders,
  getApiKeyProviders,
  setApiKey,
  deleteApiKey,
  logoutOAuth,
  hasDeepseekCompat,
  setDeepseekCompat,
  type ModelsConfig,
  type ModelEntry
} from './models-config'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('models-config API client', () => {
  it('getModelsConfig hits GET /api/models-config', async () => {
    vi.mocked(request.get).mockResolvedValueOnce({ providers: {} })
    await getModelsConfig()
    expect(request.get).toHaveBeenCalledWith({ url: '/api/models-config' })
  })

  it('saveModelsConfig PUTs to /api/models-config with payload', async () => {
    vi.mocked(request.put).mockResolvedValueOnce({ success: true })
    const payload: ModelsConfig = {
      providers: { openai: { api: 'openai-completions', models: [{ id: 'gpt-4o-mini' }] } }
    }
    await saveModelsConfig(payload)
    expect(request.put).toHaveBeenCalledWith({ url: '/api/models-config', data: payload })
  })

  it('testModel POSTs to /api/models-config/test with extended timeout', async () => {
    vi.mocked(request.post).mockResolvedValueOnce({ ok: true })
    const provider = { api: 'openai-completions' }
    const model: ModelEntry = { id: 'gpt-4o-mini' }
    await testModel({ providerName: 'openai', provider, model })
    expect(request.post).toHaveBeenCalledWith({
      url: '/api/models-config/test',
      data: { providerName: 'openai', provider, model },
      timeout: 25000
    })
  })

  it('getOAuthProviders hits /api/auth/providers', async () => {
    vi.mocked(request.get).mockResolvedValueOnce({ providers: [] })
    await getOAuthProviders()
    expect(request.get).toHaveBeenCalledWith({ url: '/api/auth/providers' })
  })

  it('getApiKeyProviders hits /api/auth/all-providers', async () => {
    vi.mocked(request.get).mockResolvedValueOnce({ providers: [] })
    await getApiKeyProviders()
    expect(request.get).toHaveBeenCalledWith({ url: '/api/auth/all-providers' })
  })

  it('setApiKey URL-encodes the provider id', async () => {
    vi.mocked(request.post).mockResolvedValueOnce({ success: true })
    await setApiKey('open ai', 'sk-test')
    expect(request.post).toHaveBeenCalledWith({
      url: '/api/auth/api-key/open%20ai',
      data: { apiKey: 'sk-test' }
    })
  })

  it('deleteApiKey DELETEs /api/auth/api-key/:provider', async () => {
    vi.mocked(request.del).mockResolvedValueOnce({ success: true })
    await deleteApiKey('openai')
    expect(request.del).toHaveBeenCalledWith({ url: '/api/auth/api-key/openai' })
  })

  it('logoutOAuth POSTs /api/auth/logout/:provider', async () => {
    vi.mocked(request.post).mockResolvedValueOnce({ success: true })
    await logoutOAuth('anthropic')
    expect(request.post).toHaveBeenCalledWith({
      url: '/api/auth/logout/anthropic'
    })
  })
})

describe('hasDeepseekCompat / setDeepseekCompat', () => {
  it('returns false when no compat', () => {
    expect(hasDeepseekCompat({ id: 'm' })).toBe(false)
  })

  it('returns true when thinkingFormat=deepseek', () => {
    expect(hasDeepseekCompat({ id: 'm', compat: { thinkingFormat: 'deepseek' } })).toBe(true)
  })

  it('setDeepseekCompat(true) injects the deepseek compat shape', () => {
    const out = setDeepseekCompat({ id: 'm' }, true)
    expect(out.compat).toMatchObject({
      thinkingFormat: 'deepseek',
      requiresReasoningContentOnAssistantMessages: true
    })
  })

  it('setDeepseekCompat(false) strips compat fields and drops empty compat', () => {
    const out = setDeepseekCompat({ id: 'm', compat: { thinkingFormat: 'deepseek' } }, false)
    expect(out.compat).toBeUndefined()
  })

  it('setDeepseekCompat(false) preserves other compat keys', () => {
    const out = setDeepseekCompat(
      { id: 'm', compat: { thinkingFormat: 'deepseek', customKey: 'keep' } },
      false
    )
    expect(out.compat).toEqual({ customKey: 'keep' })
  })
})
