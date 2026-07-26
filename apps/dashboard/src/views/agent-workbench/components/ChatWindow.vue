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
   *
   * chrome v1(B7):把 useAgentSession 的 queuedMessages 透传给 input slot,
   *   父级 AppShell 在 slot 内挂 StreamingQueueBar。同一份 useAgentSession 实例
   *   (不另开 SSE 连接)。
   */
  import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
  import { ElNotification } from 'element-plus'
  import MessageView from './MessageView.vue'
  import ProcessDetailsGroup from './ProcessDetailsGroup.vue'
  import { useAgentSession } from '../composables/useAgentSession'
  import { buildRenderSegments, withAssistantBlocks } from '../composables/message-display'
  import type { AssistantContentBlock } from '../types/assistant-blocks'
  import type { AgentMessage, Branch, QueueItem } from '../types'

  /** AssistantMessage —— AgentMessage 中 role === 'assistant' 的子类型。
   *  types.ts 未导出该类型,这里 inline 定义。 */
  type AssistantMessage = AgentMessage & { role: 'assistant' }

  interface Props {
    sessionId: string
    branchesByMessage?: ReadonlyMap<string, readonly Branch[]>
  }

  const props = withDefaults(defineProps<Props>(), {
    branchesByMessage: () => new Map()
  })

  /**
   * edit 事件:用户点击某条 user 消息的「编辑」按钮时触发,
   * 参数为 (entryId, content)。ChatInput 由父级 AppShell 通过 slot 注入,
   * ChatWindow 拿不到其实例,故把请求 emit 给 AppShell,由它调
   * chatInputRef.fill(content) 把内容回填到输入框(对齐 apps/web 的
   * onEditContent -> insertIfEmpty)。
   *
   * auto-rename 事件:第一条 user 消息出现时触发,
   * 参数为 (sessionId, suggestedTitle)。父级 AppShell 接住后调
   * renameSession 把后端 title 写为 suggestedTitle,
   * 并同步到 tab.title 让 Tab 显示更友好。
   * 设计原因:ChatWindow 离最近发出过 user 的 sessionId 最近,
   * 负责检测逻辑;后端 / tab 标题更新都集中在 AppShell。
   */
  const emit = defineEmits<{
    edit: [entryId: string | undefined, content: string]
    'auto-rename': [sessionId: string, suggestedTitle: string]
  }>()

  const userId = localStorage.getItem('user_id') || ''

  const {
    messages,
    isStreaming,
    streamStatus,
    error,
    sendMessage,
    abort,
    clearError,
    modelNames,
    queuedMessages,
    cancelQueue
  } = useAgentSession(props.sessionId, userId)

  // chrome v1 B7:队列数据派生(follow-up 排前,steer 排后,匹配 React 端视觉顺序)。
  const queueItems = computed<readonly QueueItem[]>(() => [
    ...queuedMessages.value.followUp,
    ...queuedMessages.value.steer
  ])

  // ===========================================================================
  // tab title auto-rename:检测会话中第一条 user 消息,
  // 把它抽成 suggestedTitle emit 给父级 AppShell,后者调 renameSession 同步。
  //
  // 为什么 not  onMessage 完整传:
  //   - 当 ChatWindow load 一个已有会话(后端历史)时,messages 里已有许多 user。
  //     第一个 user 是最反面的命名提示(可能是“老题目”),与“刚开这个会话”的意图不符。
  //     我们只在会话中 user 数 0 → 1 的转移点命名,避免老会话被覆盖。
  //   - history 中 messages 先加载,再是 sent message;Vue 响应式 watch 会取最新值。
  //   - 会话切换 key 重建时组件 unmount,messages 重置,autoRenameFired 跟着重置(按组件实例范围)。
  // ===========================================================================
  let autoRenameFired = false
  function suggestTitleFromMessage(content: string): string {
    // 收口:多行压缩为单行 trim;截断 24 字(中文 1字 =1 字符)。apps/web 50字但
    // dashboard tab 较窄,24 字更安全。
    const single = content.replace(/\s+/g, ' ').trim()
    if (!single) return '新会话'
    return single.length > 24 ? single.slice(0, 24) + '…' : single
  }
  watch(
    () => messages.value,
    (list) => {
      if (autoRenameFired) return
      const userMsgs = list.filter((m) => m.role === 'user')
      if (userMsgs.length === 0) return
      autoRenameFired = true
      const first = userMsgs[0]
      const content = typeof first.content === 'string' ? first.content : ''
      if (!content.trim()) return
      const suggested = suggestTitleFromMessage(content)
      emit('auto-rename', props.sessionId, suggested)
    },
    { immediate: true }
  )

  // 用户主动滚动的意图记录(对齐 apps/web hooks/useAgentSession.ts
  // `userScrollIntentUntilRef`)。用户在最近 800ms 内有过滚轮 / 键盘 / 触摸
  // 滚动时,记下意图——避免后续流式增增抢用户滚动状态。但 force=true
  // 场景(用户刚发新消息 / 切换会话)不受影响,总是滚到底。
  const userScrollIntentUntil = ref(0)
  const SCROLL_INTENT_MS = 800

  function onScrollIntent(): void {
    userScrollIntentUntil.value = Date.now() + SCROLL_INTENT_MS
  }

  /**
   * 滚到底。
   * - force=true:不受用户意图影响,总是滚到底。
   *   用于:用户刚发送新消息 / 初次加载会话 / 切换会话。
   * - force=false:仅当用户未主动滚动(已超 800ms)才跟随。
   *   用于:流式增增。
   *
   * 不走 scrollIntoView:实测在 el-scrollbar 内部包裹下 scrollIntoView
   * 的 block:'end' 有时会停在 wrap.scrollHeight - wrap.clientHeight 之前
   * 的某个位置(~125px 差)。直接 wrap.scrollTop = wrap.scrollHeight 更可靠。
   * (React 端用 scrollIntoView 是因为 React 的滚动容器是原生 div.overflow-auto,
   * 行为一致;Vue 端用 Element-plus ElScrollbar,内部 wrap 是绝对定位布局。)
   */
  /**
   * 滚到底:把 .wb-messages 内部 el-scrollbar 的 wrap scrollTop 拉到 scrollHeight。
   *
   * 难点:el-scrollbar 内部布局是 absolute,流式期间 Vue 多次 patch DOM,
   * wrap.scrollHeight 在不同帧之间会变动。仅一次 nextTick / rAF 后设
   * scrollTop 可能停在中间位置(实测 stuck 在距底 80~125px)。
   *
   * 解法:用 ResizeObserver 监控 wrap 的 contentBoxSize,当 size 增加时(说明
   * 新内容到达并 layout 完成),把 scrollTop 同步追到底。incremental 处理:
   * 只在 scrollHeight 增长时追到底,不在缩小时跟(scrollHeight 缩小后
   * 用户看到的末尾其实没变)。force=true(用户刚发 / 切换会话)时只设一次。
   */
  function scrollToBottomSync(opts: { force?: boolean } = { force: false }): void {
    const wrap = document.querySelector<HTMLElement>('.wb-messages .el-scrollbar__wrap')
    if (!wrap) return
    if (!opts.force && Date.now() < userScrollIntentUntil.value) return
    wrap.scrollTop = wrap.scrollHeight
  }

  // 跟踪 anchor 是否在视口内:用 IntersectionObserver(每帧检查) + 退而求其次
  // MutationObserver(监视 messages 节点增删)。当 anchor 滚出视口(下方)和
  // 用户没有主动滚意图时,自动 scrollTop = scrollHeight 把 anchor 拉回视口。
  // 这模拟 React 端的"流式 append 自动跟到底"行为,同时不抢用户主动滚动。
  let anchorIntersectionObserver: IntersectionObserver | null = null

  function ensureAnchorFollower(): void {
    if (anchorIntersectionObserver) return
    const wrap = document.querySelector<HTMLElement>('.wb-messages .el-scrollbar__wrap')
    const anchor = document.querySelector<HTMLElement>('.wb-chat-window__anchor')
    if (!wrap || !anchor) {
      // messages 还没加载完,anchor 元素还没挂——下一帧重试
      requestAnimationFrame(ensureAnchorFollower)
      return
    }
    anchorIntersectionObserver = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const rb = entry.rootBounds
      const ar = entry.boundingClientRect
      // atBottom:anchor 顶部 ≤ root 视口底部 + 5px(anchor 在视口底部可见区内)
      const atBottom = rb ? ar.top <= rb.bottom + 5 : false
      // anchor 不在视口底部 + 用户没有主动滚动意图 -> 自动追到底
      if (!atBottom && Date.now() >= userScrollIntentUntil.value) {
        wrap.scrollTop = wrap.scrollHeight
      }
    }, {
      root: wrap,
      threshold: [0, 1.0]
    })
    anchorIntersectionObserver.observe(anchor)
  }

  function disposeAnchorFollower(): void {
    if (anchorIntersectionObserver) {
      anchorIntersectionObserver.disconnect()
      anchorIntersectionObserver = null
    }
  }

  async function scrollToBottom(opts: { force?: boolean } = {}): Promise<void> {
    if (!opts.force && Date.now() < userScrollIntentUntil.value) return
    await nextTick()
    scrollToBottomSync({ force: opts.force })
  }

  // 消息列表变化时:用户发送了新消息时强制滚到底(无论之前位置),
  // 流式增增时仅当用户贴近底部才自动跟。
  watch(
    () => messages.value.length,
    (n, prev) => {
      const added = n - (prev ?? 0)
      if (added > 0) {
        const last = messages.value[n - 1]
        void scrollToBottom({ force: last?.role === 'user' })
      }
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
    // 把被编辑的用户消息内容回填到输入框(对齐 apps/web onEditContent -> insertIfEmpty)。
    // ChatInput 由父级 AppShell 通过 slot 注入,本组件拿不到其实例,
    // 所以把请求 emit 给 AppShell,由它调 chatInputRef.fill(content)。
    emit('edit', entryId, content)
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
      // T2.5:role==='user' 时 content 契约为 string(始终),虽然类型上是
      // `string | AssistantContentBlock[]`,这里由 role 已 narrow 到 string;
      // 留 false 分支防御 non-string content (例如历史数据异常))
      if (m && m.role === 'user' && typeof m.content === 'string' && m.content) {
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
    // lastUser.content 已由 role + typeof 守卫收敛为 string
    void sendMessage(lastUser.content as string)
  }

  defineExpose({
    sendMessage,
    abort,
    isStreaming,
    streamStatus,
    messages
  })

  onMounted(() => {
    void scrollToBottom({ force: true })
    ensureAnchorFollower()
    // 用户滚动意图检测:对齐 apps/web hooks/useAgentSession.ts:1432
    // markUserScrollIntent。wheel/touchstart/keydown(SCROLL_KEYS)在 wrap
    // 区域触发时,记下意图——后续 800ms 内不抢用户滚动。
    const wrap = document.querySelector<HTMLElement>('.wb-messages .el-scrollbar__wrap')
    if (wrap) {
      wrap.addEventListener('wheel', onScrollIntent, { passive: true })
      wrap.addEventListener('touchstart', onScrollIntent, { passive: true })
      // SCROLL_KEYS:PageUp/PageDown/Home/End/ArrowUp/ArrowDown/space
      wrap.addEventListener('keydown', (e: KeyboardEvent) => {
        const keys = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar'])
        if (keys.has(e.key)) onScrollIntent()
      })
    }
  })

  onUnmounted(() => {
    disposeAnchorFollower()
  })

  // 把 reactive messages.value 包装成 readonly
  const readonlyMessages = computed<readonly AgentMessage[]>(() => messages.value)

  /**
   * A:回合聚合(turn-grouping)—— port 自 apps/web/components/ChatWindow.tsx。
   * 把消息流拆成 "render segment" 数组,每段要么是单条消息(降级情况/流式尾巴),
   * 要么是 user→finalAssistant 的回合,后者包含 processMessages(中间过程消息) +
   * finalAssistant 的 processBlocks + answerBlocks。
   */
  const renderSegments = computed(() =>
    buildRenderSegments(readonlyMessages.value, {
      isLiveTail: isStreaming.value
    })
  )

  /**
   * 给定回合内的 processMessages(assistant 形态),用 withAssistantBlocks 把
   * 它们的 content 拆成 processBlocks(供 ProcessDetailsGroup 内的 BlockView
   * 渲染),保留 usage 等元数据。
   */
  function processMessagesWithBlocks(messages: readonly AgentMessage[]): AssistantMessage[] {
    const out: AssistantMessage[] = []
    for (const m of messages) {
      if (m.role !== 'assistant') continue
      const blocks = (m as AssistantMessage).content
      if (!Array.isArray(blocks)) continue
      out.push(m as AssistantMessage)
    }
    return out
  }

  /** 从 segment 中取出 finalAssistant(一定是 assistant role) */
  function getFinalAssistant(seg: {
    kind: 'turn'
    processGroup: { finalAssistantIdx: number }
  }): AssistantMessage {
    const m = readonlyMessages.value[seg.processGroup.finalAssistantIdx]
    if (!m)
      throw new Error(
        `buildRenderSegments: invalid finalAssistantIdx ${seg.processGroup.finalAssistantIdx}`
      )
    return m as AssistantMessage
  }

  /** 计算回合的 total tool call 数(process messages + finalAssistant.processBlocks) */
  function countTurnToolCalls(seg: {
    kind: 'turn'
    processMessages: readonly AgentMessage[]
    processGroup: { finalProcessBlocks: readonly AssistantContentBlock[] }
  }): number {
    let n = 0
    for (const pm of processMessagesWithBlocks(seg.processMessages)) {
      const blocks = pm.content
      if (!Array.isArray(blocks)) continue
      for (const b of blocks) if (b.type === 'toolCall') n++
    }
    for (const b of seg.processGroup.finalProcessBlocks) if (b.type === 'toolCall') n++
    return n
  }

  /**
   * 把 tool role / toolResult 消息按 toolCallId 聚合成 Map,传给 MessageView → ToolCallBlock。
   * apps/web 同形态:toolResultsMap。tool role message 本身不直接渲染(由 v-if 过滤),
   * 但其 result content 通过这个 Map 注入到对应 assistant toolCall block 的 ToolCallBlock 组件。
   *
   * 重要修复(对应“展开只有 input 没有 result”的 bug):
   *  原实现是个空 Map(TODO 未填),导致 ToolCallBlock 总是 paired === undefined,
   *  于是 result 区域永远不渲染。fetchSessionMessages 现已按 SDK toolResult 形态
   *  保留 toolCallId/content blocks/isError,这里按 toolCallId 聚合:
   *    - key: toolCallId(SDK 中 call_xxx)
   *    - value: { toolCallId, isError, content:[{type:'text', text}] }
   *  ToolCallBlock 读取 .content 作为 result 输出。
   */
  const pairedResultsByToolCallId = computed<ReadonlyMap<string, unknown>>(() => {
    const map = new Map<string, unknown>()
    for (const m of messages.value) {
      if (m.role !== 'toolResult') continue
      const id = m.toolCallId
      if (!id) continue
      // content 现为拍扁 string(是 SDK wire 形态拍扁后)。不过 SDK 原形态是数组,
      // 暂不保留数组形态(下轮增加 toolResult content 保留后升级为数组)。
      // 这里 ToolCallBlock 只读 .content 作为显示文本,两者都 OK。
      map.set(id, {
        toolCallId: id,
        isError: m.toolIsError ?? false,
        content: m.content
      })
    }
    return map
  })

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
    <!-- 消息列表:渲染回合聚合后的 segments(每个回合一个 user + 一个折叠的
         ProcessDetailsGroup + finalAssistant 的 answerBlocks)。流式尾巴直接
         按单消息渲染,不聚合。tool role 不直接显示(其结果通过
         pairedResultsByToolCallId 注入 ToolCallBlock)。 -->
    <el-scrollbar ref="messagesScrollRef" class="wb-messages">
      <template v-for="seg in renderSegments" :key="seg.key">
        <!-- 单消息片段 -->
        <MessageView
          v-if="seg.kind === 'message'"
          :message="seg.message"
          :branches="branchesByMessage.get(seg.message.id) ?? []"
          :model-names="modelNames"
          :entry-id="messageContext.get(seg.message.id)?.entryId"
          :prev-assistant-entry-id="messageContext.get(seg.message.id)?.prevAssistantEntryId"
          :is-streaming="isStreaming"
          :paired-results="pairedResultsByToolCallId"
          @branch-switch="onBranchSwitch"
          @tool-expand="onToolExpand"
          @retry="onRetry"
          @copy="onCopy"
          @edit="onEdit"
          @fork="onFork"
          @navigate="onNavigate"
        />

        <!-- 回合:user + ProcessDetailsGroup(process messages + finalAssistant process) +
             finalAssistant answerBlocks -->
        <template v-else>
          <!-- user 消息 -->
          <MessageView
            :message="seg.user"
            :branches="branchesByMessage.get(seg.user.id) ?? []"
            :model-names="modelNames"
            :entry-id="messageContext.get(seg.user.id)?.entryId"
            :prev-assistant-entry-id="messageContext.get(seg.user.id)?.prevAssistantEntryId"
            :is-streaming="isStreaming"
            :paired-results="pairedResultsByToolCallId"
            @branch-switch="onBranchSwitch"
            @tool-expand="onToolExpand"
            @retry="onRetry"
            @copy="onCopy"
            @edit="onEdit"
            @fork="onFork"
            @navigate="onNavigate"
          />

          <!-- 折叠区:中间过程消息 + finalAssistant 的 processBlocks -->
          <ProcessDetailsGroup
            v-if="
              seg.processGroup.processIndices.length > 0 ||
              seg.processGroup.finalProcessBlocks.length > 0
            "
            :message-count="
              seg.processGroup.processIndices.length +
              (seg.processGroup.finalProcessBlocks.length > 0 ? 1 : 0)
            "
            :tool-call-count="countTurnToolCalls(seg)"
          >
            <MessageView
              v-for="(pm, pi) in processMessagesWithBlocks(seg.processMessages)"
              :key="`process-${seg.key}-${pi}`"
              :message="pm"
              :branches="branchesByMessage.get(pm.id) ?? []"
              :model-names="modelNames"
              :entry-id="messageContext.get(pm.id)?.entryId"
              :prev-assistant-entry-id="messageContext.get(pm.id)?.prevAssistantEntryId"
              :is-streaming="isStreaming"
              :paired-results="pairedResultsByToolCallId"
              :suppress-process-group="true"
              :show-chrome="false"
              :show-timestamp="false"
              @branch-switch="onBranchSwitch"
              @tool-expand="onToolExpand"
              @retry="onRetry"
              @copy="onCopy"
              @edit="onEdit"
              @fork="onFork"
              @navigate="onNavigate"
            />
            <!-- finalAssistant 的 processBlocks(如 processMessagesWithBlocks 为空但 finalAssistant 还有 process) -->
            <MessageView
              v-if="
                seg.processGroup.finalProcessBlocks.length > 0 &&
                processMessagesWithBlocks(seg.processMessages).length === 0
              "
              :message="
                withAssistantBlocks(getFinalAssistant(seg), seg.processGroup.finalProcessBlocks, {
                  omitUsage: true
                })
              "
              :model-names="modelNames"
              :suppress-process-group="true"
              :show-chrome="false"
              :show-timestamp="false"
              :paired-results="pairedResultsByToolCallId"
            />
          </ProcessDetailsGroup>

          <!-- finalAssistant 的 answerBlocks(独立渲染) -->
          <MessageView
            v-if="seg.processGroup.finalAnswerBlocks.length > 0"
            :message="
              withAssistantBlocks(getFinalAssistant(seg), seg.processGroup.finalAnswerBlocks)
            "
            :branches="branchesByMessage.get(getFinalAssistant(seg).id) ?? []"
            :model-names="modelNames"
            :entry-id="messageContext.get(getFinalAssistant(seg).id)?.entryId"
            :prev-assistant-entry-id="
              messageContext.get(getFinalAssistant(seg).id)?.prevAssistantEntryId
            "
            :is-streaming="isStreaming"
            :paired-results="pairedResultsByToolCallId"
            :suppress-process-group="true"
            @branch-switch="onBranchSwitch"
            @tool-expand="onToolExpand"
            @retry="onRetry"
            @copy="onCopy"
            @edit="onEdit"
            @fork="onFork"
            @navigate="onNavigate"
          />

          <!-- finalAssistant 但没有 answerBlocks(没有最终 text/image)的情况:
               如果整个回合都没有 process 也没有 answer,什么都不渲染(极端边缘);
               否则 finalAssistant 的所有内容已经通过 process 区域渲染,这里跳过。 -->
          <!-- 注:回合聚合 buildRenderSegments 已保证 finalAssistantIdx 必然存在,
               且 processGroup 不为空,answerBlocks 会在 finalAssistant.content
               完全只有 thinking/toolCall 时为空(此时全部走 process 路径)。-->
        </template>
      </template>

      <!-- 空状态 -->
      <div v-if="readonlyMessages.length === 0" class="wb-empty">
        <div class="wb-empty__icon">💬</div>
        <div class="wb-empty__title">{{ sessionId ? '开始对话' : '请选择一个会话' }}</div>
        <div class="wb-empty__hint">在下方输入框输入消息,按 Enter 发送,Shift+Enter 换行</div>
      </div>

      <!-- 滚动锚点:这个 div 保留以供将来 scrollIntoView 备用;
           当前滚动逻辑是直接对 .wb-messages .el-scrollbar__wrap 设 scrollTop
           (Vue 端 el-scrollbar wrap 是 absolute 布局,scrollIntoView 在该
           场景下有时停在中间位置~125px 差,直接 wrap.scrollTop = scrollHeight
           更可靠)。 -->
      <div class="wb-chat-window__anchor" />
    </el-scrollbar>

    <!-- ChatInput 由父级通过 slot 注入 -->
    <slot
      name="input"
      :send-message="sendMessage"
      :abort="abort"
      :is-streaming="isStreaming"
      :queue-items="queueItems"
      :cancel-queue="cancelQueue"
    />
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
