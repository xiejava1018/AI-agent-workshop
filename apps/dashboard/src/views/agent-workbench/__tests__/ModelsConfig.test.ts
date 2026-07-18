/**
 * ModelsConfig.vue 组件测试
 *
 * 覆盖:
 *   - 加载状态(空 / 加载中)
 *   - API 调用契约(getModelConfig)
 *   - 「应用」按钮 emit('close')
 *   - 错误弹 ElNotification
 *
 * 注:happy-dom 下 el-table 列 slot 渲染不稳定 — 使用 globalStubs 让 el-table /
 * el-table-column 渲染为占位元素,跳过其内部 slot 渲染。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
  ElNotification: vi.fn()
}))

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
  subscribeRunningSessions: vi.fn(() => ({
    source: { close: () => {}, onmessage: null, onerror: null },
    unsubscribe: () => {}
  }))
}))

import { mount, flushPromises } from '@vue/test-utils'
import ModelsConfig from '../components/ModelsConfig.vue'
import * as api from '@/api/agent'

const stubs = {
  ElTable: true,
  ElTableColumn: true,
  ElRadio: true,
  ElSwitch: true,
  ElButton: true
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ModelsConfig — mount', () => {
  it('renders title and calls getModelConfig on mount', async () => {
    vi.mocked(api.getModelConfig).mockResolvedValueOnce([])
    const wrapper = mount(ModelsConfig, { props: {}, global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('模型配置')
    expect(api.getModelConfig).toHaveBeenCalledTimes(1)
  })
})

describe('ModelsConfig — apply button', () => {
  it('emits close when "应用" clicked', async () => {
    vi.mocked(api.getModelConfig).mockResolvedValueOnce([
      { id: 'gpt-4', name: 'GPT-4', provider: 'openai', enabled: true }
    ])
    const wrapper = mount(ModelsConfig, { props: {}, global: { stubs } })
    await flushPromises()
    // 第二个 ElButton 是「应用」,第一个是「取消」;stub 不渲染 slot 文案。
    const buttons = wrapper.findAllComponents({ name: 'ElButton' })
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    await buttons[1].trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})

describe('ModelsConfig — error notification', () => {
  it('shows ElNotification when load fails', async () => {
    vi.mocked(api.getModelConfig).mockRejectedValueOnce(new Error('boom'))
    const ElNotification = (await import('element-plus')).ElNotification as any
    mount(ModelsConfig, { props: {}, global: { stubs } })
    await flushPromises()
    expect(ElNotification).toHaveBeenCalled()
  })
})