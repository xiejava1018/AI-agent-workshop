/**
 * SkillsConfig.vue 组件测试
 *
 * 覆盖:
 *   - 无 cwd 时显示占位提示,不调用 getSkills
 *   - 有 cwd 时调用 getSkills
 *   - 「关闭」按钮 → emit('close')
 *
 * 注:happy-dom 下 el-table 列 slot 渲染不稳定 — 使用 globalStubs 跳过其内部渲染。
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
import SkillsConfig from '../components/SkillsConfig.vue'
import * as api from '@/api/agent'

const stubs = {
  ElTable: true,
  ElTableColumn: true,
  ElSwitch: true,
  ElButton: true
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SkillsConfig — no cwd', () => {
  it('shows placeholder when cwd is empty', async () => {
    const wrapper = mount(SkillsConfig, { props: {}, global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('请先选择工作目录')
    expect(api.getSkills).not.toHaveBeenCalled()
  })
})

describe('SkillsConfig — with cwd', () => {
  it('calls getSkills on mount with cwd', async () => {
    vi.mocked(api.getSkills).mockResolvedValueOnce([])
    mount(SkillsConfig, { props: { cwd: '/proj' }, global: { stubs } })
    await flushPromises()
    expect(api.getSkills).toHaveBeenCalledWith('/proj')
  })

  it('emits close when 「关闭」 clicked', async () => {
    vi.mocked(api.getSkills).mockResolvedValueOnce([])
    const wrapper = mount(SkillsConfig, { props: { cwd: '/proj' }, global: { stubs } })
    await flushPromises()
    // 单个 ElButton 时直接触发 click 即可(stub 会把 click 透传到父 @click)
    const buttons = wrapper.findAllComponents({ name: 'ElButton' })
    expect(buttons.length).toBeGreaterThan(0)
    await buttons[0].trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})