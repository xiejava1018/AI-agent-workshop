<script setup lang="ts">
  /**
   * MessageView —— 单条消息渲染(等价 apps/web/components/MessageView.tsx)。
   *
   * chrome v1(A 组)改造:
   *   - 头部 chrome:<header> + el-tag 角色标签 + 智能时间戳(formatTime)
   *   - token footer:<footer class="wb-message__usage">{n} in · {n} out · {n} cache>
   *     仅当 assistant + streamStatus==='done' + msg.usage 存在时显示
   *   - 操作按钮(MessageActionBar):hover 时显示 Copy/Edit/Fork/Retry/Navigate Up
   *
   * props / emits 与 design §"组件契约 / MessageView.vue" 一致。
   */
  import { computed } from 'vue'
  import MarkdownBody from './MarkdownBody.vue'
  import MessageActionBar from './MessageActionBar.vue'
  import type { AgentMessage, Branch } from '../types'

  interface Props {
    message: AgentMessage
    branches?: readonly Branch[]
    isLast?: boolean
    /** chrome v1:{ 'provider/modelId' -> displayName } */
    modelNames?: Record<string, string>
    /** chrome v1:SDK entryId(用于 fork / navigate emit) */
    entryId?: string
    /** chrome v1:上一条 assistant 的 entryId */
    prevAssistantEntryId?: string
    /** chrome v1:是否正在流式(用于助手 Retry 按钮的可见性 + footer 渲染判断) */
    isStreaming?: boolean
  }

  const props = withDefaults(defineProps<Props>(), {
    branches: () => [] as readonly Branch[],
    isLast: false,
    modelNames: () => ({}),
    entryId: undefined,
    prevAssistantEntryId: undefined,
    isStreaming: false
  })

  const emit = defineEmits<{
    branchSwitch: [messageId: string, branchId: string]
    toolExpand: [toolCallId: string]
    retry: [messageId: string]
    copy: [text: string]
    edit: [entryId: string | undefined, content: string]
    fork: [entryId: string]
    navigate: [entryId: string | undefined, prevAssistantEntryId: string, content: string]
  }>()

  const isPartial = computed(() => Boolean(props.message.partial))
  const isCancelled = computed(() => Boolean(props.message.cancelled))
  const isAssistant = computed(() => props.message.role === 'assistant')
  const isUser = computed(() => props.message.role === 'user')

  /** 助手消息头部模型名:provider + ':' + modelId → modelNames → fallback 'assistant' */
  const assistantLabel = computed((): string => {
    const m = props.message
    if (!isAssistant.value) return ''
    const provider = m.modelProvider
    const modelId = m.modelId
    if (provider && modelId) {
      const key = `${provider}:${modelId}`
      const named = props.modelNames?.[key]
      if (named) return named
    }
    if (modelId && props.modelNames?.[modelId]) {
      return props.modelNames[modelId]
    }
    return 'assistant'
  })

  /** 智能时间戳:今天 HH:MM / 本年 M月D日 / 跨年 YYYY年M月D日 */
  function formatTime(iso: string): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const now = new Date()
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    if (sameDay) {
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      return `${hh}:${mm}`
    }
    if (d.getFullYear() === now.getFullYear()) {
      return `${d.getMonth() + 1}月${d.getDate()}日`
    }
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  }

  /** 千分位格式化(用于 token footer) */
  function formatToken(n: number | undefined): string {
    if (typeof n !== 'number' || Number.isNaN(n)) return '0'
    return n.toLocaleString()
  }

  /** token footer 仅在完成且 usage 存在时显示 */
  const showUsageFooter = computed(
    () =>
      isAssistant.value &&
      props.message.streamStatus === 'done' &&
      Boolean(props.message.usage)
  )

  function onBranchSwitch(branchId: string): void {
    emit('branchSwitch', props.message.id, branchId)
  }
  // 暴露给父级 slot 注入使用
  defineExpose({ onBranchSwitch })

  function onToolExpand(toolCallId: string): void {
    emit('toolExpand', toolCallId)
  }

  function onRetry(): void {
    emit('retry', props.message.id)
  }

  function onCopy(text: string): void {
    emit('copy', text)
  }

  function onEdit(entryId: string | undefined, content: string): void {
    emit('edit', entryId, content)
  }

  function onFork(entryId: string): void {
    emit('fork', entryId)
  }

  function onNavigate(
    entryId: string | undefined,
    prevAssistantEntryId: string,
    content: string
  ): void {
    emit('navigate', entryId, prevAssistantEntryId, content)
  }
