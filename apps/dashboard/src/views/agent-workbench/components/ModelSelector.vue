<script setup lang="ts">
  /**
   * ModelSelector —— 状态条左侧模型下拉。
   *
   * 显示规则:
   *   - isAuto=true → 'auto'
   *   - 否则 modelNames[`${provider}:${modelId}`] → modelList item.name → 'provider:modelId' → 'no model'
   * 下拉:
   *   - 列出 modelList 全集,按 `Intl.Collator({numeric:true, sensitivity:'base'})` 排序
   *   - 当前项 `is-active` 高亮
   *   - 点击外部关闭(通过 document mousedown 监听)
   *
   * 纯展示组件,选中触发 update:model[provider, modelId],由 ChatInput 接住后调
   * useAgentSession.setModel。
   */
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
  import { CaretBottom } from '@element-plus/icons-vue'

  interface ModelItem {
    provider: string
    modelId: string
    name?: string
  }

  interface Props {
    model: { provider: string; modelId: string } | null
    modelList: ReadonlyArray<ModelItem>
    modelNames: Record<string, string>
    isAuto: boolean
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    'update:model': [provider: string, modelId: string]
  }>()

  const open = ref(false)
  const rootRef = ref<HTMLElement | null>(null)

  /** Intl.Collator 实例化开销不小,提升到 setup 顶层复用 */
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

  /** 当前显示名(优先级见顶部注释) */
  const displayName = computed<string>(() => {
    if (props.isAuto) return 'auto'
    if (!props.model) return 'no model'
    const key = `${props.model.provider}:${props.model.modelId}`
    if (props.modelNames[key]) return props.modelNames[key]
    const fromList = props.modelList.find(
      (m) => m.provider === props.model?.provider && m.modelId === props.model?.modelId
    )
    if (fromList?.name) return fromList.name
    return key || 'no model'
  })

  /** 排序后的下拉项(Intl.Collator numeric + base sensitivity,collator 复用 setup 实例) */
  const sortedItems = computed<ModelItem[]>(() => {
    const items = [...props.modelList]
    items.sort((a, b) => {
      const aLabel = a.name || `${a.provider}:${a.modelId}`
      const bLabel = b.name || `${b.provider}:${b.modelId}`
      return collator.compare(aLabel, bLabel)
    })
    return items
  })

  function toggle(): void {
    if (sortedItems.value.length === 0) return // 空列表时不展开(降级为纯文本)
    open.value = !open.value
  }

  function pick(item: ModelItem): void {
    open.value = false
    emit('update:model', item.provider, item.modelId)
  }

  function isActive(item: ModelItem): boolean {
    if (!props.model) return false
    return props.model.provider === item.provider && props.model.modelId === item.modelId
  }

  /** 点击外部关闭 */
  function onDocMouseDown(e: MouseEvent): void {
    if (!open.value) return
    const root = rootRef.value
    if (root && !root.contains(e.target as Node)) {
      open.value = false
    }
  }

  onMounted(() => {
    document.addEventListener('mousedown', onDocMouseDown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocMouseDown)
  })
</script>

<template>
  <div ref="rootRef" class="wb-model-selector">
    <button
      type="button"
      class="wb-model-selector__trigger"
      :aria-label="`当前模型:${displayName},点击切换`"
      :aria-expanded="open"
      :disabled="sortedItems.length === 0"
      @click="toggle"
    >
      <span class="wb-model-selector__label">{{ displayName }}</span>
      <el-icon v-if="sortedItems.length > 0" class="wb-model-selector__caret"><CaretBottom /></el-icon>
    </button>
    <ul v-if="open" class="wb-model-selector__menu" role="listbox" aria-label="选择模型">
      <li
        v-for="item in sortedItems"
        :key="`${item.provider}:${item.modelId}`"
        role="option"
        :aria-selected="isActive(item)"
        :class="{ 'is-active': isActive(item) }"
        @click="pick(item)"
      >
        {{ item.name || `${item.provider}:${item.modelId}` }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
  .wb-model-selector {
    position: relative;
    display: inline-block;
  }

  .wb-model-selector__trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--wb-text-dim);
    font-size: 12px;
    cursor: pointer;
  }

  .wb-model-selector__trigger:hover:not(:disabled) {
    background: var(--wb-hover, rgba(0, 0, 0, 0.04));
    color: var(--wb-text);
  }

  .wb-model-selector__trigger:disabled {
    cursor: default;
  }

  .wb-model-selector__caret {
    font-size: 10px;
    line-height: 1;
  }

  .wb-model-selector__menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 50;
    min-width: 200px;
    max-height: 240px;
    overflow-y: auto;
    margin: 0;
    padding: 4px 0;
    list-style: none;
    background: var(--wb-bg-panel, #fff);
    border: 1px solid var(--wb-border, #e4e7ed);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    color: var(--wb-text);
    font-size: 12px;
  }

  .wb-model-selector__menu li {
    padding: 6px 10px;
    cursor: pointer;
  }

  .wb-model-selector__menu li:hover {
    background: var(--wb-hover, rgba(0, 0, 0, 0.04));
  }

  .wb-model-selector__menu li.is-active {
    background: var(--wb-accent-bg, rgba(64, 158, 255, 0.1));
    color: var(--wb-accent, #409eff);
    font-weight: 600;
  }
</style>