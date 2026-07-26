<!--
  modules/ApiKeyDetail.vue
  API-Key 提供方的密钥输入/保存/断开。 与 React ModelsConfig.tsx ApiKeyDetail 对齐。
-->
<template>
  <div class="apikey-detail">
    <header class="apikey-detail__header">
      <h3 class="apikey-detail__title">{{ provider.displayName }} · API Key</h3>
      <div class="apikey-detail__status">
        <span
          class="apikey-detail__dot"
          :style="{ background: provider.configured ? '#4ade80' : 'var(--el-border-color)' }"
        />
        <span :class="provider.configured ? 'apikey-detail__ok' : 'apikey-detail__muted'">
          {{ provider.configured ? '已配置' : '未配置' }}
        </span>
      </div>
    </header>

    <p class="apikey-detail__msg">
      <template v-if="provider.configured">
        API Key 已存储。 重新输入可替换;或点击下方"断开"移除。
      </template>
      <template v-else>
        请输入 <strong>{{ provider.displayName }}</strong> API Key 以启用
        {{ provider.modelCount }} 个模型。
      </template>
    </p>

    <ElInput
      v-model="keyDraft"
      type="password"
      show-password
      :placeholder="provider.configured ? '输入新 key 替换…' : 'sk-…'"
      class="apikey-detail__input"
    >
      <template #append>
        <ElButton
          type="primary"
          :loading="saving"
          :disabled="!keyDraft.trim()"
          @click="handleSave"
          >{{ saving ? '保存中…' : '保存' }}</ElButton
        >
      </template>
    </ElInput>

    <p v-if="errorMsg" class="apikey-detail__err">{{ errorMsg }}</p>

    <ElButton
      v-if="provider.configured"
      type="danger"
      plain
      :loading="removing"
      class="apikey-detail__disconnect"
      @click="handleRemove"
      >{{ removing ? '断开中…' : '断开' }}</ElButton
    >
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import type { ApiKeyProviderShape } from '@/api/models-config'
  import { saveApiKey, deleteApiKey } from '@/api/models-config'

  const props = defineProps<{
    provider: ApiKeyProviderShape
  }>()
  const emit = defineEmits<{ refresh: [] }>()

  const keyDraft = ref('')
  const saving = ref(false)
  const removing = ref(false)
  const errorMsg = ref<string | null>(null)

  async function handleSave(): Promise<void> {
    const v = keyDraft.value.trim()
    if (!v) return
    errorMsg.value = null
    saving.value = true
    try {
      await saveApiKey(props.provider.id, v)
      keyDraft.value = ''
      ElMessage.success('已保存')
      emit('refresh')
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : String(e)
    } finally {
      saving.value = false
    }
  }

  async function handleRemove(): Promise<void> {
    try {
      await ElMessageBox.confirm(
        `确定要断开 ${props.provider.displayName} 吗?已配置的 key 会被移除。`,
        '提示',
        { type: 'warning', confirmButtonText: '断开', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
    removing.value = true
    errorMsg.value = null
    try {
      await deleteApiKey(props.provider.id)
      ElMessage.success('已断开')
      emit('refresh')
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : String(e)
    } finally {
      removing.value = false
    }
  }
</script>

<style lang="scss" scoped>
  .apikey-detail {
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
    &__status {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    &__dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
    }
    &__ok {
      font-size: 11px;
      color: #4ade80;
    }
    &__muted {
      font-size: 11px;
      color: var(--el-text-color-placeholder);
    }
    &__msg {
      margin: 0 0 12px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--el-text-color-regular);
    }
    &__input {
      margin-bottom: 8px;
    }
    &__err {
      color: var(--el-color-danger);
      font-size: 12px;
      margin: 0 0 8px;
    }
    &__disconnect {
      margin-top: 12px;
    }
  }
</style>
