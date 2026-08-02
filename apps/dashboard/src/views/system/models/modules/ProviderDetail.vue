<!--
  modules/ProviderDetail.vue
  Custom provider 编辑面板: name + Rename + baseUrl + apiKey (show/hide) + api + headers + Delete.
-->
<template>
  <div class="provider-detail">
    <header class="provider-detail__header">
      <h3 class="provider-detail__title">Provider</h3>
      <ElButton type="danger" size="small" plain @click="$emit('delete')">删除</ElButton>
    </header>

    <div class="provider-detail__grid">
      <div class="provider-detail__field">
        <label class="provider-detail__label">Provider name</label>
        <ElInput v-model="editingName" placeholder="provider-name" />
        <ElButton
          v-if="editingName !== props.name && editingName.trim()"
          size="small"
          type="primary"
          plain
          class="provider-detail__rename"
          @click="commitRename"
          >重命名</ElButton
        >
      </div>

      <div class="provider-detail__field">
        <label class="provider-detail__label">Base URL</label>
        <ElInput
          :model-value="props.provider.baseUrl ?? ''"
          placeholder="https://api.example.com/v1"
          @update:model-value="(v) => set('baseUrl', v || undefined)"
        />
      </div>

      <div class="provider-detail__field">
        <label class="provider-detail__label">API Key</label>
        <ElInput
          :model-value="props.provider.apiKey ?? ''"
          type="password"
          show-password
          placeholder="ENV_VAR_NAME, !shell-command, or literal key"
          @update:model-value="(v) => set('apiKey', v || undefined)"
        />
        <p class="provider-detail__hint"> 前缀 <code>!</code> 运行 shell 命令,或写 env var 名字 </p>
      </div>

      <div class="provider-detail__field">
        <label class="provider-detail__label">API</label>
        <ElSelect
          :model-value="props.provider.api ?? ''"
          @update:model-value="(v) => set('api', v)"
        >
          <ElOption v-for="opt in API_OPTIONS" :key="opt" :value="opt" :label="opt" />
        </ElSelect>
      </div>

      <div class="provider-detail__field provider-detail__field--full">
        <label class="provider-detail__label">Headers</label>
        <HeadersEditor
          :model-value="props.provider.headers ?? {}"
          @update:model-value="(v) => set('headers', Object.keys(v).length ? v : undefined)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import type { ProviderEntryShape } from '@/api/models-config'
  import { API_OPTIONS } from './types'
  import HeadersEditor from './HeadersEditor.vue'

  const props = defineProps<{
    name: string
    provider: ProviderEntryShape
  }>()

  const emit = defineEmits<{
    update: [p: ProviderEntryShape]
    rename: [newName: string]
    delete: []
  }>()

  const editingName = ref(props.name)
  watch(
    () => props.name,
    (v) => (editingName.value = v)
  )

  watch(
    () => props.provider.api,
    (v) => {
      if (!v) emit('update', { ...props.provider, api: 'openai-completions' })
    },
    { immediate: true }
  )

  function set<K extends keyof ProviderEntryShape>(key: K, value: ProviderEntryShape[K]): void {
    emit('update', { ...props.provider, [key]: value })
  }

  function commitRename(): void {
    const next = editingName.value.trim()
    if (!next) {
      ElMessage.warning('名称不能为空')
      return
    }
    if (next === props.name) return
    emit('rename', next)
  }
</script>

<style lang="scss" scoped>
  .provider-detail {
    &__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    &__title {
      font-size: 13px;
      font-weight: 600;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--el-text-color-secondary);
    }
    &__grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px 16px;
    }
    &__field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      &--full {
        grid-column: 1 / -1;
      }
    }
    &__label {
      font-size: 11px;
      color: var(--el-text-color-secondary);
      font-weight: 500;
    }
    &__hint {
      margin: 2px 0 0;
      font-size: 11px;
      color: var(--el-text-color-placeholder);
      code {
        font-family: var(--el-font-family-monospace, monospace);
      }
    }
    &__rename {
      align-self: flex-start;
      margin-top: 4px;
    }
  }
</style>
