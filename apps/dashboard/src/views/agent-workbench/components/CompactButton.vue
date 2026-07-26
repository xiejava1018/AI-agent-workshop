<!--
  CompactButton —— 上下文压缩按钮。

  完全复刻 apps/web/components/ChatInput.tsx 第 1779~1857 行的 compact 按钮:
    - idle:    双向收缩箭头 SVG + "Compact" 文字,muted 灰色
    - running: 实心方块 stop icon + "Compacting…" 文字,红色边 + 红色文字 + 红色背景
    - error:   在按钮顶部浮一个暗色 tooltip 提示错误文字

  props:
    - isCompacting: boolean —— 后端是否正在压缩
    - compactError: string | null —— 最近一次失败的错误信息(用于 red tooltip)
    - disabledByStreaming: boolean —— 流式期间不能压缩(除非 isCompacting=true,
      此时允许点击 interrupt),对齐 apps/web 的 disabled = isStreaming && !isCompacting

  emits:
    - compact —— 点击触发压缩(idle 状态)
    - abort-compact —— 点击停止压缩(running 状态)
-->
<script setup lang="ts">
  import { ref, watch } from 'vue'

  interface Props {
    isCompacting: boolean
    compactError: string | null
    /** 流式期间父级禁用;isCompacting 时允许点停 */
    disabledByStreaming: boolean
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    compact: []
    'abort-compact': []
  }>()

  function onClick(): void {
    if (props.disabledByStreaming && !props.isCompacting) return
    if (props.isCompacting) {
      emit('abort-compact')
    } else {
      emit('compact')
    }
  }

  // hover 时若 error 还显示,短暂延长显示。apps/web 是 inline show,我们用 ref 控制。
  const showErrorTooltip = ref(false)
  watch(
    () => props.compactError,
    (e) => {
      if (!e) {
        showErrorTooltip.value = false
        return
      }
      // compactError 设置后一直显示直到 compactError 清空(下次成功压缩或父级手动 reset)
      showErrorTooltip.value = true
    },
    { immediate: true }
  )
</script>

<template>
  <div class="wb-compact">
    <!-- Error tooltip:仅 compactError 非空且未 dismiss 时显示 -->
    <div
      v-if="showErrorTooltip && compactError"
      class="wb-compact__error-tooltip"
      role="alert"
    >
      {{ compactError }}
    </div>
    <button
      type="button"
      :class="['wb-compact__btn', { 'is-running': isCompacting }]"
      :title="isCompacting ? '停止压缩' : '压缩上下文'"
      :aria-label="isCompacting ? '停止压缩' : '压缩上下文'"
      :disabled="disabledByStreaming && !isCompacting"
      @click="onClick"
    >
      <!-- running 态:实心方块停止图标 -->
      <svg
        v-if="isCompacting"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
      >
        <rect
          x="2"
          y="2"
          width="6"
          height="6"
          rx="1"
          fill="currentColor"
        />
      </svg>
      <!-- idle 态:双向收缩箭头图标 -->
      <svg
        v-else
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="4 14 10 14 10 20" />
        <polyline points="20 10 14 10 14 4" />
        <line x1="10" y1="14" x2="3" y2="21" />
        <line x1="21" y1="3" x2="14" y2="10" />
      </svg>
      <span class="wb-compact__label">{{ isCompacting ? '压缩中…' : 'Compact' }}</span>
    </button>
  </div>
</template>

<style scoped>
  .wb-compact {
    position: relative;
    display: inline-flex;
  }

  /* Error tooltip:绝对定位,在按钮上方 —— 对齐 apps/web 的下方 100% + 6px
   * 但 apps/web 的 ChatInput 是反着的(tooltip 在按钮上方而非下方),
   * 因为这是底栏,要避免超出 viewport。 */
  .wb-compact__error-tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    background: #1f2937;
    color: #f87171;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 5px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    z-index: 50;
  }

  .wb-compact__btn {
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
    white-space: nowrap;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }

  .wb-compact__btn:hover:not(:disabled) {
    background: var(--wb-hover, rgba(0, 0, 0, 0.04));
    color: var(--wb-text);
  }

  .wb-compact__btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* 压缩运行态:红字 + 红色背景,hover 加深 —— 对齐 apps/web */
  .wb-compact__btn.is-running {
    background: rgba(239, 68, 68, 0.08);
    color: #ef4444;
  }
  .wb-compact__btn.is-running:hover {
    background: rgba(239, 68, 68, 0.16);
    color: #ef4444;
  }

  .wb-compact__label {
    white-space: nowrap;
    font-weight: 500;
  }
</style>
