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
  import BlockView from './messages/BlockView.vue'
  import type { AgentMessage, Branch } from '../types'
  import type { AssistantContentBlock } from '../types/assistant-blocks'

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

  /**
   * T2.5:把 message.content 窄化为下游消费所需的 string 形态。
   * dashboard v1.8 之前 content 始终 string;之后下放 AssistantContentBlock[]
   * 给 assistant role done 阶段。本任务不改渲染路径(留 G3 切 BlockView),
   * 仅做形态对齐:数组形态 flatten 成 text(只提取 text / thinking block 的字符串,
   * toolCall / image 等非文本块在 minimap-style preview 中忽略)。
   * 这保证 :content="message.content" 在 MarkdownBody / MessageActionBar 上
   * 静态分析为 string,渲染不出错;实际数组形态的 done 消息文本也能展示。
   *
   * 语义说明:这是过渡形态,toolCall / image 在 BlockView 化之前不会渲染,
   *          主动接受这一可见性损失以换取 T2.5 类型扩展的最小化改动面。
   * no-mutation:不修改原 content,产出新字符串。
   */
  const contentAsString = computed((): string => {
    const c = props.message.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) {
      return c
        .map((b) => {
          const block = b as AssistantContentBlock
          if (block.type === 'text') return block.text
          if (block.type === 'thinking') return block.thinking
          return ''
        })
        .join('')
    }
    return ''
  })

  /**
   * G5:把 assistant role message.content 收窄为 AssistantContentBlock[] 形态喂给 BlockView。
   * - string 形态(流式阶段)→ wrap 为 [{type:'text', text:string}] 单元素
   * - array 形态(done 阶段)→ 原样
   * - 其他(undefined / 异常)→ 空数组
   *
   * 这是 T2.5/T2.5b 推迟的 transition 收尾:BlockView 接助手消息的真正渲染路径。
   */
  const messageBlocks = computed((): readonly AssistantContentBlock[] => {
    const c = props.message.content
    if (Array.isArray(c)) return c
    if (typeof c === 'string') return [{ type: 'text', text: c }]
    return []
  })

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

  /** 智能时间戳 + 完整 ISO(用于 attribute) */
  const createdAtAttr = computed((): string => {
    const t = props.message.createdAt
    if (!t) return ''
    const d = new Date(t)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString()
  })

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
    <!-- User / Assistant: MarkdownBody 渲染 + chrome(模型名/复制/时间)+ token footer -->
    <template v-if="message.role === 'user' || message.role === 'assistant'">
      <div class="wb-message__bubble">
        <!-- assistant:模型名(左上,渲染文本之上) -->
        <span
          v-if="isAssistant"
          class="wb-message__model-name"
        >{{ assistantLabel }}</span>

        <!-- G5:assistant role 用 BlockView 树形分发(text/thinking/toolCall/image)。
             contentAsString 仍保留给 MessageActionBar / streaming-tag 内部使用。 -->
        <div v-if="isAssistant && messageBlocks.length > 0" class="wb-message__blocks">
          <BlockView :blocks="messageBlocks" />
        </div>

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

        <!-- assistant:chrome 嵌入气泡内底部 flow(不再 absolute),由 bubble 父级 flex-end 推到右下 -->
        <footer
          v-if="isAssistant"
          class="wb-message__chrome wb-message__chrome--assistant"
        >
          <MessageActionBar
            class="wb-message__chrome-action"
            :role="message.role === 'user' ? 'user' : 'assistant'"
            :content="contentAsString"
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
          <span
            v-if="showUsageFooter"
            class="wb-message__usage"
          >{{ formatToken(message.usage?.input) }} in · {{ formatToken(message.usage?.output) }} out · {{ formatToken(message.usage?.cacheRead) }} cache</span>
          <time
            v-if="createdAtAttr"
            class="wb-message__time"
            :datetime="createdAtAttr"
          >{{ formatTime(message.createdAt) }}</time>
        </footer>
      </div>

      <!-- user:chrome 在气泡外另起一行(复制 / 编辑 / 时间 同行右对齐) -->
      <footer
        v-if="isUser"
        class="wb-message__chrome wb-message__chrome--user"
      >
        <MessageActionBar
          class="wb-message__chrome-action"
          :role="message.role === 'user' ? 'user' : 'assistant'"
          :content="contentAsString"
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
        <time
          v-if="createdAtAttr"
          class="wb-message__time"
          :datetime="createdAtAttr"
        >{{ formatTime(message.createdAt) }}</time>
      </footer>
    </template>

    <!-- Tool: monospace 样式 -->
    <template v-else-if="message.role === 'tool'">
      <div class="wb-message__bubble">
        <pre class="wb-message__tool-content">{{ contentAsString }}</pre>
        <button type="button" class="wb-stream-error__retry" @click="onToolExpand(message.id)">
          展开
        </button>
      </div>
    </template>

    <!-- System / 其它 role: 简单文本展示 -->
    <template v-else>
      <div class="wb-message__bubble">
        <MarkdownBody :content="contentAsString" />
      </div>
    </template>
  </div>
</template>

<style scoped>
  /* 顶层 .wb-message 作为对齐 wrapper:user 时整条右靠,assistant 左靠 */
  .wb-message {
    display: block;
  }
  .wb-message--user {
    display: flex;
    flex-direction: column;
    align-items: flex-end; /* bubble 与 chrome 都贴右 */
  }
  .wb-message--assistant {
    display: block; /* assistant 默认流式,左对齐 */
  }

  /* bubble 提供定位上下文(被 tool / system / 其它 role 复用) */
  .wb-message__bubble {
    position: relative;
  }

  /* assistant 模型名(文本之上) */
  .wb-message__model-name {
    display: block;
    margin-bottom: 4px;
    font-size: 11px;
    color: var(--wb-text-secondary);
    font-weight: 500;
  }

  /* assistant bubble:vertical flex 让 footer( chrome )被推到 bubble 末行(视觉右下)。
     流式做法,不依赖 absolute。 */
  .wb-message--assistant .wb-message__bubble {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  /* assistant chrome:贴近 bubble 底部、横向右对齐 —— 与 user chrome 完全二致 */
  .wb-message__chrome--assistant {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
    font-size: 11px;
    color: var(--wb-text-dim);
    opacity: 0.85;
    transition: opacity 120ms ease-out;
  }
  .wb-message:hover .wb-message__chrome--assistant,
  .wb-message:focus-within .wb-message__chrome--assistant {
    opacity: 1;
  }

  .wb-message__chrome--assistant .wb-message__usage {
    font-variant-numeric: tabular-nums;
  }

  /* user:chrome 在气泡正下方换行一栏(因为外层 --user 是 column flex align-items:flex-end,
     所以 chrome 自己在流式宽度内右对齐)。 */
  .wb-message__chrome--user {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
    font-size: 11px;
    color: var(--wb-text-dim);
    opacity: 0.85;
    transition: opacity 120ms ease-out;
  }

  .wb-message__chrome .wb-message__time {
    font-variant-numeric: tabular-nums;
  }

  .wb-message__chrome-action {
    min-width: 1px;
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