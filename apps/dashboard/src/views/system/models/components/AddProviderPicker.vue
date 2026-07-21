<template>
  <ElDialog
    v-model="visible"
    title="添加供应商"
    width="520px"
    :close-on-click-modal="false"
    append-to-body
  >
    <div class="picker">
      <!-- 自定义供应商 -->
      <div class="picker-section">
        <div class="section-title">自定义供应商</div>
        <button class="custom-opt" @click="addCustom">
          <ElIcon><Plus /></ElIcon>
          <span>新建自定义供应商</span>
        </button>
      </div>

      <!-- API Key 供应商 -->
      <div v-if="apiKeyProviders.length" class="picker-section">
        <div class="section-title">API Key 供应商</div>
        <div class="grid">
          <button
            v-for="p in apiKeyProviders"
            :key="p.id"
            class="prov"
            :class="{ active: p.configured }"
            @click="emit('select-apikey', p.id)"
          >
            <ProviderIcon :id="p.id" :size="28" />
            <span class="name">{{ p.displayName }}</span>
          </button>
        </div>
      </div>

      <!-- OAuth 供应商 -->
      <div v-if="oauthProviders.length" class="picker-section">
        <div class="section-title">订阅登录</div>
        <div class="grid">
          <button
            v-for="p in oauthProviders"
            :key="p.id"
            class="prov"
            :class="{ active: p.loggedIn }"
            @click="emit('select-oauth', p.id)"
          >
            <ProviderIcon :id="p.id" :size="28" />
            <span class="name">{{ p.name }}</span>
          </button>
        </div>
      </div>
    </div>
  </ElDialog>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { Plus } from '@element-plus/icons-vue'
  import ProviderIcon from './ProviderIcon.vue'
  import type { ApiKeyProvider, OAuthProvider } from '@/api/models-config'

  const props = defineProps<{
    modelValue: boolean
    oauthProviders: OAuthProvider[]
    apiKeyProviders: ApiKeyProvider[]
  }>()
  const emit = defineEmits<{
    'update:modelValue': [v: boolean]
    'add-custom': []
    'select-oauth': [id: string]
    'select-apikey': [id: string]
  }>()

  const visible = computed({
    get: () => props.modelValue,
    set: (v) => emit('update:modelValue', v)
  })

  function addCustom() {
    emit('add-custom')
    visible.value = false
  }
</script>

<style scoped>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .picker-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
  }

  .prov {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    padding: 12px 8px;
    cursor: pointer;
    background: var(--el-bg-color);
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    transition: border-color 0.15s;
  }

  .prov:hover {
    border-color: var(--el-color-primary);
  }

  .prov.active {
    border-color: #4ade80;
  }

  .prov .name {
    max-width: 100%;
    overflow: hidden;
    font-size: 12px;
    color: var(--el-text-color-primary);
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .custom-opt {
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 14px;
    font-size: 13px;
    color: var(--el-text-color-regular);
    cursor: pointer;
    background: var(--el-fill-color-light);
    border: 1px dashed var(--el-border-color);
    border-radius: 8px;
  }

  .custom-opt:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
  }
</style>
