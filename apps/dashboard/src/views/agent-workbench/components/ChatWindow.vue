<script setup lang="ts">
  /**
   * ChatWindow —— 当前会话的聊天核心容器(等价 apps/web/components/ChatWindow.tsx)。
   *
   * Vue 端 v1 简化:
   *   - 不实现 drag/drop 上传 / 缩放 / extension UI 弹窗
   *   - 只负责 messages 渲染 + 流状态指示 + 滚动到底部 + 错误提示
   *   - ChatInput 由父级 index.vue 通过 slot 注入,本组件只暴露 sendMessage /
   *     abort 上下文(useAgentSession)
   *
   * chrome v1(A 组):接住 MessageView 的 emit(copy / edit / fork / navigate / retry)。
   *   - copy 走 copyText 工具函数(MessageView 内部已经完成复制 + 反馈,
   *     这里只在复制失败时记日志,失败通知由 MessageView 自行 ElNotification)
   *   - edit / fork / navigate:阶段 1 仅 console.log,后续 Track 接入
   *   - retry:实做 —— 找到该消息前的最后一条 user 消息,调 useAgentSession.sendMessage 重发
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

  const {
    messages,
    isStreaming,
    streamStatus,
    error,
    sendMessage,
    abort,
    clearError,
    modelNames
  } = useAgentSession(props.sessionId, userId)

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

  function onCopy(text: string): void {
    // MessageView 内部已经调 copyText 完成复制 + UI 反馈(Copied / Failed),
    // 这里只记一行日志便于调试。失败通知已经在 MessageView 里 ElNotification。
    console.log('[ChatWindow] copy', text.length, 'chars')
  }

  function onEdit(entryId: string | undefined, content: string): void {
    // 阶段 1 仅透传;后续 Track 接入:把 content 灌回输入框 + 触发重发。
    console.log('[ChatWindow] edit TODO', { entryId, content })
  }

  function onFork(entryId: string): void {
    // 阶段 1 仅透传;后续 Track 接入:用 entryId 调 fork RPC 创建新 session。
    console.log('[ChatWindow] fork TODO', { entryId })
  }

  function onNavigate(
    entryId: string | undefined,
    prevAssistantEntryId: string,
    content: string
  ): void {
    // 阶段 1 仅透传;后续 Track 接入:跳到 prevAssistantEntryId 对应的 entry 分支视图。
    console.log('[ChatWindow] navigate TODO', { entryId, prevAssistantEntryId, content })
  }

  function onRetry(messageId: string): void {
    // 实做:向前找到该 messageId 之前的最后一条 user 消息,调 sendMessage 重发。
    const list = messages.value
    const idx = list.findIndex((m) => m.id === messageId)
    if (idx < 0) {
      ElNotification({
        title: '重试失败',
        message: '未找到该消息',
        type: 'warning'
      })
      return
    }
    let lastUser: AgentMessage | undefined
    for (let i = idx - 1; i >= 0; i--) {
      const m = list[i]
      if (m && m.role === 'user' && m.content) {
        lastUser = m
        break
      }
    }
    if (!lastUser) {
      ElNotification({
        title: '重试失败',
        message: '未找到可重发的用户消息',
        type: 'warning'
      })
      return
    }
    void sendMessage(lastUser.content)
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

  /**
   * 计算每条 message 的 entryId / prevAssistantEntryId:
   *   - entryId:直接读 msg.entryId(T1 useEventStream 已保留)
   *   - prevAssistantEntryId:从当前 message 向前找最近的 assistant entryId
   *     (Vue 端不维护 entry list,这是 messages 数组层级的派生)
   */
  const messageContext = computed(() => {
    const ctx = new Map<string, { entryId?: string; prevAssistantEntryId?: string }>()
    const list = readonlyMessages.value
    let prevAssistantEntry: string | undefined
    for (const m of list) {
      const entry = m.entryId
      ctx.set(m.id, {
        entryId: entry,
        prevAssistantEntryId: prevAssistantEntry
      })
      if (m.role === 'assistant' && entry) prevAssistantEntry = entry
    }
    return ctx
  })
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
        :model-names="modelNames"
        :entry-id="messageContext.get(msg.id)?.entryId"
        :prev-assistant-entry-id="messageContext.get(msg.id)?.prevAssistantEntryId"
        :is-streaming="isStreaming"
        @branch-switch="onBranchSwitch"
        @tool-expand="onToolExpand"
        @retry="onRetry"
        @copy="onCopy"
        @edit="onEdit"
        @fork="onFork"
        @navigate="onNavigate"
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