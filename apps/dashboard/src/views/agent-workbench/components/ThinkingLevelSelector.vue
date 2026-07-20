<script setup lang="ts">
  /**
   * ThinkingLevelSelector —— 状态条中部 thinking level 下拉。
   *
   * 显示规则:
   *   - level === 'auto' → 'auto'
   *   - 否则直接显示 level
   * 下拉:
   *   - 默认显示全部 8 个等级(auto / off / minimal / low / medium / high / xhigh / max)
   *   - 若 availableLevels 非空,只显示该子集
   *   - 当前 level `is-active` 高亮
   */
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
  import { CaretBottom } from '@element-plus/icons-vue'

  const ALL_LEVELS = [
    'auto',
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
  ] as const

  interface Props {
    level: string
    availableLevels?: ReadonlyArray<string>
  }

  const props = withDefaults(defineProps<Props>(), {
    availableLevels: () => [] as ReadonlyArray<string>
  })

  const emit = defineEmits<{
    'update:level': [level: string]
  }>()

  const open = ref(false)
  const rootRef = ref<HTMLElement | null>(null)

  const visibleLevels = computed<string[]>(() => {
    if (props.availableLevels && props.availableLevels.length > 0) {
      // 保留 ALL_LEVELS 顺序,过滤交集
      return ALL_LEVELS.filter((l) => props.availableLevels!.includes(l))
    }
    return [...ALL_LEVELS]
  })

  function toggle(): void {
    if (visibleLevels.value.length === 0) return
    open.value = !open.value
  }

  function pick(level: string): void {
    open.value = false
    emit('update:level', level)
  }

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
  <div ref="rootRef" class="wb-thinking-selector">
    <button
      type="button"
      class="wb-thinking-selector__trigger"
      :aria-label="`当前思考档位:${level},点击切换`"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="wb-thinking-selector__label">{{ level }}</span>
      <el-icon class="wb-thinking-selector__caret"><CaretBottom /></el-icon>
    </button>
    <ul v-if="open" class="wb-thinking-selector__menu" role="listbox" aria-label="选择思考档位">
      <li
        v-for="lv in visibleLevels"
        :key="lv"
        role="option"
        :aria-selected="lv === level"
        :class="{ 'is-active': lv === level }"
        @click="pick(lv)"
      >
        {{ lv }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
  .wb-thinking-selector {
    position: relative;
    display: inline-block;
  }

  .wb-thinking-selector__trigger {
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

  .wb-thinking-selector__trigger:hover {
    background: var(--wb-hover, rgba(0, 0, 0, 0.04));
    color: var(--wb-text);
  }

  .wb-thinking-selector__caret {
    font-size: 10px;
    line-height: 1;
  }

  .wb-thinking-selector__menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 50;
    min-width: 120px;
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

  .wb-thinking-selector__menu li {
    padding: 6px 10px;
    cursor: pointer;
  }

  .wb-thinking-selector__menu li:hover {
    background: var(--wb-hover, rgba(0, 0, 0, 0.04));
  }

  .wb-thinking-selector__menu li.is-active {
    background: var(--wb-accent-bg, rgba(64, 158, 255, 0.1));
    color: var(--wb-accent, #409eff);
    font-weight: 600;
  }
</style>