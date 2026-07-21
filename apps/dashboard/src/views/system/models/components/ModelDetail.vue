<template>
  <div class="detail">
    <div class="detail-head">
      <span class="section-title">模型</span>
      <div class="head-actions">
        <ElTag
          v-if="testSummary"
          :type="testTagType"
          size="small"
          effect="light"
          class="test-tag"
          :title="testSummary"
        >
          {{ testSummary }}
        </ElTag>
        <ElButton
          size="small"
          :type="testState.phase === 'success' ? 'success' : 'default'"
          :loading="testState.phase === 'testing'"
          :disabled="!model.id.trim() || testState.phase === 'testing'"
          @click="handleTest"
          >测试</ElButton
        >
        <ElButton size="small" plain class="danger-btn" @click="emit('delete')">移除</ElButton>
      </div>
    </div>

    <ElFormItem label="ID" required>
      <ElInput v-model="id" placeholder="model-id" class="font-mono" />
    </ElFormItem>
    <ElFormItem label="名称">
      <ElInput v-model="name" placeholder="显示名称" />
    </ElFormItem>
    <ElFormItem label="API 覆盖">
      <ElSelect v-model="api" clearable placeholder="— 继承 / 无 —" style="width: 100%">
        <ElOption v-for="o in API_OPTIONS" :key="o" :label="o" :value="o" />
      </ElSelect>
    </ElFormItem>

    <div class="checks">
      <ElCheckbox v-model="reasoning">推理 / 思考</ElCheckbox>
      <ElCheckbox v-model="imageInput">图片输入</ElCheckbox>
    </div>

    <template v-if="reasoning">
      <ElCheckbox v-model="deepseekCompat">DeepSeek 思考兼容</ElCheckbox>
      <div class="level-block">
        <div class="level-head">
          <span class="section-title">思考等级映射</span>
          <ElButton
            v-if="model.thinkingLevelMap"
            link
            size="small"
            type="info"
            @click="thinkingLevelMap = undefined"
            >全部清除</ElButton
          >
        </div>
        <ThinkingLevelMapEditor
          :value="model.thinkingLevelMap"
          @change="(v) => (thinkingLevelMap = v)"
        />
      </div>
    </template>

    <ElFormItem label="上下文窗口 (tokens)">
      <ElInputNumber
        v-model="contextWindow"
        :min="0"
        :controls="false"
        placeholder="128000"
        class="full-width"
      />
    </ElFormItem>
    <ElFormItem label="最大输出 tokens">
      <ElInputNumber
        v-model="maxTokens"
        :min="0"
        :controls="false"
        placeholder="16384"
        class="full-width"
      />
    </ElFormItem>

    <div class="section-title cost-title">单价（每百万 tokens）</div>
    <div class="cost-grid">
      <ElFormItem v-for="k in COST_KEYS" :key="k" :label="COST_LABELS[k]">
        <ElInputNumber
          :model-value="costVal(k)"
          :controls="false"
          :min="0"
          placeholder="0"
          class="full-width"
          @update:model-value="(v) => setCost(k, v)"
        />
      </ElFormItem>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import {
    API_OPTIONS,
    testModel,
    hasDeepseekCompat,
    setDeepseekCompat,
    type ModelEntry,
    type ProviderEntry
  } from '@/api/models-config'
  import ThinkingLevelMapEditor from './ThinkingLevelMapEditor.vue'

  const props = defineProps<{
    providerName: string
    provider: ProviderEntry
    model: ModelEntry
  }>()
  const emit = defineEmits<{
    change: [model: ModelEntry]
    delete: []
  }>()

  const COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
  type CostKey = (typeof COST_KEYS)[number]
  const COST_LABELS: Record<CostKey, string> = {
    input: '输入',
    output: '输出',
    cacheRead: '缓存读',
    cacheWrite: '缓存写'
  }

  type TestState =
    | { phase: 'idle' }
    | { phase: 'testing' }
    | { phase: 'success'; latencyMs?: number; status?: number; responseText?: string }
    | { phase: 'error'; message: string; latencyMs?: number; status?: number }

  const id = ref(props.model.id ?? '')
  const name = ref(props.model.name ?? '')
  const api = ref(props.model.api ?? '')
  const reasoning = ref(props.model.reasoning ?? false)
  const imageInput = ref(props.model.input?.includes('image') ?? false)
  const contextWindow = ref<number | undefined>(props.model.contextWindow)
  const maxTokens = ref<number | undefined>(props.model.maxTokens)
  const thinkingLevelMap = ref<Record<string, string | null> | undefined>(
    props.model.thinkingLevelMap
  )

  const testState = ref<TestState>({ phase: 'idle' })

  watch(
    () => props.model,
    (m) => {
      id.value = m.id ?? ''
      name.value = m.name ?? ''
      api.value = m.api ?? ''
      reasoning.value = m.reasoning ?? false
      imageInput.value = m.input?.includes('image') ?? false
      contextWindow.value = m.contextWindow
      maxTokens.value = m.maxTokens
      thinkingLevelMap.value = m.thinkingLevelMap
    }
  )

  function emitChange() {
    const next: ModelEntry = {
      ...props.model,
      id: id.value,
      name: name.value || undefined,
      api: api.value || undefined,
      reasoning: reasoning.value || undefined,
      input: imageInput.value ? ['text', 'image'] : undefined,
      contextWindow: contextWindow.value,
      maxTokens: maxTokens.value,
      thinkingLevelMap: thinkingLevelMap.value
    }
    emit('change', next)
  }

  const deepseekCompat = ref(hasDeepseekCompat(props.model))
  watch(
    () => hasDeepseekCompat(props.model),
    (v) => (deepseekCompat.value = v)
  )
  watch(deepseekCompat, (v) => emit('change', setDeepseekCompat(props.model, v)))

  watch(
    [id, name, api, reasoning, imageInput, contextWindow, maxTokens, thinkingLevelMap],
    emitChange
  )

  watch(
    () => [
      props.providerName,
      props.provider.baseUrl,
      props.provider.api,
      props.provider.apiKey,
      props.model.id,
      props.model.api
    ],
    () => (testState.value = { phase: 'idle' })
  )

  function costVal(k: CostKey): number | undefined {
    return props.model.cost?.[k]
  }
  function setCost(k: CostKey, v: number | undefined) {
    emit('change', { ...props.model, cost: { ...(props.model.cost ?? {}), [k]: v } })
  }

  const testSummary = computed(() => {
    const s = testState.value
    if (s.phase === 'idle') return ''
    if (s.phase === 'testing') return '正在测试模型连接…'
    const meta = [
      s.latencyMs !== undefined ? `${s.latencyMs}ms` : null,
      s.status !== undefined ? `HTTP ${s.status}` : null
    ].filter(Boolean)
    if (s.phase === 'success')
      return ['已连接', ...meta, s.responseText || null].filter(Boolean).join(' · ')
    return ['失败', ...meta, s.message].filter(Boolean).join(' · ')
  })

  const testTagType = computed(() => {
    const p = testState.value.phase
    if (p === 'error') return 'danger'
    if (p === 'success') return 'success'
    return 'info'
  })

  async function handleTest() {
    if (!props.model.id.trim() || testState.value.phase === 'testing') return
    testState.value = { phase: 'testing' }
    try {
      const d = await testModel({
        providerName: props.providerName,
        provider: props.provider,
        model: props.model
      })
      if (!d.ok) {
        testState.value = {
          phase: 'error',
          message: d.error ?? '未知错误',
          latencyMs: d.latencyMs,
          status: d.status
        }
        return
      }
      testState.value = {
        phase: 'success',
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText
      }
    } catch (e: unknown) {
      testState.value = { phase: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  }
</script>

<style scoped>
  .detail {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .detail-head {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .head-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .test-tag {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--el-text-color-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    padding-left: 4px;
  }

  .level-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }

  .level-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .cost-title {
    margin-top: 6px;
  }

  .cost-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 16px;
  }

  .full-width {
    width: 100%;
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
