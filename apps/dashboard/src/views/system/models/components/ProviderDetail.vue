<template>
  <div class="detail">
    <div class="detail-head">
      <span class="section-title">供应商</span>
      <ElButton size="small" plain class="danger-btn" @click="emit('delete')">删除</ElButton>
    </div>

    <ElFormItem label="供应商名称">
      <ElInput v-model="editingName" placeholder="provider-name" class="font-mono" />
      <div v-if="editingName !== name && editingName.trim()" class="rename-row">
        <ElButton size="small" type="primary" @click="emit('rename', editingName.trim())"
          >重命名</ElButton
        >
      </div>
    </ElFormItem>

    <ElFormItem label="Base URL">
      <ElInput v-model="baseUrl" placeholder="https://api.example.com/v1" class="font-mono" />
    </ElFormItem>

    <ElFormItem label="API Key">
      <ElInput
        v-model="apiKey"
        type="password"
        show-password
        placeholder="ENV_VAR_NAME、!shell-command 或字面量密钥"
        class="font-mono"
        autocomplete="off"
      />
      <div class="hint"> 以 <code>!</code> 前缀执行 shell 命令，或直接填写环境变量名 </div>
    </ElFormItem>

    <ElFormItem label="API">
      <ElSelect v-model="api" style="width: 100%">
        <ElOption v-for="o in API_OPTIONS" :key="o" :label="o" :value="o" />
      </ElSelect>
    </ElFormItem>
  </div>
</template>

<script setup lang="ts">
  import { ref, watch } from 'vue'
  import type { ProviderEntry } from '@/api/models-config'
  import { API_OPTIONS } from '@/api/models-config'

  const props = defineProps<{ name: string; provider: ProviderEntry }>()
  const emit = defineEmits<{
    change: [provider: ProviderEntry]
    rename: [name: string]
    delete: []
  }>()

  const editingName = ref(props.name)
  const baseUrl = ref(props.provider.baseUrl ?? '')
  const apiKey = ref(props.provider.apiKey ?? '')
  const api = ref(props.provider.api ?? 'openai-completions')

  watch(
    () => props.name,
    (v) => (editingName.value = v)
  )

  // 同步父级外部变更（如保存后重载）
  watch(
    () => props.provider,
    (p) => {
      baseUrl.value = p.baseUrl ?? ''
      apiKey.value = p.apiKey ?? ''
      api.value = p.api ?? 'openai-completions'
    }
  )

  function emitChange() {
    emit('change', {
      ...props.provider,
      baseUrl: baseUrl.value || undefined,
      apiKey: apiKey.value || undefined,
      api: api.value || 'openai-completions'
    })
  }

  watch([baseUrl, apiKey, api], emitChange)
</script>

<style scoped>
  .detail {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .detail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .rename-row {
    margin-top: 6px;
  }

  .hint {
    margin-top: 2px;
    font-size: 11px;
    color: var(--el-text-color-placeholder);
  }

  .font-mono :deep(input) {
    font-family: var(--el-font-family-mono, ui-monospace, monospace);
  }

  .danger-btn {
    color: var(--el-color-danger);
    border-color: var(--el-color-danger-light-5);
  }

  .danger-btn:hover {
    background: var(--el-color-danger-light-9);
  }
</style>
