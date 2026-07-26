<!--
  modules/ProviderTree.vue
  左树:OAuth(已登录)+ API-Key(已配置) + Custom 三段。 emit select* / add-model 事件。 不带内嵌
  "Add provider"(由父级 index.vue 顶部按钮控制)。

  Section 一律展示只读行。 Custom 段每个 provider 节点下方有 "+ model" 一行,点击 emit
  add-model 事件。 父级 index.vue 收到后在 config.providers[name].models 末尾 push
  `{id:""}` 占位项并自动选中它,定位到右侧 ModelDetail 让用户立刻可填。
-->
<template>
  <div class="provider-tree">
    <!-- OAuth subscriptions (logged in) -->
    <div
      v-for="p in oauthProviders"
      :key="`oauth-${p.id}`"
      class="provider-tree__row"
      :class="{ 'is-selected': isOAuthSelected(p.id) }"
      @click="$emit('select-oauth', p.id)"
    >
      <ProviderIcon :id="p.id" :size="16" />
      <span class="provider-tree__name">{{ p.name }}</span>
      <ElTag size="small" type="success" effect="plain">OAuth</ElTag>
    </div>

    <!-- API-Key providers (configured) -->
    <div
      v-for="p in apiKeyProviders"
      :key="`apikey-${p.id}`"
      class="provider-tree__row"
      :class="{ 'is-selected': isApiKeySelected(p.id) }"
      @click="$emit('select-apikey', p.id)"
    >
      <ProviderIcon :id="p.id" :size="16" />
      <span class="provider-tree__name">{{ p.displayName }}</span>
      <ElTag size="small" type="warning" effect="plain">Key</ElTag>
    </div>

    <div v-if="hasManaged && hasCustom" class="provider-tree__divider" />

    <!-- Custom providers -->
    <template v-if="Object.keys(config.providers ?? {}).length > 0">
      <div
        v-for="[name, provider] in customEntries"
        :key="`provider-${name}`"
        class="provider-tree__provider-block"
      >
        <div
          class="provider-tree__row provider-tree__row--provider"
          :class="{ 'is-selected': isProviderSelected(name) }"
          @click="$emit('select-provider', name)"
        >
          <span class="provider-tree__provider-dot" />
          <span class="provider-tree__name provider-tree__name--mono">{{ name }}</span>
        </div>

        <!-- Models under provider -->
        <div
          v-for="(m, i) in provider.models ?? []"
          :key="`model-${name}-${i}-${m.id || 'empty'}`"
          class="provider-tree__row provider-tree__row--model"
          :class="{ 'is-selected': isModelSelected(name, m.id || '') }"
          @click="$emit('select-model', name, m.id || '')"
        >
          <span class="provider-tree__model-name">{{ m.id || 'new model' }}</span>
          <ElTag v-if="m.reasoning" size="small" effect="plain" type="primary">T</ElTag>
        </div>

        <!-- Add model (对齐 apps/web ModelsConfig.tsx 左栏 "+ model" 行) -->
        <div
          class="provider-tree__row provider-tree__row--add"
          @click.stop="$emit('add-model', name)"
        >
          <span class="provider-tree__add-text">+ model</span>
        </div>
      </div>
    </template>
    <div v-else class="provider-tree__empty">暂无自定义提供方</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import type {
    ModelsConfigShape,
    OAuthProviderShape,
    ApiKeyProviderShape,
    ProviderEntryShape
  } from '@/api/models-config'
  import type { Selection } from './types'
  import ProviderIcon from './icons'

  defineOptions({ name: 'ProviderTree' })

  const props = defineProps<{
    oauthProviders: OAuthProviderShape[]
    apiKeyProviders: ApiKeyProviderShape[]
    config: ModelsConfigShape
    selection: Selection
  }>()

  defineEmits<{
    'select-oauth': [providerId: string]
    'select-apikey': [providerId: string]
    'select-provider': [name: string]
    'select-model': [name: string, modelId: string]
    'add-model': [name: string]
  }>()

  const customEntries = computed<[string, ProviderEntryShape][]>(() => {
    const providers = props.config.providers ?? {}
    return Object.entries(providers).sort(([a], [b]) => a.localeCompare(b))
  })

  const hasManaged = computed(
    () => props.oauthProviders.length > 0 || props.apiKeyProviders.length > 0
  )
  const hasCustom = computed(() => Object.keys(props.config.providers ?? {}).length > 0)

  function isOAuthSelected(id: string): boolean {
    return props.selection.kind === 'oauth' && props.selection.providerId === id
  }
  function isApiKeySelected(id: string): boolean {
    return props.selection.kind === 'apikey' && props.selection.providerId === id
  }
  function isProviderSelected(name: string): boolean {
    return props.selection.kind === 'provider' && props.selection.name === name
  }
  function isModelSelected(name: string, modelId: string): boolean {
    return (
      props.selection.kind === 'model' &&
      props.selection.name === name &&
      props.selection.modelId === modelId
    )
  }
</script>

<style lang="scss" scoped>
  .provider-tree {
    padding: 6px 0;

    &__divider {
      margin: 8px 8px 4px;
      border-top: 1px solid var(--el-border-color-light, var(--el-border-color-lighter));
    }

    &__row {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 6px 10px;
      border-radius: 4px;
      cursor: pointer;
      color: var(--el-text-color-regular);
      font-size: 13px;

      &:hover:not(.is-selected) {
        background: var(--el-fill-color-light);
      }
      &.is-selected {
        background: var(--el-color-primary-light-9);
        color: var(--el-color-primary);
        font-weight: 600;
      }

      &--provider {
        margin-top: 4px;
      }
      &--model {
        padding-left: 28px;
      }
      &--add {
        padding-left: 28px;
        color: var(--el-text-color-placeholder);
        cursor: pointer;
        font-size: 11px;
        &:hover {
          color: var(--el-color-primary);
          background: var(--el-fill-color-light);
        }
      }
    }
    &__add-text {
      font-size: 11px;
    }

    &__provider-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--el-text-color-placeholder);
      flex-shrink: 0;
    }
    &__name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      &--mono {
        font-family: var(--el-font-family-monospace, monospace);
        font-size: 12px;
      }
    }
    &__model-name {
      flex: 1;
      font-family: var(--el-font-family-monospace, monospace);
      font-size: 12px;
      color: var(--el-text-color-regular);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    &__empty {
      padding: 10px 12px;
      font-size: 12px;
      color: var(--el-text-color-placeholder);
    }

    &__provider-block {
      margin-bottom: 2px;
    }
  }
</style>
