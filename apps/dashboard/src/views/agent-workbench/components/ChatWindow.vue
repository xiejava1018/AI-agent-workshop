<script setup lang="ts">
  /**
   * ChatWindow —— 当前会话的聊天核心容器(等价 apps/web/components/ChatWindow.tsx)。
   *
   * Vue 端 v1 简化:
   *   - 不实现 drag/drop 上传 / 缩放 / extension UI 弹窗
   *   - 只负责 messages 渲染 + 流状态指示 + 滚动到底部 + 错误提示
   *   - ChatInput 由父级 index.vue 通过 slot 注入,本组件只暴露 sendMessage /
   *     abort 上下文(useAgentSession)
   */
  import { computed, nextTick, onMounted, ref, watch } from 'vue'
  import { ElNotification } from 'element-plus'
  import MessageView from './MessageView.vue'
  import { useAgentSession } from '../composables/useAgentSession'
  import type { AgentMessage, Branch } from '../types'

  interface Props {
    sessionId: string
    branchesByMessage?: ReadonlyMap<string, readonly Branch[]>
  }

  const props = withDefaults(defineProps<Props>(), {
    branchesByMessage: () => new Map()
  })

  const userId = localStorage.getItem('user_id') || ''

  const { messages, isStreaming, streamStatus, error, sendMessage, abort, clearError } =
    useAgentSession(props.sessionId, userId)

  const messagesScrollRef = ref<{ wrap?: { scrollTop?: number; scrollHeight?: number } } | null>(
    null
  )

  async function scrollToBottom(): Promise<void> {
    await nextTick()
    const el = messagesScrollRef.value?.wrap
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }

  // 消息列表变化时滚动到底部
  watch(
    () => messages.value.length,
    () => {
      void scrollToBottom()
    }
  )

  watch(isStreaming, (streaming) => {
    if (streaming) void scrollToBottom()
  })

  // 错误提示
  watch(error, (err) => {
    if (err) {
      ElNotification({
        title: '聊天流错误',
        message: err,
        type: 'error',
        duration: 5000
      })
      clearError()
    }
  })

  function onBranchSwitch(messageId: string, branchId: string): void {
    // v1 仅 emit 透传;实际分支切换由父级 ChatWindow 容器处理(后续 Track
    // 可挂 useBranch composable)。
    console.log('[ChatWindow] branchSwitch', messageId, branchId)
  }

  function onToolExpand(toolCallId: string): void {
    console.log('[ChatWindow] toolExpand', toolCallId)
  }

  function onRetry(messageId: string): void {
    // v1:触发 useAgentSession 的 sendMessage(由 ChatInput 自行处理)
    // 这里只暴露事件给父级容器,由 index.vue 接住后驱动 ChatInput 重发。
    console.log('[ChatWindow] retry', messageId)
  }

  defineExpose({
    sendMessage,
    abort,
    isStreaming,
    streamStatus,
    messages
  })

  onMounted(() => {
    void scrollToBottom()
  })

  // 把 reactive messages.value 包装成 readonly
  const readonlyMessages = computed<readonly AgentMessage[]>(() => messages.value)
</script>

<template>
  <div class="wb-chat-window">
    <!-- 消息列表 -->
    <el-scrollbar ref="messagesScrollRef" class="wb-messages">
      <MessageView
        v-for="msg in readonlyMessages"
        :key="msg.id"
        :message="msg"
        :branches="branchesByMessage.get(msg.id) ?? []"
        @branch-switch="onBranchSwitch"
        @tool-expand="onToolExpand"
        @retry="onRetry"
      />

      <!-- 空状态 -->
      <div v-if="readonlyMessages.length === 0" class="wb-empty">
        <div class="wb-empty__icon">💬</div>
        <div class="wb-empty__title">{{ sessionId ? '开始对话' : '请选择一个会话' }}</div>
        <div class="wb-empty__hint">在下方输入框输入消息,按 Enter 发送,Shift+Enter 换行</div>
      </div>

      <!-- 滚动锚点 -->
      <div class="wb-chat-window__anchor" />
    </el-scrollbar>

    <!-- ChatInput 由父级通过 slot 注入 -->
    <slot name="input" :send-message="sendMessage" :abort="abort" :is-streaming="isStreaming" />
  </div>
</template>

<style scoped>
  .wb-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 16px;
    text-align: center;
    color: var(--wb-text-muted);
    min-height: 240px;
  }

  .wb-empty__icon {
    font-size: 48px;
    margin-bottom: 12px;
    opacity: 0.5;
  }

  .wb-empty__title {
    font-size: 15px;
    color: var(--wb-text);
    margin-bottom: 6px;
  }

  .wb-empty__hint {
    font-size: 13px;
    color: var(--wb-text-dim);
  }

  .wb-chat-window__anchor {
    height: 1px;
    width: 100%;
  }
</style>
