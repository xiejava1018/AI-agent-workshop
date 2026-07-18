/**
 * useConfigPanel 单元测试
 *
 * 覆盖:
 *   - 三类加载成功 / 失败
 *   - 启用/禁用乐观更新 + 回滚
 *   - saving* 互斥(并发 no-op)
 *   - error + clearError
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/agent', () => ({
  getModelConfig: vi.fn(),
  setModelConfig: vi.fn(),
  getSkills: vi.fn(),
  setSkillEnabled: vi.fn(),
  getPlugins: vi.fn(),
  setPluginEnabled: vi.fn(),
  listSessions: vi.fn(),
  createSession: vi.fn(),
  renameSession: vi.fn(),
  togglePinSession: vi.fn(),
  deleteSession: vi.fn(),
  subscribeRunningSessions: vi.fn()
}))

import { useConfigPanel } from '../composables/useConfigPanel'
import * as api from '@/api/agent'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useConfigPanel — models', () => {
  it('loadModels populates the list', async () => {
    vi.mocked(api.getModelConfig).mockResolvedValueOnce([
      { id: 'gpt-4', name: 'GPT-4', provider: 'openai', enabled: true, contextWindow: 128000 },
      { id: 'claude', name: 'Claude', provider: 'anthropic', enabled: true }
    ])
    const c = useConfigPanel()
    await c.loadModels()
    expect(c.models.value).toHaveLength(2)
    expect(c.loadingModels.value).toBe(false)
  })

  it('setModelEnabled optimistically toggles and rolls back on failure', async () => {
    vi.mocked(api.getModelConfig).mockResolvedValueOnce([
      { id: 'gpt-4', name: 'GPT-4', provider: 'openai', enabled: true }
    ])
    vi.mocked(api.setModelConfig).mockRejectedValueOnce(new Error('save failed'))
    const c = useConfigPanel()
    await c.loadModels()
    await c.setModelEnabled('gpt-4', false)
    expect(c.models.value[0].enabled).toBe(true) // rolled back
    expect(c.error.value).toBe('save failed')
  })

  it('setModelEnabled is no-op when savingModels is already true', async () => {
    vi.mocked(api.getModelConfig).mockResolvedValueOnce([
      { id: 'gpt-4', name: 'GPT-4', provider: 'openai', enabled: true }
    ])
    vi.mocked(api.setModelConfig).mockImplementationOnce(() => new Promise(() => {})) // never resolves
    const c = useConfigPanel()
    await c.loadModels()
    const p = c.setModelEnabled('gpt-4', false) // hangs
    // immediate second call must not start another save
    await c.setModelEnabled('gpt-4', true)
    expect(api.setModelConfig).toHaveBeenCalledTimes(1)
    // cleanup
    p.catch(() => {})
  })
})

describe('useConfigPanel — skills', () => {
  it('loadSkills needs cwd', async () => {
    const c = useConfigPanel()
    await c.loadSkills('')
    expect(c.skills.value).toEqual([])
    expect(api.getSkills).not.toHaveBeenCalled()
  })

  it('setSkillEnabled toggles and rolls back on failure', async () => {
    vi.mocked(api.getSkills).mockResolvedValueOnce([
      { id: '/x/SKILL.md', name: 'X', enabled: true, source: '/x/SKILL.md' }
    ])
    vi.mocked(api.setSkillEnabled).mockRejectedValueOnce(new Error('fail'))
    const c = useConfigPanel()
    await c.loadSkills('/cwd')
    await c.setSkillEnabled('/x/SKILL.md', '/x/SKILL.md', false)
    expect(c.skills.value[0].enabled).toBe(true)
    expect(c.error.value).toBe('fail')
  })
})

describe('useConfigPanel — plugins', () => {
  it('loadPlugins needs cwd', async () => {
    const c = useConfigPanel()
    await c.loadPlugins('')
    expect(api.getPlugins).not.toHaveBeenCalled()
  })

  it('setPluginEnabled calls API with parsed scope/source', async () => {
    vi.mocked(api.getPlugins).mockResolvedValueOnce([
      { id: 'global::npm:foo@1', name: 'foo', version: '1.0.0', enabled: true, description: 'npm:foo@1' }
    ])
    vi.mocked(api.setPluginEnabled).mockResolvedValueOnce(undefined as any)
    const c = useConfigPanel()
    await c.loadPlugins('/cwd')
    await c.setPluginEnabled('global::npm:foo@1', '/cwd', 'global', 'npm:foo@1', false)
    expect(api.setPluginEnabled).toHaveBeenCalledWith('/cwd', 'global', 'npm:foo@1', false)
    expect(c.plugins.value[0].enabled).toBe(false)
  })
})

describe('useConfigPanel — error utilities', () => {
  it('clearError resets error state', async () => {
    vi.mocked(api.getModelConfig).mockRejectedValueOnce(new Error('x'))
    const c = useConfigPanel()
    await c.loadModels()
    expect(c.error.value).toBe('x')
    c.clearError()
    expect(c.error.value).toBeNull()
  })
})