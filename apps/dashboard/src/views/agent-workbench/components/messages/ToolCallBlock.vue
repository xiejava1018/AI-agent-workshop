<script setup lang="ts">
/**
 * ToolCallBlock —— 工具调用块:summary 行默认 + 点击展开 input + 配对的 ToolResultMessage。
 *
 * key facts:
 *   - block.toolName / block.toolCallId / block.input (mirror contract from T2.3 normalization)
 *   - pairedResults: Map 由父级 MessageView 解析同 messageId 内的 ToolResultMessage
 *   - summary 显示 [toolName] + 60 字符 input preview + toolCallId + copy 按钮
 *   - 没有 pairedResult 时显示 spinner(命令仍在执行),不可折叠
 *   - copy 按钮 → JSON.stringify({toolCallId, toolName, input, result, isError})
 *
 * 对应 OpenSpec spec.md "ToolCallBlock 组件契约" Requirement。
 */
import { computed, ref } from 'vue'
import type { ToolCallContent } from '../../types/assistant-blocks'

/**
 * Paired tool-result payload — minimal shape used by ToolCallBlock for paired-result
 * lookup。Full ToolResultMessage type lives elsewhere in types.ts; we keep this
 * duck-typed here so the component doesn't need cross-import friction.
 */
interface PairedToolResultLike {
  toolCallId: string
  content?: unknown
  isError?: boolean
}

interface Props {
  block: ToolCallContent
  /**
   * 由父级 MessageView 构造并传入:`Map<toolCallId, ToolResultMessage>`。
   * 缺失对应 toolCallId → 显示 spinner(命令仍在执行)。
   */
  pairedResults?: ReadonlyMap<string, PairedToolResultLike>
}

const props = withDefaults(defineProps<Props>(), {
  pairedResults: undefined,
})

const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
let copyTimer: ReturnType<typeof setTimeout> | null = null

function getPairedResult(): PairedToolResultLike | undefined {
  if (props.pairedResults) return props.pairedResults.get(props.block.toolCallId)
  return undefined
}

function previewInput(): string {
  try {
    return JSON.stringify(props.block.input).slice(0, 60)
  } catch {
    return ''
  }
}

function fullPayload(): string {
  const paired = getPairedResult()
  return JSON.stringify({
    toolCallId: props.block.toolCallId,
    toolName: props.block.toolName,
    input: props.block.input,
    result: paired?.content,
    isError: paired?.isError,
  })
}

function flashCopy(state: 'copied' | 'failed'): void {
  copyState.value = state
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copyState.value = 'idle'
  }, 1500)
}

async function onCopy(): Promise<void> {
  const text = fullPayload()
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      flashCopy('copied')
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(textarea)
      flashCopy(ok ? 'copied' : 'failed')
    }
  } catch {
    flashCopy('failed')
  }
}

const paired = getPairedResult()
const copyLabel = computed(() => {
  if (copyState.value === 'copied') return '已复制'
  if (copyState.value === 'failed') return '失败'
  return '复制'
})
const isExecuting = computed<boolean>(() => paired === undefined)
</script>

<template>
  <div class="wb-toolcall">
    <template v-if="isExecuting">
      <span class="wb-toolcall__spinner" aria-label="执行中" />
      <span class="wb-toolcall__name">[{{ props.block.toolName }}]</span>
      <span class="wb-toolcall__preview">{{ previewInput() }}</span>
      <span class="wb-toolcall__id">{{ props.block.toolCallId }}</span>
    </template>
    <details v-else>
      <summary class="wb-toolcall__summary">
        <span class="wb-toolcall__name">[{{ props.block.toolName }}]</span>
        <span class="wb-toolcall__preview">{{ previewInput() }}</span>
        <span class="wb-toolcall__id">{{ props.block.toolCallId }}</span>
        <button
          type="button"
          class="wb-toolcall__copy"
          @click.stop.prevent="onCopy"
        >{{ copyLabel }}</button>
      </summary>
      <div class="wb-toolcall__body">
        <div class="wb-toolcall__section">
          <div class="wb-toolcall__section-title">input</div>
          <pre><code>{{ JSON.stringify(props.block.input, null, 2) }}</code></pre>
        </div>
        <div v-if="paired" class="wb-toolcall__section">
          <div class="wb-toolcall__section-title">result</div>
          <pre><code>{{ paired.content }}</code></pre>
        </div>
      </div>
    </details>
  </div>
</template>

<style scoped>
.wb-toolcall { font-size: 12px; }
.wb-toolcall__spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 4px;
  border: 2px solid var(--wb-border, #ddd);
  border-top-color: var(--wb-accent, #4a90e2);
  border-radius: 50%;
  animation: wb-toolcall-spin 0.8s linear infinite;
  vertical-align: middle;
}
@keyframes wb-toolcall-spin { to { transform: rotate(360deg); } }
.wb-toolcall__summary,
.wb-toolcall__name { color: var(--wb-text); }
.wb-toolcall__preview,
.wb-toolcall__id {
  color: var(--wb-text-dim);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  margin-left: 6px;
}
.wb-toolcall__copy {
  appearance: none;
  background: var(--wb-bg-elevated);
  border: 1px solid var(--wb-border);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  margin-left: 6px;
  cursor: pointer;
}
.wb-toolcall__body { margin-top: 6px; }
.wb-toolcall__section-title {
  font-size: 11px;
  color: var(--wb-text-dim);
  margin: 4px 0 2px;
}
.wb-toolcall__section pre {
  margin: 0;
  font-size: 11.5px;
  background: var(--wb-bg-elevated, rgba(0, 0, 0, 0.03));
  padding: 6px 8px;
  border-radius: 4px;
  overflow-x: auto;
}
</style>
