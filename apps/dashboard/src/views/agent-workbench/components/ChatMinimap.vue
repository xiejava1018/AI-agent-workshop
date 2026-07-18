<script setup lang="ts">
  import { computed, ref } from 'vue'
  import type { AgentMessage } from '../types'

  interface Props {
    messages: AgentMessage[]
  }

  const props = defineProps<Props>()
  const emit = defineEmits<{ jumpTo: [messageId: string] }>()

  const hoveredId = ref<string | null>(null)

  const visibleMessages = computed(() =>
    props.messages.filter(
      (message) =>
        (message.role === 'user' || message.role === 'assistant') &&
        message.content.trim().length > 0
    )
  )

  const messagePosition = (index: number): string => {
    if (visibleMessages.value.length <= 1) return '50%'
    return `${(index / (visibleMessages.value.length - 1)) * 100}%`
  }

  const messagePreview = (message: AgentMessage): string => {
    return message.content.replace(/\s+/g, ' ').trim().slice(0, 80)
  }

  const nodeClass = (message: AgentMessage): string => {
    if (message.role === 'user') return 'wb-minimap__node--user'
    return 'wb-minimap__node--assistant'
  }

  const jumpToMessage = (messageId: string): void => {
    emit('jumpTo', messageId)
  }
</script>

<template>
  <aside v-if="visibleMessages.length > 0" class="wb-minimap" aria-label="对话地图">
    <div class="wb-minimap__track" aria-hidden="true"></div>
    <button
      v-for="(message, index) in visibleMessages"
      :key="message.id"
      class="wb-minimap__node"
      :class="nodeClass(message)"
      :style="{
        top: messagePosition(index),
        transform:
          hoveredId === message.id ? 'translate(-50%, -50%) scale(1.5)' : 'translate(-50%, -50%)'
      }"
      type="button"
      :aria-label="`跳转到${message.role === 'user' ? '用户' : '助手'}消息`"
      @mouseenter="hoveredId = message.id"
      @mouseleave="hoveredId = null"
      @focus="hoveredId = message.id"
      @blur="hoveredId = null"
      @click="jumpToMessage(message.id)"
    >
      <span class="wb-minimap__tooltip">{{ messagePreview(message) }}</span>
    </button>
  </aside>
</template>

<style scoped>
  .wb-minimap {
    position: relative;
    width: 24px;
    min-width: 24px;
    min-height: 80px;
    height: 100%;
    overflow: visible;
    border-left: 1px solid var(--wb-border);
    background: var(--wb-bg-elevated);
    user-select: none;
  }

  .wb-minimap__track {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    transform: translateX(-50%);
    background: var(--wb-border);
  }

  .wb-minimap__node {
    position: absolute;
    left: 50%;
    z-index: 1;
    width: 8px;
    height: 8px;
    padding: 0;
    border: 1px solid var(--wb-accent);
    border-radius: 50%;
    cursor: pointer;
    transition: transform var(--wb-transition-fast) var(--wb-ease-out);
  }

  .wb-minimap__node--user {
    border-radius: 2px;
    border-color: var(--wb-accent);
    background: var(--wb-accent);
  }

  .wb-minimap__node--assistant {
    border-color: var(--wb-success);
    background: var(--wb-success);
  }

  .wb-minimap__tooltip {
    position: absolute;
    right: 14px;
    top: 50%;
    display: none;
    width: 210px;
    padding: var(--wb-pad-xs) var(--wb-pad-sm);
    transform: translateY(-50%);
    border: 1px solid var(--wb-border-strong);
    border-radius: var(--wb-radius-sm);
    background: var(--wb-bg);
    color: var(--wb-text);
    font-size: 11px;
    line-height: 1.4;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }

  .wb-minimap__node:hover .wb-minimap__tooltip,
  .wb-minimap__node:focus-visible .wb-minimap__tooltip {
    display: block;
  }

  .wb-minimap__node:focus-visible {
    outline: 2px solid var(--wb-accent);
    outline-offset: 2px;
  }
</style>
