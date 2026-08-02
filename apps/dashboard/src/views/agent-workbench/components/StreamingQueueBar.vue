<script setup lang="ts">
  /**
   * StreamingQueueBar —— streaming 期间显示在 Composer 顶部的队列条。
   *
   * 等价 React 端 ChatInput.tsx 的 QueuedMessageRow 列表(steer + followUp 合并渲染)。
   * - 当 items 为空或 isStreaming=false 时不渲染任何 DOM(slot 自动塌陷到高度 0)
   * - 每项:`el-tag(kind) + text-preview + × 按钮`
   * - 点击 × 触发 recall emit,父级调 cancelQueue(id)
   */
  import { ElTag } from 'element-plus'
  import type { QueueItem } from '../types'

  interface Props {
    items: readonly QueueItem[]
    isStreaming: boolean
  }

  const props = defineProps<Props>()

  defineEmits<{
    recall: [id: string]
  }>()

  /** 截断到 60 字符,无文本视为附件。 */
  function previewText(text: string): string {
    if (!text) return '(image attached)'
    return text.length > 60 ? text.slice(0, 60) + '...' : text
  }
</script>

<template>
  <ul
    v-if="props.isStreaming && props.items.length > 0"
    class="wb-stream-queue"
    data-testid="wb-stream-queue"
  >
    <li
      v-for="item in props.items"
      :key="item.id"
      class="wb-stream-queue__item"
      :data-kind="item.kind"
    >
      <el-tag
        :type="item.kind === 'followUp' ? 'primary' : 'info'"
        size="small"
        class="wb-stream-queue__kind"
      >
        {{ item.kind }}
      </el-tag>
      <span class="wb-stream-queue__preview">{{ previewText(item.text) }}</span>
      <button
        type="button"
        class="wb-stream-queue__recall"
        :aria-label="`Recall queued ${item.kind} message`"
        @click="$emit('recall', item.id)"
      >
        ×
      </button>
    </li>
  </ul>
</template>

<style scoped>
  .wb-stream-queue {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 8px;
    margin: 0;
    list-style: none;
  }

  .wb-stream-queue__item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .wb-stream-queue__kind {
    flex-shrink: 0;
  }

  .wb-stream-queue__preview {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--wb-text-dim);
  }

  .wb-stream-queue__recall {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--wb-text-dim);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }

  .wb-stream-queue__recall:hover {
    background: var(--wb-bg-soft);
    color: var(--wb-text);
  }
</style>
