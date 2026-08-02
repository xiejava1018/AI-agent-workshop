<!--
  system/models/index.vue
  Master-detail page: provider/model 编辑 + OAuth/API-Key managed interactions。
  复刻 React apps/web/components/ModelsConfig.tsx 的核心能力,但用 Vue 3 + Element Plus
  native (master-detail 在 page 上,不是 modal-in-modal)。

  步骤 (plan §6):
    Step 5: 骨架(load + selection + empty state + save bar 占位)
    Step 6: ProviderIcon
    Step 7: ProviderTree
    Step 8-13: 接入各 detail 子组件
    Step 14: Save + Reload 接通
-->
<template>
  <div class="models-page art-full-height">
    <!-- Header -->
    <!-- Toolbar (不强制 ArtTableHeader,沿用 dashboard ElButton 风格) -->
    <div class="models-page__toolbar">
      <ElButton :icon="Plus" @click="pickerOpen = true">添加提供方</ElButton>
      <ElButton :loading="loading" @click="reload">刷新</ElButton>
      <div class="models-page__toolbar-spacer" />
      <ElButton type="primary" :loading="saving" :disabled="!dirty" @click="save"> 保存 </ElButton>
    </div>

    <ElCard shadow="never" class="art-table-card models-page__card">
      <div class="models-page__body">
        <!-- Left tree -->
        <ProviderTree
          class="models-page__tree"
          :oauth-providers="oauthProvidersForTree"
          :api-key-providers="apiKeyProvidersForTree"
          :config="config"
          :selection="selection"
          @select-oauth="onSelectOAuth"
          @select-apikey="onSelectApiKey"
          @select-provider="onSelectProvider"
          @select-model="onSelectModel"
          @add-model="onAddModel"
        />

        <!-- Right detail -->
        <div class="models-page__detail">
          <ElEmpty
            v-if="selection.kind === 'none' && !loading"
            description="选择左侧一个提供方或模型开始配置"
            class="models-page__empty"
          />
          <ElSkeleton v-else-if="loading" :rows="6" animated />

          <OAuthDetail
            v-else-if="oauthSelection"
            :provider="oauthSelection.provider"
            @refresh="onProvidersRefresh"
          />

          <ApiKeyDetail
            v-else-if="apiKeySelection"
            :provider="apiKeySelection.provider"
            @refresh="onProvidersRefresh"
          />

          <ProviderDetail
            v-else-if="providerSelection"
            :name="providerSelection.name"
            :provider="providerSelection.provider"
            @update="(p) => updateProvider(providerSelection!.name, p)"
            @rename="(n) => renameProvider(providerSelection!.name, n)"
            @delete="() => deleteProvider(providerSelection!.name)"
          />

          <ModelDetail
            v-else-if="modelSelection"
            :provider-name="modelSelection.name"
            :provider="modelSelection.provider"
            :model="modelSelection.model"
            @update="
              (m) => modelSelection && updateModel(modelSelection.name, modelSelection.model.id, m)
            "
            @delete="
              () => modelSelection && deleteModel(modelSelection.name, modelSelection.model.id)
            "
          />
        </div>
      </div>
    </ElCard>

    <AddProviderPicker
      v-model:visible="pickerOpen"
      :oauth-providers="oauthProviders"
      :api-key-providers="apiKeyProviders"
      @pick-oauth="onPickerOAuth"
      @pick-apikey="onPickerApiKey"
      @pick-custom="onPickerCustom"
    />
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue'
  import { Plus } from '@element-plus/icons-vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import {
    fetchModelsConfig,
    saveModelsConfig,
    listOAuthProviders,
    listApiKeyProviders,
    type ModelsConfigShape,
    type ModelEntryShape,
    type ProviderEntryShape,
    type OAuthProviderShape,
    type ApiKeyProviderShape
  } from '@/api/models-config'
  import type { Selection } from './modules/types'

  import ProviderTree from './modules/ProviderTree.vue'
  import ProviderDetail from './modules/ProviderDetail.vue'
  import ModelDetail from './modules/ModelDetail.vue'
  import OAuthDetail from './modules/OAuthDetail.vue'
  import ApiKeyDetail from './modules/ApiKeyDetail.vue'
  import AddProviderPicker from './modules/AddProviderPicker.vue'

  defineOptions({ name: 'Models' })

  // --- top-level state --------------------------------------------------------

  const config = ref<ModelsConfigShape>({ providers: {} })
  const originalSnapshot = ref<string>('')
  // oauthProviders / apiKeyProviders 保留 ALL(给 "添加提供方" 弹窗挑未配置 provider 用)。
  // 左栏 ProviderTree 拿的是下面两个 *_ForTree(已配置的)。
  const oauthProviders = ref<OAuthProviderShape[]>([])
  const apiKeyProviders = ref<ApiKeyProviderShape[]>([])
  // 左栏专供:与服务端 apps/web ModelsConfig.tsx 的 activeOAuth/activeApiKey 语义一致。
  const oauthProvidersForTree = computed(() => oauthProviders.value.filter((p) => p.loggedIn))
  const apiKeyProvidersForTree = computed(() => apiKeyProviders.value.filter((p) => p.configured))
  const selection = ref<Selection>({ kind: 'none' })
  const pickerOpen = ref(false)
  const loading = ref(true)
  const saving = ref(false)

  const dirty = computed(() => JSON.stringify(config.value) !== originalSnapshot.value)

  // --- lookups (used by templates to resolve selection -> shape) ---------------

  const oauthSelection = computed(() => {
    const s = selection.value
    if (s.kind !== 'oauth') return null
    const provider = oauthProviders.value.find((p) => p.id === s.providerId)
    return provider ? { provider } : null
  })

  const apiKeySelection = computed(() => {
    const s = selection.value
    if (s.kind !== 'apikey') return null
    const provider = apiKeyProviders.value.find((p) => p.id === s.providerId)
    return provider ? { provider } : null
  })

  const providerSelection = computed(() => {
    const s = selection.value
    if (s.kind !== 'provider') return null
    return {
      name: s.name,
      provider: config.value.providers?.[s.name] ?? {}
    }
  })

  const modelSelection = computed(() => {
    const s = selection.value
    if (s.kind !== 'model') return null
    const provider = config.value.providers?.[s.name] ?? {}
    const model = (provider.models ?? []).find((m) => m.id === s.modelId) ?? {
      id: s.modelId
    }
    return { name: s.name, provider, model }
  })

  // --- load / reload ----------------------------------------------------------

  async function load(): Promise<void> {
    loading.value = true
    try {
      const [cfg, oauth, apiKey] = await Promise.all([
        fetchModelsConfig(),
        listOAuthProviders(),
        listApiKeyProviders()
      ])
      config.value = cfg
      oauthProviders.value = oauth
      apiKeyProviders.value = apiKey
      originalSnapshot.value = JSON.stringify(cfg)

      // 默认选第一个 custom provider (跟 React ModelsConfig 一致)
      const keys = Object.keys(cfg.providers ?? {})
      if (keys.length > 0 && selection.value.kind === 'none') {
        selection.value = { kind: 'provider', name: keys[0]! }
      }
    } catch (e) {
      ElMessage.error('加载模型配置失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      loading.value = false
    }
  }

  async function reload(): Promise<void> {
    if (dirty.value) {
      try {
        await ElMessageBox.confirm('当前有未保存的修改,确定放弃并重新加载吗?', '提示', {
          type: 'warning',
          confirmButtonText: '放弃并刷新',
          cancelButtonText: '取消'
        })
      } catch {
        return
      }
    }
    await load()
  }

  onMounted(load)

  // --- save ------------------------------------------------------------------

  async function save(): Promise<void> {
    saving.value = true
    try {
      await saveModelsConfig(config.value)
      originalSnapshot.value = JSON.stringify(config.value)
      ElMessage.success('已保存')
    } catch (e) {
      ElMessage.error('保存失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      saving.value = false
    }
  }

  // --- mutators (immutable) ---------------------------------------------------

  function updateProvider(name: string, next: ProviderEntryShape): void {
    config.value = {
      ...config.value,
      providers: { ...(config.value.providers ?? {}), [name]: next }
    }
  }

  function renameProvider(oldName: string, newName: string): void {
    if (oldName === newName || !newName.trim()) return
    const providers = { ...(config.value.providers ?? {}) }
    const entry = providers[oldName]
    if (!entry) return
    delete providers[oldName]
    providers[newName] = entry
    config.value = { ...config.value, providers }
    if (selection.value.kind === 'provider' && selection.value.name === oldName) {
      selection.value = { kind: 'provider', name: newName }
    } else if (selection.value.kind === 'model' && selection.value.name === oldName) {
      selection.value = { ...selection.value, name: newName }
    }
  }

  function deleteProvider(name: string): void {
    const providers = { ...(config.value.providers ?? {}) }
    delete providers[name]
    config.value = { ...config.value, providers }
    const remaining = Object.keys(config.value.providers ?? {})
    selection.value =
      remaining.length > 0 ? { kind: 'provider', name: remaining[0]! } : { kind: 'none' }
  }

  function updateModel(providerName: string, modelId: string, next: ModelEntryShape): void {
    const provider = config.value.providers?.[providerName] ?? {}
    const models = [...(provider.models ?? [])]
    const idx = models.findIndex((m) => m.id === modelId)
    if (idx === -1) {
      models.push(next)
    } else {
      models[idx] = next
    }
    updateProvider(providerName, { ...provider, models })
  }

  function deleteModel(providerName: string, modelId: string): void {
    const provider = config.value.providers?.[providerName] ?? {}
    const models = (provider.models ?? []).filter((m: ModelEntryShape) => m.id !== modelId)
    updateProvider(providerName, { ...provider, models })
    selection.value = { kind: 'provider', name: providerName }
  }

  // --- selection (来自 ProviderTree) -------------------------------------------

  function onSelectOAuth(providerId: string): void {
    selection.value = { kind: 'oauth', providerId }
  }
  function onSelectApiKey(providerId: string): void {
    selection.value = { kind: 'apikey', providerId }
  }
  function onSelectProvider(name: string): void {
    selection.value = { kind: 'provider', name }
  }
  function onSelectModel(name: string, modelId: string): void {
    selection.value = { kind: 'model', name, modelId }
  }

  /**
   * 收到左栏 "+ model" 点击。
   * 在该 provider 的 models 末尾 push 一个占位 `{id: ''}` 让用户立刻能填，
   * 并把 selection 切到新 model 让右侧进入 ModelDetail 立刻编辑。
   * 对齐 apps/web ModelsConfig.tsx 的 addModel 行为。
   */
  function onAddModel(name: string): void {
    const provider = config.value.providers?.[name]
    if (!provider) return
    const models = [...(provider.models ?? []), { id: '' }]
    updateProvider(name, { ...provider, models })
    selection.value = { kind: 'model', name, modelId: '' }
  }

  // --- picker (AddProviderPicker emits) ---------------------------------------

  function onPickerOAuth(providerId: string): void {
    selection.value = { kind: 'oauth', providerId: providerId }
    pickerOpen.value = false
  }
  function onPickerApiKey(providerId: string): void {
    selection.value = { kind: 'apikey', providerId }
    pickerOpen.value = false
  }
  function onPickerCustom(): void {
    // 生成一个不重名的 new-provider 槽位,跟 React 一致
    const existing = config.value.providers ?? {}
    let name = 'new-provider'
    let n = 1
    while (existing[name]) name = `new-provider-${n++}`
    updateProvider(name, { api: 'openai-completions', models: [] })
    selection.value = { kind: 'provider', name }
    pickerOpen.value = false
  }

  // --- refresh OAuth / API-Key managed providers -----------------------------

  async function onProvidersRefresh(): Promise<void> {
    try {
      const [oauth, apiKey] = await Promise.all([listOAuthProviders(), listApiKeyProviders()])
      oauthProviders.value = oauth
      apiKeyProviders.value = apiKey
    } catch (e) {
      ElMessage.error('刷新提供方失败: ' + (e instanceof Error ? e.message : String(e)))
    }
  }
</script>

<style lang="scss" scoped>
  .models-page {
    display: flex;
    flex-direction: column;
    gap: 12px;

    &__toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    &__toolbar-spacer {
      flex: 1;
    }

    &__card {
      flex: 1;
      min-height: 0;
    }

    &__body {
      display: flex;
      gap: 16px;
      height: calc(100vh - 220px);
      min-height: 480px;
    }

    &__tree {
      width: 320px;
      flex-shrink: 0;
      overflow-y: auto;
      border: 1px solid var(--el-border-color-light, var(--el-border-color-lighter));
      border-radius: 6px;
      background: var(--el-fill-color-blank);
    }

    &__detail {
      flex: 1;
      min-width: 0;
      overflow-y: auto;
      padding: 4px 4px 24px;
    }

    &__empty {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }
</style>
