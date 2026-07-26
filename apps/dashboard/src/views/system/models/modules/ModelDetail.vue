<!--
  modules/ModelDetail.vue
  Model 字段编辑 + Test 按钮 + 条件渲染 ThinkingLevelMapEditor + DeepSeek 切换。
  复刻 React ModelsConfig.tsx ModelDetail (lines 504-705)。
-->
<template>
  <div class="model-detail">
    <header class="model-detail__header">
      <h3 class="model-detail__title">Model</h3>
      <div class="model-detail__header-actions">
        <span v-if="statusText" class="model-detail__pill" :class="pillClass">{{
          statusText
        }}</span>
        <ElButton
          size="small"
          :loading="state.phase === 'testing'"
          :disabled="!props.model.id.trim() || state.phase === 'testing'"
          @click="handleTest"
          >{{ state.phase === 'success' ? 'OK' : 'Test' }}</ElButton
        >
        <ElButton size="small" type="danger" plain @click="$emit('delete')">删除</ElButton>
      </div>
    </header>

    <div class="model-detail__grid">
      <div class="model-detail__field">
        <label class="model-detail__label">ID *</label>
        <ElInput
          :model-value="props.model.id"
          placeholder="model-id"
          @update:model-value="(v) => set('id', v ?? '')"
        />
      </div>
      <div class="model-detail__field">
        <label class="model-detail__label">Name</label>
        <ElInput
          :model-value="props.model.name ?? ''"
          placeholder="Display name"
          @update:model-value="(v) => set('name', v || undefined)"
        />
      </div>
    </div>

    <div class="model-detail__field">
      <label class="model-detail__label">API override</label>
      <ElSelect
        :model-value="props.model.api ?? ''"
        clearable
        placeholder="继承 provider"
        @update:model-value="(v) => set('api', v || undefined)"
      >
        <ElOption v-for="opt in API_OPTIONS" :key="opt" :value="opt" :label="opt" />
      </ElSelect>
    </div>

    <div class="model-detail__checks">
      <ElCheckbox
        :model-value="props.model.reasoning ?? false"
        @update:model-value="(v) => set('reasoning', v === true ? true : undefined)"
        >Reasoning / thinking</ElCheckbox
      >
      <ElCheckbox
        :model-value="hasImageInput"
        @update:model-value="(v) => set('input', v === true ? ['text', 'image'] : undefined)"
        >Image input</ElCheckbox
      >
    </div>

    <!-- 仅 reasoning 时显示 -->
    <template v-if="props.model.reasoning">
      <ElCheckbox
        :model-value="hasDeepseekCompat"
        @update:model-value="
          (v) =>
            emit(
              'update',
              v === true
                ? setDeepseekCompat(props.model, true)
                : setDeepseekCompat(props.model, false)
            )
        "
        >DeepSeek thinking compat</ElCheckbox
      >

      <div class="model-detail__sub">
        <div class="model-detail__sub-header">
          <span class="model-detail__sub-title">Thinking level map</span>
          <ElButton
            v-if="props.model.thinkingLevelMap"
            size="small"
            text
            @click="set('thinkingLevelMap', undefined)"
            >清空</ElButton
          >
        </div>
        <ThinkingLevelMapEditor
          :model-value="props.model.thinkingLevelMap"
          @update:model-value="(v) => set('thinkingLevelMap', v)"
        />
      </div>
    </template>

    <div class="model-detail__grid">
      <div class="model-detail__field">
        <label class="model-detail__label">Context window (tokens)</label>
        <ElInput
          :model-value="
            props.model.contextWindow !== undefined ? String(props.model.contextWindow) : ''
          "
          placeholder="128000"
          @update:model-value="(v) => set('contextWindow', v ? Number(v) : undefined)"
        />
      </div>
      <div class="model-detail__field">
        <label class="model-detail__label">Max output tokens</label>
        <ElInput
          :model-value="props.model.maxTokens !== undefined ? String(props.model.maxTokens) : ''"
          placeholder="16384"
          @update:model-value="(v) => set('maxTokens', v ? Number(v) : undefined)"
        />
      </div>
    </div>

    <div class="model-detail__cost">
      <h4 class="model-detail__sub-title">Cost (per million tokens)</h4>
      <div class="model-detail__cost-grid">
        <div v-for="k in COST_KEYS" :key="k" class="model-detail__field">
          <label class="model-detail__label">{{ k }}</label>
          <ElInput
            :model-value="costVal(k)"
            placeholder="0"
            @update:model-value="(v) => setCost(k, v)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import type { ProviderEntryShape, ModelEntryShape } from '@/api/models-config'
  import { testModel } from '@/api/models-config'
  import { API_OPTIONS } from './types'
  import type { TestState } from './types'
  import ThinkingLevelMapEditor from './ThinkingLevelMapEditor.vue'

  const DEEPSEEK_COMPAT = {
    thinkingFormat: 'deepseek',
    requiresReasoningContentOnAssistantMessages: true
  } as const

  function hasDeepseekCompat(model: ModelEntryShape): boolean {
    return model.compat?.thinkingFormat === 'deepseek'
  }

  function setDeepseekCompat(model: ModelEntryShape, enabled: boolean): ModelEntryShape {
    if (enabled) {
      return {
        ...model,
        compat: {
          ...(model.compat ?? {}),
          ...DEEPSEEK_COMPAT
        }
      }
    }
    if (!model.compat) return model
    const rest = { ...model.compat }
    delete rest.thinkingFormat
    delete rest.requiresReasoningContentOnAssistantMessages
    const cleaned = Object.keys(rest).length ? rest : undefined
    return { ...model, compat: cleaned }
  }

  const COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const

  const props = defineProps<{
    providerName: string
    provider: ProviderEntryShape
    model: ModelEntryShape
  }>()
  const emit = defineEmits<{
    update: [m: ModelEntryShape]
    delete: []
  }>()

  const state = ref<TestState>({ phase: 'idle' })

  // 当关键字段变更,重置 test state (跟 React useEffect 一致)
  watch(
    () => [
      props.providerName,
      props.provider.baseUrl ?? '',
      props.provider.api ?? '',
      props.provider.apiKey ?? '',
      props.model.id,
      props.model.api ?? ''
    ],
    () => {
      state.value = { phase: 'idle' }
    }
  )

  // ---------------------------------------------------------------------------
  // Test
  // ---------------------------------------------------------------------------

  const statusText = computed<string | null>(() => {
    const s = state.value
    if (s.phase === 'idle') return null
    if (s.phase === 'testing') return 'Testing…'
    const meta: (string | null)[] = [
      s.latencyMs !== undefined ? `${s.latencyMs}ms` : null,
      s.status !== undefined ? `HTTP ${s.status}` : null
    ]
    const metaStr = meta.filter(Boolean).join(' · ')
    if (s.phase === 'success') {
      return ['Connected', metaStr, s.responseText ?? null].filter(Boolean).join(' · ')
    }
    return ['Failed', metaStr, s.message].filter(Boolean).join(' · ')
  })

  const pillClass = computed(() => {
    const s = state.value
    if (s.phase === 'success') return 'model-detail__pill--ok'
    if (s.phase === 'error') return 'model-detail__pill--err'
    if (s.phase === 'testing') return 'model-detail__pill--busy'
    return ''
  })

  async function handleTest(): Promise<void> {
    if (!props.model.id.trim() || state.value.phase === 'testing') return
    state.value = { phase: 'testing' }
    try {
      const result = await testModel({
        providerName: props.providerName,
        provider: props.provider,
        model: props.model
      })
      if (!result.ok) {
        state.value = {
          phase: 'error',
          message: result.error ?? `HTTP ${result.status}`,
          latencyMs: result.latencyMs,
          status: result.status
        }
        return
      }
      state.value = {
        phase: 'success',
        latencyMs: result.latencyMs,
        status: result.status,
        responseText: result.responseText
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      state.value = {
        phase: 'error',
        message: msg
      }
      ElMessage.error('Test failed: ' + msg)
    }
  }

  // ---------------------------------------------------------------------------
  // Field helpers
  // ---------------------------------------------------------------------------

  function set<K extends keyof ModelEntryShape>(key: K, value: ModelEntryShape[K]): void {
    emit('update', { ...props.model, [key]: value })
  }

  const hasImageInput = computed(() => (props.model.input ?? []).includes('image'))

  function costVal(k: (typeof COST_KEYS)[number]): string {
    const v = props.model.cost?.[k]
    return v !== undefined && v !== null ? String(v) : ''
  }

  function setCost(k: (typeof COST_KEYS)[number], v: string): void {
    const n = Number(v)
    const nextCost: ModelEntryShape['cost'] = {
      ...(props.model.cost ?? {}),
      [k]: v === '' || Number.isNaN(n) ? undefined : n
    } as ModelEntryShape['cost']
    emit('update', { ...props.model, cost: nextCost })
  }
</script>

<style lang="scss" scoped>
  .model-detail {
    display: flex;
    flex-direction: column;
    gap: 14px;

    &__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    &__title {
      font-size: 13px;
      font-weight: 600;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--el-text-color-secondary);
    }
    &__header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    &__pill {
      max-width: 260px;
      height: 24px;
      line-height: 22px;
      padding: 0 8px;
      font-size: 11px;
      border-radius: 4px;
      border: 1px solid var(--el-border-color);
      background: var(--el-fill-color);
      color: var(--el-text-color-regular);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      &--ok {
        background: #dcfce7;
        border-color: #bbf7d0;
        color: #111827;
      }
      &--err {
        background: #fee2e2;
        border-color: #fecaca;
        color: #111827;
      }
      &--busy {
        background: var(--el-fill-color);
      }
    }
    &__grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 14px;
    }
    &__field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    &__label {
      font-size: 11px;
      color: var(--el-text-color-secondary);
      font-weight: 500;
    }
    &__checks {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
    }
    &__sub {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    &__sub-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    &__sub-title {
      margin: 0;
      font-size: 11px;
      font-weight: 600;
      color: var(--el-text-color-secondary);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    &__cost {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    &__cost-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }
  }
</style>