</script>

<template>
  <div
    class="wb-message"
    :class="`wb-message--${message.role}`"
    :data-message-id="message.id"
  >
    <!-- User / Assistant: MarkdownBody 渲染 + 头部 chrome + token footer + action bar -->
    <template v-if="message.role === 'user' || message.role === 'assistant'">
      <div class="wb-message__bubble">
        <!-- 头部 chrome:角色标签 + 时间戳
             user 角色用 el-tag(可视化强),assistant 改用纯文本模型名(与 React 参考一致,
             头部更轻盈、model name 与 time 同行)。fallback 'assistant' 仍走纯文本。 -->
        <header class="wb-message__header">
          <el-tag
            v-if="isUser"
            class="wb-message__role-tag"
            type="info"
            plain
            size="small"
          >USER</el-tag>
          <span
            v-else-if="isAssistant"
            class="wb-message__model-name"
          >{{ assistantLabel }}</span>
          <time
            class="wb-message__time"
            :datetime="message.createdAt"
          >{{ formatTime(message.createdAt) }}</time>
        </header>

        <MarkdownBody :content="message.content" />

        <!-- 流式 / 错误 / 取消 状态标记 -->
        <div
          v-if="message.role === 'assistant' && message.streamStatus === 'streaming'"
          class="wb-message__streaming-tag"
        >
          <span class="wb-typing-dots" aria-label="生成中">
            <span class="wb-typing-dots__dot" />
            <span class="wb-typing-dots__dot" />
            <span class="wb-typing-dots__dot" />
          </span>
        </div>

        <div v-if="isPartial || isCancelled" class="wb-stream-error">
          <span v-if="isCancelled">已取消</span>
          <span v-else>回复未完成</span>
          <button v-if="isCancelled" type="button" class="wb-stream-error__retry" @click="onRetry">
            重试
          </button>
        </div>

        <!-- 分支导航 -->
        <div v-if="branches.length > 1" class="wb-message__branches">
          <slot name="branches">
            <!-- 父组件可通过 slot 自定义渲染,默认由父级 BranchNavigator 接管 -->
          </slot>
        </div>

        <!-- token footer(仅完成且有 usage 的 assistant) -->
        <footer v-if="showUsageFooter" class="wb-message__usage">
          {{ formatToken(message.usage?.input) }} in ·
          {{ formatToken(message.usage?.output) }} out ·
          {{ formatToken(message.usage?.cacheRead) }} cache
        </footer>

        <!-- 操作按钮(hover 显示) -->
        <MessageActionBar
          :role="message.role === 'user' ? 'user' : 'assistant'"
          :content="message.content"
          :message-id="message.id"
          :is-streaming="isStreaming"
          :entry-id="entryId"
          :prev-assistant-entry-id="prevAssistantEntryId"
          @copy="onCopy"
          @edit="onEdit"
          @fork="onFork"
          @navigate="onNavigate"
          @retry="onRetry"
        />
      </div>
    </template>

    <!-- Tool: monospace 样式 -->
    <template v-else-if="message.role === 'tool'">
      <div class="wb-message__bubble">
        <pre class="wb-message__tool-content">{{ message.content }}</pre>
        <button type="button" class="wb-stream-error__retry" @click="onToolExpand(message.id)">
          展开
        </button>
      </div>
    </template>

    <!-- System / 其它 role: 简单文本展示 -->
    <template v-else>
      <div class="wb-message__bubble">
        <MarkdownBody :content="message.content" />
      </div>
    </template>
  </div>
</template>

<style scoped>
  .wb-message__bubble {
    position: relative;
  }

  .wb-message__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
    min-height: 22px;
  }
  .wb-message__role-tag {
    font-size: 11px;
    line-height: 18px;
  }
  .wb-message__model-name {
    font-size: 12px;
    color: var(--wb-text-secondary);
    font-weight: 500;
  }
  .wb-message__time {
    font-size: 11px;
    color: var(--wb-text-dim);
    font-variant-numeric: tabular-nums;
  }

  .wb-message__usage {
    margin-top: 6px;
    font-size: 11px;
    color: var(--wb-text-dim);
    font-variant-numeric: tabular-nums;
  }

  .wb-message__streaming-tag {
    display: inline-flex;
    align-items: center;
    margin-top: 6px;
  }

  .wb-message__branches {
    margin-top: 8px;
  }

  .wb-message__tool-content {
    margin: 0;
    padding: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    white-space: pre-wrap;
    word-break: break-all;
    background: transparent;
    border: none;
  }
</style>