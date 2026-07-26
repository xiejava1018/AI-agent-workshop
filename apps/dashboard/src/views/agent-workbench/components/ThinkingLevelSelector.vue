<!--
  ThinkingLevelSelector —— 思维等级下拉按钮。

  完全对齐 apps/web/components/ChatInput.tsx 第 1558-1777 行的下拉:
    - 32px 高透明背景 button + 灯泡 SVG + 当前 level label
    - hover 时:背景 var(--bg-hover), 文字色 muted → text
    - 下拉从按钮上方展开(bottom: calc(100% + 6px), right: 0),每项含:
      · 选中标记 (✓ 的小 SVG, accent 颜色)
      · level 名
      · 右对齐 description("Minimal reasoning" 等)
    - 8 个 level:auto / off / minimal / low / medium / high / xhigh / max
    - 默认全集;若 availableLevels 非空,过滤交集
-->
<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

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

  /** apps/web 原文 THINKING_LEVEL_DESC:每档一句话描述,放在下拉项右侧 dim 文字 */
  const LEVEL_DESC: Record<(typeof ALL_LEVELS)[number], string> = {
    auto: '使用默认',
    off: '关闭推理',
    minimal: '极少推理',
    low: '低强度推理',
    medium: '中强度推理',
    high: '高强度推理',
    xhigh: '极高强度推理',
    max: '最强推理'
  }

  interface Props {
    level: string
    availableLevels?: ReadonlyArray<string>
    /** streaming 时由父级传 true,把整个控件隐藏 —— apps/web 的 `!isStreaming && onThinkingLevelChange` 守卫 */
    disabledByStreaming?: boolean
  }

  const props = withDefaults(defineProps<Props>(), {
    availableLevels: () => [] as ReadonlyArray<string>,
    disabledByStreaming: false
  })

  const emit = defineEmits<{
    'update:level': [level: string]
  }>()

  const open = ref(false)
  const rootRef = ref<HTMLElement | null>(null)

  /** 大写首字母(对齐 apps/web 视觉:'Auto' / 'High' / 'Xhigh' 等) */
  const displayLabel = computed<string>(() => {
    const lvl = props.level
    if (!lvl) return 'Auto'
    return lvl.charAt(0).toUpperCase() + lvl.slice(1)
  })

  const visibleLevels = computed<string[]>(() => {
    if (props.availableLevels && props.availableLevels.length > 0) {
      return ALL_LEVELS.filter((l) => props.availableLevels!.includes(l))
    }
    return [...ALL_LEVELS]
  })

  function toggle(): void {
    if (props.disabledByStreaming) return
    if (visibleLevels.value.length === 0) return
    open.value = !open.value
  }

  function pick(level: string): void {
    open.value = false
    // 始终 emit,即使值不变(同 apps/web 的语义:用户点击就是明确意图)
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
      :class="['wb-thinking-selector__trigger', { 'is-open': open }]"
      :title="`调整推理等级:${displayLabel}`"
      aria-label="调整推理等级"
      :aria-expanded="open"
      :disabled="disabledByStreaming"
      @click="toggle"
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
        <line x1="7" y1="18" x2="12" y2="18" />
        <line x1="8" y1="21" x2="11" y2="21" />
      </svg>
      <span class="wb-thinking-selector__label">{{ displayLabel }}</span>
    </button>

    <!-- 下拉面板 -->
    <div
      v-if="open"
      class="wb-thinking-selector__menu"
      role="listbox"
      aria-label="选择推理等级"
    >
      <button
        v-for="lvl in visibleLevels"
        :key="lvl"
        type="button"
        role="option"
        :aria-selected="lvl === level"
        :class="['wb-thinking-selector__option', { 'is-active': lvl === level }]"
        @click="pick(lvl)"
      >
        <!-- ✓ mark 槽位(active 时填勾,否则占位保持对齐) -->
        <svg
          v-if="lvl === level"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="var(--wb-accent, #409eff)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="wb-thinking-selector__check"
        >
          <polyline points="1.5 5 4 7.5 8.5 2.5" />
        </svg>
        <span v-else class="wb-thinking-selector__check-spacer" />
        <span class="wb-thinking-selector__option-label">
          {{ lvl.charAt(0).toUpperCase() + lvl.slice(1) }}
        </span>
        <span class="wb-thinking-selector__option-desc">{{ LEVEL_DESC[lvl as keyof typeof LEVEL_DESC] }}</span>
      </button>
    </div>
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
    justify-content: center;
    gap: 5px;
    padding: 8px 12px;
    height: 32px;
    background: transparent;
    border: none;
    border-radius: 9px;
    color: var(--wb-text-dim, #a8abb2);
    cursor: pointer;
    font-size: 12px;
    opacity: 1;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }

  .wb-thinking-selector__trigger:hover:not(:disabled),
  .wb-thinking-selector__trigger.is-open {
    background: var(--wb-hover, rgba(0, 0, 0, 0.04));
    color: var(--wb-text);
  }

  .wb-thinking-selector__trigger:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .wb-thinking-selector__label {
    white-space: nowrap;
  }

  /* 下拉菜单:从按钮上方展开,右对齐 */
  .wb-thinking-selector__menu {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    z-index: 100;
    min-width: 200px;
    max-width: 280px;
    background: var(--wb-bg, #fff);
    border: 1px solid var(--wb-border, #e4e7ed);
    border-radius: 8px;
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    padding: 4px 0;
  }

  .wb-thinking-selector__option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 12px;
    background: transparent;
    border: none;
    color: var(--wb-text-dim, #a8abb2);
    cursor: pointer;
    font-size: 12px;
    font-weight: 400;
    text-align: left;
    white-space: nowrap;
    transition: background-color 0.12s ease;
  }

  .wb-thinking-selector__option:hover:not(.is-active) {
    background: var(--wb-hover, rgba(0, 0, 0, 0.04));
  }

  .wb-thinking-selector__option.is-active {
    background: var(--wb-accent-bg, rgba(64, 158, 255, 0.1));
    color: var(--wb-text);
    font-weight: 600;
  }

  .wb-thinking-selector__check {
    flex-shrink: 0;
  }
  .wb-thinking-selector__check-spacer {
    width: 10px;
    flex-shrink: 0;
  }

  .wb-thinking-selector__option-label {
    flex: 1;
  }

  .wb-thinking-selector__option-desc {
    font-size: 11px;
    color: var(--wb-text-dim);
    margin-left: 8px;
    flex-shrink: 0;
  }
</style>
