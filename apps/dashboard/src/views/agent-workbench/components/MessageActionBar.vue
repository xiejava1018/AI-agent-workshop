<script setup lang="ts">
  /**
   * MessageActionBar —— 单条消息正文下方 hover 才显示的操作按钮组。
   *
   * 设计要点(对齐 apps/web MessageView.tsx 的 bottom row):
   *   - role="toolbar" 包裹,带 aria-label 描述当前角色
   *   - 每个按钮 aria-label / title 描述具体动作,且带图标 + 文案
   *   - 本组件参与文档流(不再是 absolute),被父级放进 .wb-message__chrome
   *     底部行里,与 token usage / time 同行右对齐 —— 按钮永远紧贴正文正下方,
   *     不会浮到气泡右上角,也不会盖住其他信息。
   *   - 显隐由父级 .wb-message:hover / :focus-within 通过 CSS 控制(opacity 切换),
   *     纯 CSS 驱动,无 JS 抖动。
   *   - 用户角色:Copy + Edit + Fork(entryId)+ Navigate Up(prevAssistantEntryId)
   *   - 助手角色:Copy + Retry(!isStreaming)
   *
   * 所有动作以 emit 形式透传;真实业务(edit 灌回输入框 / fork 调 RPC 等)由父级 ChatWindow
   * 处理。Copy 由本组件直接调 copyText + 短暂显示 "已复制" 反馈,失败显示 "失败"。
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
    <!-- 通用 Copy(图标 + 文案,对齐 apps/web) -->
    <button
      type="button"
      class="wb-action"
      :class="{
        'wb-action--copied': copyState === 'copied',
        'wb-action--failed': copyState === 'failed'
      }"
      :title="copyState === 'copied' ? 'Message copied' : '复制'"
      :aria-label="copyState === 'copied' ? 'Message copied' : 'Copy message'"
      @click="onCopy"
    >
      <!-- copied:对勾;idle:两框叠加 -->
      <svg
        v-if="copyState === 'copied'"
        class="wb-action__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <svg
        v-else
        class="wb-action__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <span class="wb-action__label">{{ copyLabel() }}</span>
    </button>

    <!-- 用户消息:Edit(总在,把内容灌回输入框) / Fork(entryId) / Navigate Up(prevAssistantEntryId) -->
    <template v-if="role === 'user'">
      <button
        type="button"
        class="wb-action"
        title="编辑这条消息"
        aria-label="Edit message"
        @click="onEdit"
      >
        <svg
          class="wb-action__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        <span class="wb-action__label">编辑</span>
      </button>
      <button
        v-if="entryId"
        type="button"
        class="wb-action"
        title="新建会话 —— 从此处派生一份独立副本"
        aria-label="Fork from this point"
        @click="onFork"
      >
        <svg
          class="wb-action__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span class="wb-action__label">Fork</span>
      </button>
      <button
        v-if="prevAssistantEntryId"
        type="button"
        class="wb-action"
        title="跳到上一条助手回复"
        aria-label="Navigate to previous assistant entry"
        @click="onNavigate"
      >
        <svg
          class="wb-action__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
      </button>
    </template>

    <!-- 助手消息:Retry(仅非流式时) -->
    <template v-else-if="role === 'assistant'">
      <button
        v-if="!isStreaming"
        type="button"
        class="wb-action"
        title="重新生成回复"
        aria-label="Retry this response"
        @click="onRetry"
      >
        <svg
          class="wb-action__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        <span class="wb-action__label">重试</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
  /*
   * 关键:操作栏现在参与文档流(不再是 absolute)。
   * 它被放进 MessageView 的 .wb-message__chrome 底部行里,与 token usage / time 同行右对齐。
   * 这样按钮永远紧贴消息正文正下方,不会浮到气泡右上角,也不会盖住其他信息。
   * 显隐仍由父级 .wb-message:hover / :focus-within 通过 opacity 控制(纯 CSS,无 JS 抖动),
   * 与 apps/web MessageView.tsx 的 hovered?opacity:1:0 行为一致。
   */
  .wb-message__actions {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease-out;
  }

  /* 由父级 .wb-message hover / focus-within 触发显示 */
  .wb-message:hover .wb-message__actions,
  .wb-message:focus-within .wb-message__actions {
    opacity: 1;
    pointer-events: auto;
  }

  /* 单个按钮:对齐 apps/web —— 透明背景、无边框、图标+文案,hover 变 accent 色 */
  .wb-action {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 3px 8px;
    background: none;
    border: none;
    border-radius: 5px;
    color: var(--wb-text-dim, var(--wb-text-muted));
    font-size: 11px;
    font-weight: 400;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition: color 120ms ease-out;
  }
  .wb-action:hover,
  .wb-action:focus-visible {
    color: var(--wb-accent);
    outline: none;
  }

  .wb-action__icon {
    width: 11px;
    height: 11px;
    flex: 0 0 auto;
  }
  .wb-action__label {
    line-height: 1;
  }

  .wb-action--copied {
    color: var(--wb-success);
  }
  .wb-action--copied:hover {
    color: var(--wb-success);
  }
  .wb-action--failed {
    color: var(--wb-danger);
  }
</style>