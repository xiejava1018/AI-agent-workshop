<template>
  <div class="detail">
    <div class="detail-head">
      <span class="section-title">API Key</span>
      <div class="status">
        <span class="dot" :class="{ on: provider.configured }" />
        <span :class="{ ok: provider.configured }">{{
          provider.configured ? '已配置' : '未配置'
        }}</span>
      </div>
    </div>

    <p class="desc">
      {{
        provider.configured
          ? '已存储 API Key。在下方输入新 Key 可替换，或断开以删除。'
          : `输入 ${provider.displayName} 的 API Key 以启用 ${provider.modelCount} 个模型。`
      }}
    </p>

    <ElFormItem label="API Key">
      <div class="key-row">
        <ElInput
          v-model="apiKey"
          type="password"
          show-password
          :placeholder="provider.configured ? '输入新 Key 以替换…' : 'sk-…'"
          class="font-mono"
          autocomplete="off"
          @keydown.enter="handleSave"
        />
        <ElButton type="primary" :loading="saving" :disabled="!apiKey.trim()" @click="handleSave">
          {{ savedOk ? '已保存' : '保存' }}
        </ElButton>
      </div>
    </ElFormItem>

    <p v-if="error" class="err">{{ error }}</p>

    <ElButton
      v-if="provider.configured"
      plain
      class="danger-btn"
      :loading="removing"
      @click="handleRemove"
    >
      {{ removing ? '断开中…' : '断开' }}
    </ElButton>
  </div>
</template>

<script setup lang="ts">
  import { ref, watch } from 'vue'
  import { setApiKey, deleteApiKey, type ApiKeyProvider } from '@/api/models-config'

  const props = defineProps<{ provider: ApiKeyProvider }>()
  const emit = defineEmits<{ refresh: [] }>()

  const apiKey = ref('')
  const saving = ref(false)
  const removing = ref(false)
  const error = ref<string | null>(null)
  const savedOk = ref(false)

  watch(
    () => props.provider.id,
    () => {
      apiKey.value = ''
      error.value = null
      savedOk.value = false
    }
  )

  async function handleSave() {
    if (!apiKey.value.trim()) return
    saving.value = true
    error.value = null
    savedOk.value = false
    try {
      const d = await setApiKey(props.provider.id, apiKey.value.trim())
      if (d.error) {
        error.value = d.error
      } else {
        apiKey.value = ''
        savedOk.value = true
        setTimeout(() => (savedOk.value = false), 2000)
        emit('refresh')
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      saving.value = false
    }
  }

  async function handleRemove() {
    removing.value = true
    error.value = null
    try {
      const d = await deleteApiKey(props.provider.id)
      if (d.error) error.value = d.error
      else emit('refresh')
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      removing.value = false
    }
  }
</script>

<style scoped>
  .detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .detail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .status {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 11px;
    color: var(--el-text-color-placeholder);
  }

  .status .ok {
    color: #4ade80;
  }

  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    background: var(--el-border-color);
    border-radius: 50%;
  }

  .dot.on {
    background: #4ade80;
  }

  .desc {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-text-color-regular);
  }

  .key-row {
    display: flex;
    gap: 6px;
    width: 100%;
  }

  .key-row .el-input {
    flex: 1;
  }

  .err {
    margin: 0;
    font-size: 12px;
    color: var(--el-color-danger);
  }

  .font-mono :deep(input) {
    font-family: var(--el-font-family-mono, ui-monospace, monospace);
  }

  .danger-btn {
    align-self: flex-start;
    color: var(--el-color-danger);
    border-color: var(--el-color-danger-light-5);
  }

  .danger-btn:hover {
    background: var(--el-color-danger-light-9);
  }
</style>
