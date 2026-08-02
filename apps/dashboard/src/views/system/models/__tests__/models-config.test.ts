/**
 * models-config.test.ts
 *
 * 覆盖 src/api/models-config.ts 的所有 HTTP wrapper。 用 vi.mock http。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/utils/http', () => {
  const mockGet = vi.fn()
  const mockPost = vi.fn()
  const mockPut = vi.fn()
  const mockDel = vi.fn()

  // 模拟 request.* 函数在 keepFullResponse:true 时直接返回 raw body (T)
  mockGet.mockResolvedValue({})
  mockPost.mockResolvedValue({ ok: true })
  mockPut.mockResolvedValue({ success: true })
  mockDel.mockResolvedValue({})

  return {
    default: {
      get: mockGet,
      post: mockPost,
      put: mockPut,
      del: mockDel
    }
  }
})

// import 必须在 vi.mock 之后
import request from '@/utils/http'
import {
  fetchModelsConfig,
  saveModelsConfig,
  testModel,
  listOAuthProviders,
  listApiKeyProviders,
  saveApiKey,
  deleteApiKey,
  logoutOAuth,
  submitOAuthCode
} from '@/api/models-config'

function getMock() {
  return request.get as unknown as ReturnType<typeof vi.fn>
}
function postMock() {
  return request.post as unknown as ReturnType<typeof vi.fn>
}
function putMock() {
  return request.put as unknown as ReturnType<typeof vi.fn>
}
function delMock() {
  return request.del as unknown as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  getMock().mockResolvedValue({})
  postMock().mockResolvedValue({ ok: true })
  putMock().mockResolvedValue({ success: true })
  delMock().mockResolvedValue({})
})

describe('models-config wrappers', () => {
  it('fetchModelsConfig calls GET /api/models-config with keepFullResponse and unwraps .data', async () => {
    getMock().mockResolvedValueOnce({
      providers: { foo: { models: [] } }
    })
    const result = await fetchModelsConfig()
    expect(getMock()).toHaveBeenCalledWith({
      url: '/api/models-config',
      keepFullResponse: true
    })
    expect(result.providers?.foo).toBeDefined()
  })

  it('fetchModelsConfig returns safe { providers: {} } when body is null', async () => {
    getMock().mockResolvedValueOnce(null as any)
    const result = await fetchModelsConfig()
    expect(result).toEqual({ providers: {} })
  })

  it('saveModelsConfig PUTs the full config', async () => {
    const cfg = { providers: { foo: { api: 'openai-completions' } } } as any
    await saveModelsConfig(cfg)
    expect(putMock()).toHaveBeenCalledWith({
      url: '/api/models-config',
      data: cfg
    })
  })

  it('testModel POSTs and returns the parsed result', async () => {
    postMock().mockResolvedValueOnce({
      ok: true,
      latencyMs: 42,
      status: 200,
      responseText: 'hello'
    })
    const r = await testModel({
      providerName: 'p',
      provider: {} as any,
      model: { id: 'm' }
    })
    expect(postMock()).toHaveBeenCalledWith({
      url: '/api/models-config/test',
      data: expect.objectContaining({ providerName: 'p' })
    })
    expect(r.latencyMs).toBe(42)
  })

  it('listOAuthProviders reads .providers on the returned body', async () => {
    getMock().mockResolvedValueOnce({
      providers: [{ id: 'a', name: 'A' }]
    })
    const list = await listOAuthProviders()
    expect(getMock()).toHaveBeenCalledWith({
      url: '/api/auth/providers',
      keepFullResponse: true
    })
    expect(list).toHaveLength(1)
  })

  it('listApiKeyProviders reads .providers and tolerates missing field', async () => {
    getMock().mockResolvedValueOnce({})
    const list = await listApiKeyProviders()
    expect(list).toEqual([])
  })

  it('saveApiKey POSTs the apiKey body', async () => {
    await saveApiKey('anthropic', 'sk-test')
    expect(postMock()).toHaveBeenCalledWith({
      url: '/api/auth/api-key/anthropic',
      data: { apiKey: 'sk-test' }
    })
  })

  it('deleteApiKey issues DELETE', async () => {
    await deleteApiKey('openai')
    expect(delMock()).toHaveBeenCalledWith({
      url: '/api/auth/api-key/openai'
    })
  })

  it('logoutOAuth POSTs', async () => {
    await logoutOAuth('github-copilot')
    expect(postMock()).toHaveBeenCalledWith({
      url: '/api/auth/logout/github-copilot'
    })
  })

  it('submitOAuthCode POSTs body with token and code', async () => {
    postMock().mockResolvedValueOnce({ ok: true })
    const r = await submitOAuthCode('github-copilot', 'tok-1', 'abc')
    expect(postMock()).toHaveBeenCalledWith({
      url: '/api/auth/login/github-copilot',
      data: { token: 'tok-1', code: 'abc' }
    })
    expect(r.ok).toBe(true)
  })

  it('submitOAuthCode maps server error to result.error', async () => {
    postMock().mockResolvedValueOnce({ ok: false, error: 'expired' })
    const r = await submitOAuthCode('github-copilot', 'tok-1', 'abc')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('expired')
  })
})
