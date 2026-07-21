<template>
  <div class="models-page">
    <div class="toolbar">
      <div class="title-group">
        <h3>模型配置</h3>
        <code class="path">~/.pi/agent/models.json</code>
      </div>
      <div class="toolbar-actions">
        <ElButton :icon="Plus" @click="pickerOpen = true">添加供应商</ElButton>
        <ElButton type="primary" :loading="saving" :disabled="savedOk" @click="handleSave">
          {{ savedOk ? '已保存' : '保存' }}
        </ElButton>
      </div>
    </div>

    <div class="body">
      <!-- 左：树 -->
      <div class="tree-panel">
        <div class="tree-scroll">
          <div v-if="loading" class="hint-text">加载中…</div>
          <template v-else>
            <!-- OAuth -->
            <div
              v-for="p in activeOAuth"
              :key="'oauth-' + p.id"
              class="tree-item"
              :class="{ active: isSelected('oauth', p.id) }"
              @click="selectOAuth(p.id)"
            >
              <ProviderIcon :id="p.id" :size="16" />
              <span class="label">{{ p.name }}</span>
            </div>

            <!-- API Key -->
            <div
              v-for="p in activeApiKey"
              :key="'apikey-' + p.id"
              class="tree-item"
              :class="{ active: isSelected('apikey', p.id) }"
              @click="selectApiKey(p.id)"
            >
              <ProviderIcon :id="p.id" :size="16" />
              <span class="label">{{ p.displayName }}</span>
            </div>

            <div
              v-if="(activeOAuth.length || activeApiKey.length) && providerEntries.length"
              class="divider"
            />

            <!-- 自定义供应商 -->
            <div v-for="[pName, pData] in providerEntries" :key="pName" class="provider-group">
              <div
                class="tree-item"
                :class="{ active: isSelected('provider', pName) }"
                @click="selectProvider(pName)"
              >
                <ElIcon class="chip-icon"><Cpu /></ElIcon>
                <span class="label mono">{{ pName }}</span>
              </div>
              <div
                v-for="(m, i) in pData.models ?? []"
                :key="pName + '-' + i"
                class="tree-item model-row"
                :class="{ active: isSelectedModel(pName, i) }"
                @click="selectModel(pName, i)"
              >
                <span class="label mono dim">{{ m.id || '新模型' }}</span>
                <ElTag v-if="m.reasoning" size="small" type="primary" effect="plain" class="t-tag"
                  >推理</ElTag
                >
              </div>
              <div class="tree-item add-model" @click="addModel(pName)">
                <span class="label dim">+ 模型</span>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- 右：详情 -->
      <div class="detail-panel">
        <ElForm v-if="detailVisible" label-position="top" class="detail-form">
          <ProviderDetail
            v-if="selectedType === 'provider'"
            :key="selProvider.name"
            :name="selProvider.name"
            :provider="config.providers![selProvider.name]"
            @change="(p) => updateProvider(selProvider.name, p)"
            @rename="(n) => renameProvider(selProvider.name, n)"
            @delete="deleteProvider(selProvider.name)"
          />
          <ModelDetail
            v-else-if="selectedType === 'model'"
            :key="selModel.providerName + '-' + selModel.index"
            :provider-name="selModel.providerName"
            :provider="config.providers![selModel.providerName]"
            :model="config.providers![selModel.providerName].models![selModel.index]"
            @change="(m) => updateModel(selModel.providerName, selModel.index, m)"
            @delete="removeModel(selModel.providerName, selModel.index)"
          />
          <ApiKeyDetail
            v-else-if="selectedType === 'apikey'"
            :key="selProviderId"
            :provider="apiKeyProviders.find((p) => p.id === selProviderId)!"
            @refresh="loadApiKeyProviders"
          />
          <OAuthDetail
            v-else-if="selectedType === 'oauth'"
            :key="selProviderId"
            :provider="oauthProviders.find((p) => p.id === selProviderId)!"
            @refresh="loadOAuthProviders"
          />
        </ElForm>
        <div v-else-if="!loading" class="empty">选择一个供应商或模型</div>
      </div>
    </div>

    <AddProviderPicker
      v-model="pickerOpen"
      :oauth-providers="oauthProviders"
      :api-key-providers="apiKeyProviders"
      @add-custom="addCustomProvider"
      @select-oauth="selectOAuth"
      @select-apikey="selectApiKey"
    />
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, onMounted } from 'vue'
  import { ElMessage } from 'element-plus'
  import { Plus, Cpu } from '@element-plus/icons-vue'
  import {
    getModelsConfig,
    saveModelsConfig,
    getOAuthProviders,
    getApiKeyProviders,
    type ModelsConfig,
    type OAuthProvider,
    type ApiKeyProvider,
    type ProviderEntry,
    type ModelEntry
  } from '@/api/models-config'
  import ProviderIcon from './components/ProviderIcon.vue'
  import ProviderDetail from './components/ProviderDetail.vue'
  import ModelDetail from './components/ModelDetail.vue'
  import ApiKeyDetail from './components/ApiKeyDetail.vue'
  import OAuthDetail from './components/OAuthDetail.vue'
  import AddProviderPicker from './components/AddProviderPicker.vue'

  defineOptions({ name: 'ModelsConfig' })

  const config = ref<ModelsConfig>({ providers: {} })
  const loading = ref(true)
  const saving = ref(false)
  const savedOk = ref(false)
  const pickerOpen = ref(false)

  const oauthProviders = ref<OAuthProvider[]>([])
  const apiKeyProviders = ref<ApiKeyProvider[]>([])

  type Selection =
    | { type: 'provider'; name: string }
    | { type: 'model'; providerName: string; index: number }
    | { type: 'oauth'; providerId: string }
    | { type: 'apikey'; providerId: string }

  const selection = ref<Selection | null>(null)

  // 细化后的当前选择，供模板安全访问。
  // Vue 模板对联合类型 ref 在 v-if 内收敛不稳定，因此这里把每个分支拆成
  // 独立的确定类型计算属性，由 selectedType 控制显隐。
  const selectedType = computed(() => selection.value?.type ?? '')
  const selProvider = computed(() =>
    selection.value?.type === 'provider' ? selection.value : (null as unknown as { name: string })
  )
  const selModel = computed(() =>
    selection.value?.type === 'model'
      ? selection.value
      : (null as unknown as { providerName: string; index: number })
  )
  const selProviderId = computed(() =>
    selection.value?.type === 'apikey' || selection.value?.type === 'oauth'
      ? selection.value.providerId
      : ''
  )

  const providerEntries = computed(() => Object.entries(config.value.providers ?? {}))

  const activeOAuth = computed(() => oauthProviders.value.filter((p) => p.loggedIn))
  const activeApiKey = computed(() => apiKeyProviders.value.filter((p) => p.configured))
  const detailVisible = computed(() => !!selection.value)

  function isSelected(type: Selection['type'], id: string) {
    return (
      selection.value?.type === type &&
      (selection.value as { providerId?: string }).providerId === id
    )
  }
  function isSelectedModel(providerName: string, index: number) {
    return (
      selection.value?.type === 'model' &&
      selection.value.providerName === providerName &&
      selection.value.index === index
    )
  }

  function selectProvider(name: string) {
    selection.value = { type: 'provider', name }
  }
  function selectModel(providerName: string, index: number) {
    selection.value = { type: 'model', providerName, index }
  }
  function selectOAuth(id: string) {
    selection.value = { type: 'oauth', providerId: id }
    pickerOpen.value = false
  }
  function selectApiKey(id: string) {
    selection.value = { type: 'apikey', providerId: id }
    pickerOpen.value = false
  }

  // ── 供应商/模型 CRUD ──────────────────────────────────────────────────────────
  function updateProvider(name: string, p: ProviderEntry) {
    config.value = { ...config.value, providers: { ...(config.value.providers ?? {}), [name]: p } }
  }

  function renameProvider(oldName: string, newName: string) {
    const entries = Object.entries(config.value.providers ?? {})
    const idx = entries.findIndex(([k]) => k === oldName)
    if (idx === -1) return
    entries[idx] = [newName, entries[idx][1]]
    config.value = { ...config.value, providers: Object.fromEntries(entries) }
    if (selection.value?.type === 'provider' && selection.value.name === oldName) {
      selection.value = { type: 'provider', name: newName }
    } else if (selection.value?.type === 'model' && selection.value.providerName === oldName) {
      selection.value = { ...selection.value, providerName: newName }
    }
  }

  function deleteProvider(name: string) {
    const providers = { ...(config.value.providers ?? {}) }
    delete providers[name]
    config.value = { ...config.value, providers }
    const remaining = Object.keys(providers)
    selection.value = remaining.length ? { type: 'provider', name: remaining[0] } : null
  }

  function addCustomProvider() {
    let finalName = 'new-provider'
    let n = 1
    while (config.value.providers?.[finalName]) finalName = `new-provider-${n++}`
    config.value = {
      ...config.value,
      providers: { ...(config.value.providers ?? {}), [finalName]: { api: 'openai-completions' } }
    }
    selection.value = { type: 'provider', name: finalName }
  }

  function addModel(providerName: string) {
    const provider = config.value.providers?.[providerName] ?? {}
    const models = [...(provider.models ?? []), { id: '' }]
    config.value = {
      ...config.value,
      providers: { ...(config.value.providers ?? {}), [providerName]: { ...provider, models } }
    }
    const idx = (config.value.providers?.[providerName]?.models?.length ?? 1) - 1
    selection.value = { type: 'model', providerName, index: idx }
  }

  function updateModel(providerName: string, index: number, m: ModelEntry) {
    const provider = config.value.providers?.[providerName] ?? {}
    const models = [...(provider.models ?? [])]
    models[index] = m
    config.value = {
      ...config.value,
      providers: { ...(config.value.providers ?? {}), [providerName]: { ...provider, models } }
    }
  }

  function removeModel(providerName: string, index: number) {
    const provider = config.value.providers?.[providerName] ?? {}
    const models = [...(provider.models ?? [])]
    models.splice(index, 1)
    config.value = {
      ...config.value,
      providers: {
        ...(config.value.providers ?? {}),
        [providerName]: { ...provider, models: models.length ? models : undefined }
      }
    }
    selection.value = { type: 'provider', name: providerName }
  }

  // ── 加载 ──────────────────────────────────────────────────────────────────────
  async function loadOAuthProviders() {
    try {
      const d = await getOAuthProviders()
      oauthProviders.value = d.providers ?? []
    } catch {
      /* 静默失败，供应商列表非关键 */
    }
  }
  async function loadApiKeyProviders() {
    try {
      const d = await getApiKeyProviders()
      apiKeyProviders.value = d.providers ?? []
    } catch {
      /* 静默失败 */
    }
  }

  async function handleSave() {
    saving.value = true
    savedOk.value = false
    try {
      const d = await saveModelsConfig(config.value)
      if (d.error) {
        ElMessage.error(d.error)
      } else {
        savedOk.value = true
        ElMessage.success('保存成功')
        setTimeout(() => (savedOk.value = false), 2000)
      }
    } catch (e: unknown) {
      ElMessage.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      saving.value = false
    }
  }

  onMounted(async () => {
    try {
      const d = await getModelsConfig()
      const normalized: ModelsConfig = d.providers ? d : { ...d, providers: {} }
      config.value = normalized
      const keys = Object.keys(normalized.providers ?? {})
      if (keys.length > 0) selection.value = { type: 'provider', name: keys[0] }
    } catch {
      config.value = { providers: {} }
    } finally {
      loading.value = false
    }
    loadOAuthProviders()
    loadApiKeyProviders()
  })
