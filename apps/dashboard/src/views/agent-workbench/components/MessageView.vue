<script setup lang="ts">
  /**
   * MessageView —— 单条消息渲染(等价 apps/web/components/MessageView.tsx)。
   *
   * Vue 端 v1 简化:不实现 thinking block 延迟加载 / tool call 配对 / patch diff
   * 渲染,只做 user / assistant / tool 三种 role 的基础视图,以及 partial /
   * cancelled 状态的提示与重试按钮。
   *
   * props / emits 与 design §"组件契约 / MessageView.vue" 一致。
   */
  import { computed } from 'vue'
  import MarkdownBody from './MarkdownBody.vue'
  import type { AgentMessage, Branch } from '../types'

  interface Props {
    message: AgentMessage
    branches?: readonly Branch[]
    isLast?: boolean
  }

  const props = withDefaults(defineProps<Props>(), {
    branches: () => [] as readonly Branch[],
    isLast: false
  })

  const emit = defineEmits<{
    branchSwitch: [messageId: string, branchId: string]
    toolExpand: [toolCallId: string]
    retry: [messageId: string]
  }>()

  const isPartial = computed(() => Boolean(props.message.partial))
  const isCancelled = computed(() => Boolean(props.message.cancelled))

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
</script>

<template>
  <div class="wb-message" :class="`wb-message--${message.role}`" :data-message-id="message.id">
    <!-- User / Assistant: MarkdownBody 渲染 -->
    <template v-if="message.role === 'user' || message.role === 'assistant'">
      <div class="wb-message__bubble">
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
