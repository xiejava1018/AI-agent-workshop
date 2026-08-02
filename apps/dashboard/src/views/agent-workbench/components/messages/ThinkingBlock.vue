<script setup lang="ts">
/**
 * ThinkingBlock —— 折叠/展开 thinking 块。
 *
 * 默认折叠(spec 默认决策);streaming 状态(由父级传 prop)时自动展开;
 * deferred 时显示按需拉取占位 + emit 事件由父级 fetch。
 * text 字段是 thinking(spec 修正);不通过 markdown-it,显示为等宽预格式化。
 *
 * 对应 OpenSpec spec.md "ThinkingBlock 组件契约" Requirement。
 */
import type { ThinkingContent } from '../../types/assistant-blocks'

interface Props {
  block: ThinkingContent
  /** 来自外层 AgentMessage.streamStatus === 'streaming' */
  streaming?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  streaming: false,
})

const emit = defineEmits<{
  /** deferred 占位被点击,父级应 fetch thinking 内容 */
  loadDeferred: [block: ThinkingContent]
}>()

function onLoadDeferred(): void {
  emit('loadDeferred', props.block)
}
</script>

<template>
  <div class="wb-thinking" :class="{ 'wb-thinking--streaming': props.streaming, 'wb-thinking--deferred': props.block.deferred }">
    <template v-if="props.block.deferred">
      <button type="button" class="wb-thinking__placeholder" @click="onLoadDeferred">
        click to load thinking
      </button>
    </template>
    <details v-else :open="props.streaming">
      <summary class="wb-thinking__summary">skipped thinking content</summary>
      <pre class="wb-thinking__body">{{ props.block.thinking }}</pre>
    </details>
    <span v-if="props.streaming && !props.block.deferred" class="wb-thinking__pulse" aria-label="生成中" />
  </div>
</template>

<style scoped>
.wb-thinking { font-size: 12px; }
.wb-thinking__summary {
  color: var(--wb-text-dim);
  cursor: pointer;
  user-select: none;
}
.wb-thinking__body {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 4px 0 0;
  background: var(--wb-bg-elevated, rgba(0, 0, 0, 0.02));
  padding: 6px 8px;
  border-radius: 4px;
}
.wb-thinking__placeholder {
  appearance: none;
  background: transparent;
  border: 1px dashed var(--wb-border);
  color: var(--wb-text-dim);
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
}
.wb-thinking__pulse {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 4px;
  border-radius: 50%;
  background: var(--wb-accent, #4a90e2);
  animation: wb-thinking-pulse 1.2s ease-in-out infinite;
  vertical-align: middle;
}
@keyframes wb-thinking-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}
</style>
