<script setup lang="ts">
  /**
   * MessageActionBar —— 单条消息右上角 hover 才显示的操作按钮组。
   *
   * 设计要点(来自 spec agent-message-chrome):
   *   - role="toolbar" 包裹,带 aria-label 描述当前角色
   *   - 每个按钮 aria-label 描述具体动作
   *   - 显隐由父级 .wb-message:hover / :focus-within 通过 CSS 控制(opacity 切换),
   *     这里不引入 hovered ref,纯 CSS 驱动,无 JS 抖动。
   *   - 用户角色:Copy + Edit + Fork(entryId)+ Navigate Up(prevAssistantEntryId)
   *   - 助手角色:Copy + Retry(!isStreaming)
   *
   * 所有动作以 emit 形式透传;真实业务(edit 灌回输入框 / fork 调 RPC 等)由父级 ChatWindow
   * 处理。Copy 由本组件直接调 copyText + 短暂显示 "Copied" 反馈,失败显示 "Failed"。
   */
  import { ElNotification } from 'element-plus'
  import { ref } from 'vue'
  import { copyText } from '../utils/clipboard'

  interface Props {
    role: 'user' | 'assistant'
    content: string
    messageId: string
    isStreaming?: boolean
    entryId?: string
    prevAssistantEntryId?: string
  }

  const props = withDefaults(defineProps<Props>(), {
    isStreaming: false,
    entryId: undefined,
    prevAssistantEntryId: undefined
  })

  const emit = defineEmits<{
    copy: [text: string]
    edit: [entryId: string | undefined, content: string]
    fork: [entryId: string]
    navigate: [entryId: string | undefined, prevAssistantEntryId: string, content: string]
    retry: [messageId: string]
  }>()

  const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
  let copyTimer: ReturnType<typeof setTimeout> | null = null

  function flashCopy(state: 'copied' | 'failed'): void {
    copyState.value = state
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copyState.value = 'idle'
    }, 1500)
  }

  async function onCopy(): Promise<void> {
    const ok = await copyText(props.content)
    flashCopy(ok ? 'copied' : 'failed')
    emit('copy', props.content)
    if (!ok) {
      ElNotification({
        title: '复制失败',
        message: '请检查浏览器权限或手动选择文本复制',
        type: 'warning',
        duration: 3000
      })
    }
  }

  function onEdit(): void {
    emit('edit', props.entryId, props.content)
  }

  function onFork(): void {
    if (props.entryId) emit('fork', props.entryId)
  }

  function onNavigate(): void {
    if (props.prevAssistantEntryId) {
      emit('navigate', props.entryId, props.prevAssistantEntryId, props.content)
    }
  }

  function onRetry(): void {
    emit('retry', props.messageId)
  }

  const copyLabel = () => {
    if (copyState.value === 'copied') return '已复制'
    if (copyState.value === 'failed') return '失败'
    return '复制'
  }
</script>

<template>
  <div
    class="wb-message__actions"
    role="toolbar"
    :aria-label="role === 'user' ? 'User message actions' : 'Assistant message actions'"
  >
    <!-- 通用 Copy -->
    <button
      type="button"
      class="wb-action"
      :class="{
        'wb-action--copied': copyState === 'copied',
        'wb-action--failed': copyState === 'failed'
      }"
      :aria-label="copyState === 'copied' ? 'Message copied' : 'Copy message'"
      @click="onCopy"
    >
      {{ copyLabel() }}
    </button>

    <!-- 用户消息:Edit / Fork / Navigate Up -->
    <template v-if="role === 'user'">
      <button
        type="button"
        class="wb-action"
        aria-label="Edit message"
        @click="onEdit"
      >
        编辑
      </button>
      <button
        v-if="entryId"
        type="button"
        class="wb-action"
        aria-label="Fork from this point"
        @click="onFork"
      >
        Fork
      </button>
      <button
        v-if="prevAssistantEntryId"
        type="button"
        class="wb-action"
        aria-label="Navigate to previous assistant entry"
        @click="onNavigate"
      >
        ↑
      </button>
    </template>

    <!-- 助手消息:Retry(仅非流式时) -->
    <template v-else-if="role === 'assistant'">
      <button
        v-if="!isStreaming"
        type="button"
        class="wb-action"
        aria-label="Retry this response"
        @click="onRetry"
      >
        重试
      </button>
    </template>
  </div>
</template>

<style scoped>
  .wb-message__actions {
    position: absolute;
    top: 6px;
    right: 8px;
    display: inline-flex;
    gap: 4px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease-out;
    z-index: 2;
  }

  /* 由父级 .wb-message hover / focus-within 触发显示 */
  .wb-message:hover .wb-message__actions,
  .wb-message:focus-within .wb-message__actions {
    opacity: 1;
    pointer-events: auto;
  }

  .wb-action {
    /* 故意用 plain button + 元素级变量,不引 el-button —— 这是 chrome 层的微小组件,
       全局依赖 element-plus + 避免每次操作都跑 el-button 的 props watch */
    appearance: none;
    background: var(--wb-bg-elevated);
    border: 1px solid var(--wb-border);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    line-height: 18px;
    color: var(--wb-text-muted);
    cursor: pointer;
    transition: color 120ms ease-out, border-color 120ms ease-out;
  }
  .wb-action:hover,
  .wb-action:focus-visible {
    color: var(--wb-accent);
    border-color: var(--wb-accent);
    outline: none;
  }
  .wb-action--copied {
    color: var(--wb-success);
    border-color: var(--wb-success);
  }
  .wb-action--failed {
    color: var(--wb-danger);
    border-color: var(--wb-danger);
  }
</style>