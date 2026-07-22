<script setup lang="ts">
/**
 * ProcessDetailsGroup —— 多步 agent 中间步骤的可折叠容器(镜像 apps/web)。
 *
 * 接收 `messages` 计算计数(N messages + M tool calls),通过 `<slot>` 渲染 children
 * (由 ChatWindow 注入多 MessageView 实例)。容器自身**不**渲染 message 内容。
 *
 * 默认折叠;点击 header 展开/收起 body。
 *
 * 对应 OpenSpec spec.md "ProcessDetailsGroup 组件契约" Requirement。
 */
import { computed, ref } from 'vue'
import type { AgentMessage } from '../types'
import { isEmptyThinkingBlock } from '../composables/processGroups'

interface Props {
  messages: readonly AgentMessage[]
  defaultOpen?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  defaultOpen: false,
})

const open = ref<boolean>(props.defaultOpen)

const messageCount = computed<number>(() => props.messages.length)

const toolCallCount = computed<number>(() => {
  let n = 0
  for (const msg of props.messages) {
    if (msg.role !== 'assistant') continue
    const c = msg.content
    if (Array.isArray(c)) {
      for (const block of c) {
        if (block.type === 'toolCall') n++
      }
    } else if (msg.toolCalls && msg.toolCalls.length > 0) {
      // 兼容老 spec:toolCalls 字段(snapshot 数组)
      n += msg.toolCalls.length
    }
    if (n === Number.MAX_SAFE_INTEGER) break
    void isEmptyThinkingBlock(msg) // reserved for future filtering
  }
  return n
})

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
        <span class="wb-process-details__count">
          {{ toolCallCount }} {{ toolCallCount === 1 ? 'tool call' : 'tool calls' }}
        </span>
      </template>
    </button>
    <div v-if="open" class="wb-process-details__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.wb-process-details {
  margin: 4px 0;
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
