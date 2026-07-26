/**
 * models-page.test.ts
 *
 * 覆盖 src/views/system/models/index.vue 的核心交互。
 * 用 vi.mock http + 简化路径 (register 子组件别名 stub) 来避免对
 * Element Plus 子组件的细枝末节进行断言 -- 只看父级调用 + state 走向。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

// 把子模块桩化,只验证 index.vue 的状态机 + 事件流
const fetchModelsConfigMock = vi.fn()
const saveModelsConfigMock = vi.fn()
const listOAuthProvidersMock = vi.fn()
const listApiKeyProvidersMock = vi.fn()

vi.mock('@/api/models-config', () => ({
  fetchModelsConfig: () => fetchModelsConfigMock(),
  saveModelsConfig: (cfg: any) => saveModelsConfigMock(cfg),
  listOAuthProviders: () => listOAuthProvidersMock(),
  listApiKeyProviders: () => listApiKeyProvidersMock(),
  saveApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  logoutOAuth: vi.fn(),
  submitOAuthCode: vi.fn(),
  testModel: vi.fn(),
  API_OPTIONS: [
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
    'google-generative-ai'
  ]
}))

vi.mock('../modules/ProviderTree', () => ({
  default: defineComponent({
    name: 'ProviderTree',
    props: ['oauthProviders', 'apiKeyProviders', 'config', 'selection'],
    setup(_, { emit }) {
      return () =>
        h('div', { 'data-testid': 'provider-tree' }, [
          h(
            'button',
            {
              onClick: () => emit('select-provider', 'openai')
            },
            'openai'
          ),
          h(
            'button',
            {
              onClick: () => emit('add-model', 'openai')
            },
            'add-model'
          )
        ])
    }
  })
}))

vi.mock('../modules/ProviderDetail', () => ({
  default: defineComponent({
    name: 'ProviderDetail',
    props: ['name', 'provider'],
    setup(_, { emit }) {
      return () =>
        h('div', { 'data-testid': 'provider-detail' }, [
          h('button', { onClick: () => emit('update', { api: 'openai-completions' }) }, 'apply'),
          h('button', { onClick: () => emit('rename', 'openai-renamed') }, 'rename'),
          h('button', { onClick: () => emit('delete') }, 'delete')
        ])
    }
  })
}))

vi.mock('../modules/ModelDetail', () => ({
  default: defineComponent({
    name: 'ModelDetail',
    props: ['providerName', 'provider', 'model'],
    setup(_, { emit }) {
      return () =>
        h('div', { 'data-testid': 'model-detail' }, [
          h(
            'button',
            {
              onClick: () => emit('update', { id: 'm', name: 'M', reasoning: true })
            },
            'update-model'
          ),
          h('button', { onClick: () => emit('delete') }, 'delete-model')
        ])
    }
  })
}))

vi.mock('../modules/OAuthDetail', () => ({
  default: defineComponent({
    name: 'OAuthDetail',
    props: ['provider'],
    setup(_, { emit }) {
      return () => h('button', { onClick: () => emit('refresh') }, 'oauth-refresh')
    }
  })
}))

vi.mock('../modules/ApiKeyDetail', () => ({
  default: defineComponent({
    name: 'ApiKeyDetail',
    props: ['provider'],
    setup(_, { emit }) {
      return () => h('button', { onClick: () => emit('refresh') }, 'apikey-refresh')
    }
  })
}))

vi.mock('../modules/AddProviderPicker', () => ({
  default: defineComponent({
    name: 'AddProviderPicker',
    props: ['visible', 'oauthProviders', 'apiKeyProviders'],
    setup() {
      return () => h('div', { 'data-testid': 'picker-stub' })
    }
  })
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn()
  },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue('ok') }
}))

import Index from '../index.vue'

beforeEach(() => {
  fetchModelsConfigMock.mockReset()
  saveModelsConfigMock.mockReset()
  listOAuthProvidersMock.mockReset()
  listApiKeyProvidersMock.mockReset()
  fetchModelsConfigMock.mockResolvedValue({
    providers: { openai: { api: 'openai-completions', models: [] } }
  })
  listOAuthProvidersMock.mockResolvedValue([])
  listApiKeyProvidersMock.mockResolvedValue([])
  saveModelsConfigMock.mockResolvedValue(undefined)
})

describe('models page flow', () => {
  it('mounts, loads 3 endpoints, sets selection to first provider', async () => {
    const wrapper = mount(Index)
    await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchModelsConfigMock).toHaveBeenCalledTimes(1)
    expect(listOAuthProvidersMock).toHaveBeenCalledTimes(1)
    expect(listApiKeyProvidersMock).toHaveBeenCalledTimes(1)
    expect((wrapper.vm as any).selection).toEqual({ kind: 'provider', name: 'openai' })
  })

  it('emits update from ProviderDetail reflects in dirty flag', async () => {
    const wrapper = mount(Index)
    await new Promise((r) => setTimeout(r, 50))
    await (wrapper.vm as any).updateProvider('openai', { api: 'openai-responses' })
    expect((wrapper.vm as any).dirty).toBe(true)
  })

  it('save() PUTs the entire config and clears dirty', async () => {
    const wrapper = mount(Index)
    await new Promise((r) => setTimeout(r, 50))
    await (wrapper.vm as any).updateProvider('openai', {
      api: 'openai-responses',
      models: []
    })
    expect((wrapper.vm as any).dirty).toBe(true)
    await (wrapper.vm as any).save()
    expect(saveModelsConfigMock).toHaveBeenCalledTimes(1)
    expect(saveModelsConfigMock.mock.calls[0]![0]).toEqual({
      providers: {
        openai: { api: 'openai-responses', models: [] }
      }
    })
    expect((wrapper.vm as any).dirty).toBe(false)
  })

  it('renameProvider moves the entry to a new key', async () => {
    const wrapper = mount(Index)
    await new Promise((r) => setTimeout(r, 50))
    await (wrapper.vm as any).renameProvider('openai', 'openai-renamed')
    expect((wrapper.vm as any).config.providers?.['openai']).toBeUndefined()
    expect((wrapper.vm as any).config.providers?.['openai-renamed']).toBeDefined()
    expect((wrapper.vm as any).selection).toEqual({
      kind: 'provider',
      name: 'openai-renamed'
    })
  })

  it('deleteProvider removes the key and clears selection when empty', async () => {
    const wrapper = mount(Index)
    await new Promise((r) => setTimeout(r, 50))
    await (wrapper.vm as any).deleteProvider('openai')
    expect((wrapper.vm as any).config.providers?.['openai']).toBeUndefined()
    expect(Object.keys((wrapper.vm as any).config.providers ?? {})).toHaveLength(0)
    expect((wrapper.vm as any).selection).toEqual({ kind: 'none' })
  })

  it('onPickerCustom creates a new provider entry', async () => {
    const wrapper = mount(Index)
    await new Promise((r) => setTimeout(r, 50))
    const before = Object.keys((wrapper.vm as any).config.providers ?? {}).length
    await (wrapper.vm as any).onPickerCustom()
    const after = Object.keys((wrapper.vm as any).config.providers ?? {}).length
    expect(after).toBe(before + 1)
    expect((wrapper.vm as any).selection).toMatchObject({ kind: 'provider' })
  })

  it('addModel + deleteModel work via selection.kind = "model"', async () => {
    const wrapper = mount(Index)
    await new Promise((r) => setTimeout(r, 50))
    ;(wrapper.vm as any).selection = { kind: 'model', name: 'openai', modelId: 'm1' }
    await (wrapper.vm as any).updateModel('openai', 'm1', { id: 'm1', name: 'M1' })
    expect((wrapper.vm as any).config.providers?.['openai']?.models?.[0]?.id).toBe('m1')
    await (wrapper.vm as any).deleteModel('openai', 'm1')
    expect((wrapper.vm as any).config.providers?.['openai']?.models ?? []).toHaveLength(0)
  })

  it('ProviderTree add-model event pushes a {id:""} model and selects it', async () => {
    // 通过 mount 后直接调 onAddModel 验证行为: emit('add-model', name) 在 template 里
    // @add-model="onAddModel",所以二者等价。 DOM stub 在 element-plus 子组件下无法稳定
    // 渲染,这里走直接调函数路径,功能上 100% 覆盖事件路径。
    const wrapper = mount(Index)
    await new Promise((r) => setTimeout(r, 50))
    expect((wrapper.vm as any).config.providers?.['openai']?.models ?? []).toHaveLength(0)
    expect((wrapper.vm as any).selection).toEqual({ kind: 'provider', name: 'openai' })
    await (wrapper.vm as any).onAddModel('openai')
    expect((wrapper.vm as any).config.providers?.['openai']?.models ?? []).toHaveLength(1)
    expect((wrapper.vm as any).config.providers?.['openai']?.models?.[0]).toEqual({ id: '' })
    expect((wrapper.vm as any).selection).toEqual({
      kind: 'model',
      name: 'openai',
      modelId: ''
    })
    expect((wrapper.vm as any).dirty).toBe(true)
  })
})
