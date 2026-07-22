<script setup lang="ts">
/**
 * ProcessDetailsGroup —— 处理详情折叠容器(镜像 apps/web ProcessDetailsGroup)。
 *
 * 接收 messageCount + toolCallCount 数字,显示 "Process details · N messages · M tool calls"。
 * 默认折叠;点击展开/收起。内容通过默认 <slot /> 由父级(MessageView)注入。
 *
 * 注意:本组件只做计数 + 折叠,不关心 slot 内容的渲染(由 BlockView 负责)。
 */
import { ref } from 'vue'

interface Props {
  messageCount: number
  toolCallCount: number
  defaultOpen?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  defaultOpen: false,
})

const open = ref<boolean>(props.defaultOpen)

function toggleOpen(): void {
  open.value = !open.value
}
</script>

<template>
  <div class="wb-process-details">
    <button
      type="button"
      class="wb-process-details__header"
      :aria-expanded="open"
      :title="open ? 'Collapse process details' : 'Expand process details'"
      @click="toggleOpen"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="wb-process-details__chevron"
        :style="{ transform: open ? 'rotate(90deg)' : 'none' }"
      >
        <polyline points="4 2.5 7.5 6 4 9.5" />
      </svg>
      <span class="wb-process-details__label">Process details</span>
      <span class="wb-process-details__sep">·</span>
      <span class="wb-process-details__count">{{ messageCount }} {{ messageCount === 1 ? 'message' : 'messages' }}</span>
      <template v-if="toolCallCount > 0">
        <span class="wb-process-details__sep">·</span>
        <span class="wb-process-details__count">{{ toolCallCount }} {{ toolCallCount === 1 ? 'tool call' : 'tool calls' }}</span>
      </template>
    </button>
    <div v-if="open" class="wb-process-details__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.wb-process-details {
  margin: 4px 0 8px;
}
.wb-process-details__header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: auto;
  min-height: 24px;
  padding: 2px 0;
  border: none;
  background: transparent;
  color: var(--wb-text-dim, #9ca3af);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
}
.wb-process-details__header:hover,
.wb-process-details__header:focus-visible {
  color: var(--wb-text, #333);
  outline: none;
}
.wb-process-details__chevron {
  flex-shrink: 0;
  transition: transform 150ms ease-out;
}
.wb-process-details__label {
  font-weight: 500;
}
.wb-process-details__sep {
  opacity: 0.6;
}
.wb-process-details__count {
  font-variant-numeric: tabular-nums;
}
.wb-process-details__body {
  margin-top: 8px;
  padding-left: 18px;
  border-left: 2px solid var(--wb-border, #e5e7eb);
}
</style>
