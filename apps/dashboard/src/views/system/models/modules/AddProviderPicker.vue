<!--
  modules/AddProviderPicker.vue
  v-model 控制的 ElDialog。 内部 search + 三类卡片网格: OAuth/API-Key/Custom。
  每张卡 emit pick{Type} 事件给父级,父级 index.vue 负责根据 pick 类型切换 selection。
-->
<template>
  <ElDialog
    :model-value="props.visible"
    title="添加提供方"
    width="720"
    @update:model-value="(v) => emit('update:visible', v)"
  >
    <ElInput v-model="query" placeholder="搜索提供方…" clearable class="add-picker__search">
      <template #prefix>
        <ElIcon><Search /></ElIcon>
      </template>
    </ElInput>

    <div v-if="totalCount === 0" class="add-picker__empty">无匹配提供方</div>

    <ElScrollbar v-else max-height="60vh">
      <!-- Custom provider (只有一张) -->
      <div class="add-picker__section-title add-picker__section-title--custom"> Custom </div>
      <button v-if="showCustom" type="button" class="add-picker__card" @click="onPickCustom">
        <div class="add-picker__card-main">
          <div class="add-picker__card-name">OpenAI / Anthropic compatible</div>
          <div class="add-picker__card-hint">自定义端点格式</div>
        </div>
        <span class="add-picker__card-icon add-picker__card-icon--dashed">
          <ElIcon><Plus /></ElIcon>
        </span>
      </button>

      <!-- OAuth providers -->
      <template v-if="availableOAuth.length > 0">
        <div class="add-picker__section-title">OAuth Subscriptions</div>
        <button
          v-for="p in availableOAuth"
          :key="p.id"
          type="button"
          class="add-picker__card"
          @click="onPickOAuth(p.id)"
        >
          <div class="add-picker__card-main">
            <div class="add-picker__card-name">{{ p.name }}</div>
            <div class="add-picker__card-hint">OAuth</div>
          </div>
          <ProviderIcon :id="p.id" :size="28" />
        </button>
      </template>

      <!-- API-Key providers -->
      <template v-if="availableApiKey.length > 0">
        <div class="add-picker__section-title">API Key</div>
        <button
          v-for="p in availableApiKey"
          :key="p.id"
          type="button"
          class="add-picker__card"
          @click="onPickApiKey(p.id)"
        >
          <div class="add-picker__card-main">
            <div class="add-picker__card-name">{{ p.displayName }}</div>
            <div class="add-picker__card-hint">{{ p.modelCount }} models</div>
          </div>
          <ProviderIcon :id="p.id" :size="28" />
        </button>
      </template>
    </ElScrollbar>
  </ElDialog>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { Search, Plus } from '@element-plus/icons-vue'
  import type { OAuthProviderShape, ApiKeyProviderShape } from '@/api/models-config'
  import ProviderIcon from './icons'

  const props = defineProps<{
    visible: boolean
    oauthProviders: OAuthProviderShape[]
    apiKeyProviders: ApiKeyProviderShape[]
  }>()

  const emit = defineEmits<{
    'update:visible': [v: boolean]
    'pick-oauth': [providerId: string]
    'pick-apikey': [providerId: string]
    'pick-custom': []
  }>()

  const query = ref('')

  watch(
    () => props.visible,
    (v) => {
      if (v) query.value = ''
    }
  )

  const q = computed(() => query.value.trim().toLowerCase())

  const availableOAuth = computed(() =>
    props.oauthProviders
      .filter((p) => !p.loggedIn)
      .filter((p) => !q.value || p.name.toLowerCase().includes(q.value))
  )

  const availableApiKey = computed(() =>
    props.apiKeyProviders
      .filter((p) => !p.configured)
      .filter(
        (p) =>
          !q.value ||
          p.displayName.toLowerCase().includes(q.value) ||
          p.id.toLowerCase().includes(q.value)
      )
  )

  const showCustom = computed(
    () =>
      !q.value ||
      'custom'.includes(q.value) ||
      'openai-compatible'.includes(q.value) ||
      'anthropic-compatible'.includes(q.value)
  )

  const totalCount = computed(
    () => availableOAuth.value.length + availableApiKey.value.length + (showCustom.value ? 1 : 0)
  )

  function onPickOAuth(id: string): void {
    emit('pick-oauth', id)
    emit('update:visible', false)
  }
  function onPickApiKey(id: string): void {
    emit('pick-apikey', id)
    emit('update:visible', false)
  }
  function onPickCustom(): void {
    emit('pick-custom')
    emit('update:visible', false)
  }
</script>

<style lang="scss" scoped>
  .add-picker {
    &__search {
      margin-bottom: 12px;
    }
    &__empty {
      padding: 20px;
      font-size: 12px;
      text-align: center;
      color: var(--el-text-color-placeholder);
    }

    &__section-title {
      margin: 8px 0 4px;
      font-size: 10px;
      font-weight: 600;
      color: var(--el-text-color-secondary);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      &--custom {
        margin-top: 0;
      }
    }

    &__card {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 12px;
      margin-bottom: 8px;
      background: var(--el-fill-color-blank);
      border: 1px solid var(--el-border-color-light, var(--el-border-color-lighter));
      border-radius: 7px;
      cursor: pointer;
      text-align: left;
      transition:
        border-color 0.12s,
        background 0.12s;

      &:hover {
        border-color: var(--el-color-primary);
        background: var(--el-color-primary-light-9);
      }
    }
    &__card-main {
      flex: 1;
      min-width: 0;
    }
    &__card-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--el-text-color-primary);
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    &__card-hint {
      font-size: 11px;
      color: var(--el-text-color-placeholder);
      margin-top: 2px;
    }
    &__card-icon {
      width: 28px;
      height: 28px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      &--dashed {
        background: var(--el-fill-color);
        border: 1px dashed var(--el-border-color);
        color: var(--el-text-color-secondary);
      }
    }
  }
</style>