</script>

<style scoped>
  .models-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .toolbar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 14px;
  }

  .title-group {
    display: flex;
    gap: 10px;
    align-items: baseline;
  }

  .title-group h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
  }

  .path {
    font-family: var(--el-font-family-mono, ui-monospace, monospace);
    font-size: 11px;
    color: var(--el-text-color-placeholder);
  }

  .toolbar-actions {
    display: flex;
    gap: 10px;
  }

  .body {
    display: flex;
    flex: 1;
    gap: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--el-bg-color);
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
  }

  .tree-panel {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 230px;
    background: var(--el-fill-color-light);
    border-right: 1px solid var(--el-border-color);
  }

  .tree-scroll {
    flex: 1;
    padding: 8px 6px;
    overflow-y: auto;
  }

  .tree-item {
    display: flex;
    gap: 7px;
    align-items: center;
    padding: 6px 8px;
    font-size: 12px;
    color: var(--el-text-color-primary);
    cursor: pointer;
    border-radius: 5px;
  }

  .tree-item:hover {
    background: var(--el-fill-color);
  }

  .tree-item.active {
    background: var(--el-color-primary-light-9);
  }

  .tree-item.model-row {
    padding-left: 26px;
  }

  .tree-item.add-model {
    padding-left: 26px;
    color: var(--el-text-color-placeholder);
  }

  .tree-item.add-model:hover {
    color: var(--el-color-primary);
  }

  .tree-item .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree-item .label.mono {
    font-family: var(--el-font-family-mono, ui-monospace, monospace);
  }

  .tree-item .label.dim {
    color: var(--el-text-color-secondary);
  }

  .chip-icon {
    flex-shrink: 0;
    color: var(--el-text-color-placeholder);
  }

  .divider {
    margin: 4px 8px;
    border-top: 1px solid var(--el-border-color);
  }

  .provider-group {
    margin-bottom: 2px;
  }

  .t-tag {
    transform: scale(0.85);
  }

  .detail-panel {
    flex: 1;
    min-width: 0;
    padding: 20px;
    overflow-y: auto;
  }

  .detail-form {
    max-width: 560px;
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    font-size: 13px;
    color: var(--el-text-color-placeholder);
  }

  .hint-text {
    padding: 10px 8px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
</style>
