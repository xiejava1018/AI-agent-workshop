<script setup lang="ts">
  /**
   * ChatInput —— 消息输入区(等价 apps/web/components/ChatInput.tsx)。
   *
   * Vue 端 v1 实现:
   *   - el-input type=textarea 多行
   *   - 附件拖拽(dragover / drop / 文件预览列表)
   *   - 文本历史(↑↓ 翻历史,localStorage 存最近 50 条)
   *   - 快捷键:Enter 发送,Shift+Enter 换行,@ 提示 mention(占位,不实际触发)
   *   - streaming 时按钮变「停止」,点击调 abort()
   *
   * chrome v1(B 组):底部状态条 —— 三档控件(model / thinking / tool preset),
   *   仅展示 + emit,实际 setModel / setThinkingLevel / setTools 由父级传下来的
   *   useAgentSession 方法处理。streaming 时整体禁用避免中途切换状态。
   *
   * chrome v1(B7):streaming 期间通过 `<slot name="queue" />` 让父级注入
   *   `StreamingQueueBar`,显示 steer / followUp 队列项。
   *   Enter = send(已有);Shift+Enter = steer;Cmd/Ctrl+Enter = followUp。
   */
  import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
  import { ElInput } from 'element-plus'
  import { useAgentSession } from '../composables/useAgentSession'
  import { getToolNamesForPreset } from '@/api/agent'
  import type { SlashCommandPaletteItem, ToolPreset } from '../types'
  import { BUILTIN_SLASH_COMMANDS } from '../slash/builtin'
  import ModelSelector from './ModelSelector.vue'
  import ThinkingLevelSelector from './ThinkingLevelSelector.vue'
  import ToolPresetSelector from './ToolPresetSelector.vue'
  import CompactButton from './CompactButton.vue'
  import SoundToggleButton from './SoundToggleButton.vue'
  import SlashPalette from './SlashPalette.vue'

  interface Props {
    disabled?: boolean
    placeholder?: string
    sessionId: string
    isStreaming?: boolean
    /**
     * 上下文压缩状态:对齐 apps/web 的 onCompact / onAbortCompaction /
     * isCompacting / compactError。提供三个状态以同步 ChatWindow 中的压缩流程,
     * 业务逻辑由父级 ChatWindow 调用后端。
     */
    isCompacting?: boolean
    compactError?: string | null
    /**
     * 完成提示音开关:对齐 apps/web useAudio()。
     * 持久化在 localStorage('pi-sound-enabled')。父级可选传,未传则隐藏按钮。
     */
    soundEnabled?: boolean
    /**
     * 是否启用 compact 功能。若 false(默认),底部不显示 CompactButton。
     * 这是一个“能力开关”,区分“有别的会话/接口能调 compact”与“现在不能调 compact”。
     */
    compactEnabled?: boolean
  }

  const props = withDefaults(defineProps<Props>(), {
    disabled: false,
    placeholder: '输入消息，支持 /<skill> 或 @MCP 调用...',
    isStreaming: false,
    isCompacting: false,
    compactError: null,
    soundEnabled: true,
    compactEnabled: false
  })

  const emit = defineEmits<{
    send: [text: string, attachments: File[]]
    abort: []
    /** 点击 Compact 按钮(未在压缩) —— 父级调 handleCompact */
    compact: []
    /** 点击运行中 Compact 按钮 —— 父级调 handleAbortCompaction */
    'abort-compact': []
    /** 点击 Sound 按钮 —— 父级维护 soundEnabled 状态(或委托给本组件 useAudio) */
    'update:soundEnabled': [enabled: boolean]
  }>()

  // —— chrome v1:状态条 + queue 条所需 useAgentSession 状态 ——
  const userId = localStorage.getItem('user_id') || ''
  const {
    modelList,
    modelNames,
    currentModel,
    isAutoModelSelection,
    thinkingLevel,
    availableThinkingLevels,
    toolPreset,
    setModel,
    setThinkingLevel,
    setTools,
    refreshTools,
    sendSteer,
    sendFollowUp,
    slashCommands,
    loadSlashCommands
  } = useAgentSession(props.sessionId, userId)

  /** 当前模型限定可用的 thinking level 子集;无数据时让子组件走默认全集 */
  const availableThinkingLevelsForCurrentModel = computed<string[]>(() => {
    if (!currentModel.value) return []
    const key = `${currentModel.value.provider}:${currentModel.value.modelId}`
    return availableThinkingLevels.value?.[key] ?? []
  })

  /** Tool preset 切换:setTools(走 preset 常量映射) → refreshTools 同步本地 */
  async function handlePresetChange(preset: ToolPreset): Promise<void> {
    await setTools(getToolNamesForPreset(preset))
    await refreshTools()
  }

  /** Thinking level 切换:narrow string → ThinkingLevel 联合 */
  async function handleThinkingLevelChange(level: string): Promise<void> {
    const allowed = [
      'auto',
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max'
    ] as const
    if ((allowed as readonly string[]).includes(level)) {
      await setThinkingLevel(level as (typeof allowed)[number])
    }
  }

  // —— Refs ——
  const inputText = ref('')
  // el-input 实例引用,用于 fill()/focus() 等命令式操作(如「编辑」按钮把消息灌回输入框)
  const inputRef = ref<InstanceType<typeof ElInput> | null>(null)
  const attachments = ref<File[]>([])
  const isDragOver = ref(false)
  const historyCursor = ref<number>(-1) // -1 = 不在历史模式
  const historyDraft = ref('') // 进入历史模式时保存的当前 draft,退出时还原

  // IME 组合输入状态(T6.1):compositionstart 置 true,compositionend 置 false。
  // onKeydown 顶部据此放行,避免中文拼音按 Enter 确认候选时误触发 handleSend。
  const isComposing = ref(false)

  // 文本历史(从 localStorage)
  const HISTORY_KEY = 'wb-chat-input-history'
  const HISTORY_LIMIT = 50
  const textHistory = ref<string[]>([])

  function loadHistory(): void {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          textHistory.value = parsed
            .filter((x): x is string => typeof x === 'string')
            .slice(-HISTORY_LIMIT)
        }
      }
    } catch {
      /* ignore */
    }
  }

  function saveHistory(): void {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(textHistory.value.slice(-HISTORY_LIMIT)))
    } catch {
      /* ignore */
    }
  }

  function pushHistory(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    // 去重(连续相同内容不重复保存)
    if (textHistory.value[textHistory.value.length - 1] === trimmed) return
    textHistory.value.push(trimmed)
    if (textHistory.value.length > HISTORY_LIMIT) {
      textHistory.value = textHistory.value.slice(-HISTORY_LIMIT)
    }
    saveHistory()
  }

  // —— Mention hint ——
  const showMentionHint = computed(() => inputText.value.endsWith('@'))

  // —— Slash palette(T5.3)——
  // builtin + session commands 合并(去重),统一转成 palette item shape
  const slashActiveIndex = ref(0)
  // 用户按 Escape 或外部 close 触发的手动关闭标志;inputText 变化时由下方 watch 重置,
  // 让用户重新输入 / 后能再次打开面板。避免向只读 computed isSlashPaletteOpen 赋值。
  const slashPaletteClosed = ref(false)

  /** builtin + useAgentSession.slashCommands 合并,转成 SlashCommandPaletteItem[] */
  const mergedSlashCommands = computed<SlashCommandPaletteItem[]>(() => {
    const seen = new Set<string>()
    const out: SlashCommandPaletteItem[] = []
    for (const cmd of BUILTIN_SLASH_COMMANDS) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name)
        out.push(cmd)
      }
    }
    for (const cmd of slashCommands.value) {
      if (seen.has(cmd.name)) continue
      seen.add(cmd.name)
      out.push({
        name: cmd.name,
        aliases: [],
        description: cmd.description ?? '',
        source: cmd.source === 'builtin' ? 'builtin' : cmd.source
      })
    }
    return out
  })

  /**
   * 3 档模糊匹配:
   * 1) 精确前缀(name / aliases 都查)
   * 2) 包含
   * 3) 字符级子序列(query 字符按顺序在 name 中出现)
   * query 已包含前导 "/"(例如 "/com"),直接 match。
   * palette 在 query 长度 <= 1(只有 "/")时显示全部 4 项 builtin。
   */
  const slashVisibleItems = computed<SlashCommandPaletteItem[]>(() => {
    const q = inputText.value
    if (!q.startsWith('/')) return []
    if (q.length <= 1) return mergedSlashCommands.value

    const lc = q.toLowerCase()
    const exactPrefix: SlashCommandPaletteItem[] = []
    const contains: SlashCommandPaletteItem[] = []
    const subsequence: SlashCommandPaletteItem[] = []

    const matchesPrefix = (item: SlashCommandPaletteItem): boolean =>
      item.name.toLowerCase().startsWith(lc) ||
      item.aliases.some((a) => a.toLowerCase().startsWith(lc))

    const matchesContains = (item: SlashCommandPaletteItem): boolean =>
      item.name.toLowerCase().includes(lc) ||
      item.aliases.some((a) => a.toLowerCase().includes(lc))

    const matchesSubsequence = (item: SlashCommandPaletteItem): boolean => {
      const name = item.name.toLowerCase()
      let pi = 0
      for (let i = 0; i < name.length && pi < lc.length; i++) {
        if (name[i] === lc[pi]) pi++
      }
      return pi === lc.length
    }

    for (const item of mergedSlashCommands.value) {
      if (matchesPrefix(item)) exactPrefix.push(item)
      else if (matchesContains(item)) contains.push(item)
      else if (matchesSubsequence(item)) subsequence.push(item)
    }
    return [...exactPrefix, ...contains, ...subsequence]
  })

  /** palette 打开条件:以 "/" 开头且长度 > 1,且未被手动关闭(参考 B8 spec) */
  const isSlashPaletteOpen = computed(
    () =>
      inputText.value.startsWith('/') &&
      inputText.value.length > 1 &&
      !slashPaletteClosed.value
  )

  // inputText 变化时:1) 清掉手动关闭标志(让重新输入 / 能再次打开);
  // 2) activeIndex 越界时拉回 0 防止空指针。
  watch(inputText, () => {
    slashPaletteClosed.value = false
    if (slashActiveIndex.value >= slashVisibleItems.value.length) {
      slashActiveIndex.value = 0
    }
  })

  /** 选择 slash 项后填充 inputText(name + 末尾空格) */
  function onSlashSelect(item: SlashCommandPaletteItem): void {
    inputText.value = item.name + ' '
  }

  /** 关闭面板(Escape 或 SlashPalette @close 兜底)。不直接写 isSlashPaletteOpen(只读 computed)。 */
  function closeSlashPalette(): void {
    slashPaletteClosed.value = true
  }

  // —— 发送 ——
  async function handleSend(): Promise<void> {
    if (props.isStreaming) return // streaming 时按钮是「停止」,不发
    if (props.disabled) return
    const text = inputText.value
    if (!text.trim() && attachments.value.length === 0) return

    // 复制数组后清空(emit 出去的 attachments 不能被 reactive 包装影响)
    const files = attachments.value.slice()
    pushHistory(text)
    inputText.value = ''
    attachments.value = []
    historyCursor.value = -1
    emit('send', text, files)
  }

  function handleAbort(): void {
    emit('abort')
  }

  // —— IME 组合输入保护(T6.1)——
  function onCompositionStart(): void {
    isComposing.value = true
  }

  function onCompositionEnd(): void {
    isComposing.value = false
  }

  // —— 键盘 ——
  function onKeydown(evt: Event | KeyboardEvent): void {
    const e = evt as KeyboardEvent
    // IME 保护:组合输入期间(中文拼音未确认)放行浏览器/IME 默认行为。
    // 必须在 slash palette 块之前 —— 组合期间方向键等应交给 IME 候选,而非移动 palette activeIndex。
    if (isComposing.value) return
    // T5.3:slash palette 打开时,面板专属键(ArrowUp/ArrowDown/Enter/Escape)优先拦截;
    // 其它键 fall through 让 inputText 继续更新(用户能在面板打开时继续打字)。
    if (isSlashPaletteOpen.value) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const n = slashVisibleItems.value.length
        if (n > 0) {
          slashActiveIndex.value = (slashActiveIndex.value + 1) % n
        }
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        const n = slashVisibleItems.value.length
        if (n > 0) {
          // 循环减一:(-1 + n) % n = n - 1,避免 JS 负数取模负值
          slashActiveIndex.value = (slashActiveIndex.value - 1 + n) % n
        }
        return
      }
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        const item = slashVisibleItems.value[slashActiveIndex.value]
        if (item) {
          e.preventDefault()
          onSlashSelect(item)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeSlashPalette()
        return
      }
      // 其它键(字符输入 / Tab 等)fall through,让 inputText 继续更新
    }
    // Enter:发送(Shift+Enter 换行,留作浏览器默认行为)
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      void handleSend()
      return
    }
    // chrome v1 B7:Shift+Enter = steer(抢断当前 assistant 轮),仅 streaming 时有效
    if (e.key === 'Enter' && e.shiftKey) {
      if (!props.isStreaming) return // 非 streaming 时退回默认换行
      e.preventDefault()
      const text = inputText.value
      if (!text.trim() && attachments.value.length === 0) return
      void sendSteer(text, attachments.value.slice())
      return
    }
    // chrome v1 B7:Cmd/Ctrl+Enter = followUp(等当前轮结束再发),仅 streaming 时有效
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      if (!props.isStreaming) return
      e.preventDefault()
      const text = inputText.value
      if (!text.trim() && attachments.value.length === 0) return
      void sendFollowUp(text, attachments.value.slice())
      return
    }
    // ↑↓ 翻历史
    if (e.key === 'ArrowUp' && textHistory.value.length > 0) {
      e.preventDefault()
      if (historyCursor.value === -1) {
        // 进入历史模式,保存当前 draft
        historyDraft.value = inputText.value
        historyCursor.value = textHistory.value.length
      }
      if (historyCursor.value > 0) {
        historyCursor.value -= 1
        const value = textHistory.value[historyCursor.value]
        if (value !== undefined) inputText.value = value
      }
      return
    }
    if (e.key === 'ArrowDown' && historyCursor.value !== -1) {
      e.preventDefault()
      if (historyCursor.value < textHistory.value.length - 1) {
        historyCursor.value += 1
        const value = textHistory.value[historyCursor.value]
        if (value !== undefined) inputText.value = value
      } else {
        // 退出历史模式,恢复 draft
        historyCursor.value = -1
        inputText.value = historyDraft.value
      }
      return
    }
  }

  // —— 拖拽 ——
  function onDragEnter(e: DragEvent): void {
    e.preventDefault()
    if (props.disabled || props.isStreaming) return
    isDragOver.value = true
  }

  function onDragOver(e: DragEvent): void {
    e.preventDefault()
    if (props.disabled || props.isStreaming) return
    isDragOver.value = true
  }

  function onDragLeave(e: DragEvent): void {
    e.preventDefault()
    isDragOver.value = false
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    isDragOver.value = false
    if (props.disabled || props.isStreaming) return
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return
    addAttachments(Array.from(files))
  }

  function addAttachments(files: File[]): void {
    for (const f of files) {
      if (!attachments.value.find((a) => a.name === f.name && a.size === f.size)) {
        attachments.value.push(f)
      }
    }
  }

  function removeAttachment(idx: number): void {
    attachments.value.splice(idx, 1)
  }

  onMounted(() => {
    loadHistory()
    void loadSlashCommands()
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
  })

  onUnmounted(() => {
    window.removeEventListener('dragenter', onDragEnter)
    window.removeEventListener('dragover', onDragOver)
    window.removeEventListener('dragleave', onDragLeave)
    window.removeEventListener('drop', onDrop)
  })

  /**
   * 命令式填充输入框(对齐 apps/web ChatInput.insertIfEmpty):
   * 当输入框为空时,把 text 灌进去并聚焦,光标定位到末尾。
   * 用于 MessageView「编辑」按钮 —— 把被编辑的消息内容回填到输入框,用户改完再重发。
   * 输入框已有内容时不覆盖(避免误吞用户正在打的内容),仅聚焦。
   */
  function fill(text: string): void {
    if (!text) return
    if (!inputText.value.trim()) {
      inputText.value = text
      slashPaletteClosed.value = true
    }
    // 聚焦并把光标移到末尾(el-input 暴露 focus + textarea 原生 setSelectionRange)
    requestAnimationFrame(() => {
      const el = inputRef.value
      const ta = el?.textarea ?? el?.$el?.querySelector('textarea')
      if (ta && typeof (ta as HTMLTextAreaElement).focus === 'function') {
        const node = ta as HTMLTextAreaElement
        node.focus()
        const len = node.value.length
        node.setSelectionRange(len, len)
      }
    })
  }

  defineExpose({
    fill
  })
</script>

<template>
  <div class="wb-chat-input" :class="{ 'wb-chat-input--drag': isDragOver }">
    <!-- chrome v1 B7:streaming 队列条(slot 由父级填充 StreamingQueueBar) -->
    <div role="region" aria-label="Queued messages">
      <slot name="queue" />
    </div>

    <!-- 附件列表 -->
    <div v-if="attachments.length > 0" class="wb-chat-input__attachments">
      <span
        v-for="(file, idx) in attachments"
        :key="`${file.name}-${idx}`"
        class="wb-chat-input__attachment"
      >
        {{ file.name }}
        <button
          type="button"
          class="wb-chat-input__attachment-remove"
          :aria-label="`移除 ${file.name}`"
          @click="removeAttachment(idx)"
        >
          ×
        </button>
      </span>
    </div>

    <!-- 主输入区:带边框 + 圆角的 composer,包住 textarea + 发送/停止按钮
         (对齐 apps/web ChatInput 的 borderRadius:14 / 微阴影 容器) -->
    <div
      class="wb-chat-input__composer"
      :class="{ 'is-streaming': isStreaming }"
    >
      <el-input
        ref="inputRef"
        v-model="inputText"
        type="textarea"
        :rows="1"
        :placeholder="placeholder"
        :disabled="disabled"
        class="wb-chat-input__textarea"
        @keydown="onKeydown"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
      />

      <!-- T5:slash palette(以 "/" 开头且长度 > 1 时打开) -->
      <SlashPalette
        v-if="isSlashPaletteOpen"
        :query="inputText"
        :items="slashVisibleItems"
        :active-index="slashActiveIndex"
        @select="onSlashSelect"
        @update:active-index="(i: number) => (slashActiveIndex = i)"
        @close="closeSlashPalette"
      />

      <!-- @mention 提示(v1 占位) -->
      <div v-if="showMentionHint" class="wb-chat-input__mention-hint"> @ mention(即将推出) </div>

      <!-- 发送 / 停止按钮:贴 composer 右下角 -->
      <div class="wb-chat-input__send">
        <template v-if="isStreaming">
          <button
            type="button"
            class="wb-chat-input__send-btn wb-chat-input__send-btn--stop"
            title="停止生成"
            aria-label="停止生成"
            @click="handleAbort"
          >
            <svg
              class="wb-chat-input__send-icon"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="8" height="8" rx="1" />
            </svg>
            停止
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="wb-chat-input__send-btn wb-chat-input__send-btn--send"
            :class="{ 'is-disabled': disabled || (!inputText.trim() && attachments.length === 0) }"
            :disabled="disabled || (!inputText.trim() && attachments.length === 0)"
            title="发送 (Enter)"
            aria-label="发送消息"
            @click="handleSend"
          >
            <svg
              class="wb-chat-input__send-icon"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="2" y1="7" x2="11" y2="7" />
              <polyline points="7.5 3 12 7 7.5 11" />
            </svg>
            发送
          </button>
        </template>
      </div>
    </div>

    <!-- 底部操作栏:对齐 apps/web —— LEFT model | center spacer | RIGHT thinking + tools preset
         (位于输入框下方,而不是上方) -->
    <footer
      class="wb-chat-input__toolbar"
      :class="{ 'is-disabled': isStreaming }"
      data-testid="wb-chat-input-statusbar"
    >
      <div class="wb-chat-input__toolbar-left">
        <ModelSelector
          :model="currentModel"
          :model-list="modelList"
          :model-names="modelNames"
          :is-auto="isAutoModelSelection"
          @update:model="(p, m) => setModel(p, m)"
        />
      </div>
      <div class="wb-chat-input__toolbar-right">
        <!-- tools preset 在 streaming 时被 apps/web 的 `!isStreaming && onCompact` 隐蔽 。”
         * 在 dashboard 我们保留三个 always-visible 的主要选择器(thinking / tools),仅在
         * streaming 时用 disabled 状态让点击不发声,避免 UI 跳动。 -->
        <ThinkingLevelSelector
          :level="thinkingLevel"
          :available-levels="availableThinkingLevelsForCurrentModel"
          :disabled-by-streaming="isStreaming"
          @update:level="handleThinkingLevelChange"
        />
        <ToolPresetSelector
          :preset="toolPreset"
          :disabled-by-streaming="isStreaming"
          @update:preset="handlePresetChange"
        />
        <!-- Compact 按钮:仅在父级开关为 true 时显示。
         * apps/web 里 onCompact 为 undefined 就隐藏(试用账号/未登录状态)。 -->
        <CompactButton
          v-if="compactEnabled"
          :is-compacting="isCompacting"
          :compact-error="compactError"
          :disabled-by-streaming="isStreaming"
          @compact="emit('compact')"
          @abort-compact="emit('abort-compact')"
        />
        <!-- Sound 按钮:soundEnabled 作为 v-model,本地 persist 到 localStorage -->
        <SoundToggleButton
          :sound-enabled="soundEnabled"
          @update:sound-enabled="(v: boolean) => emit('update:soundEnabled', v)"
        />
      </div>
    </footer>

    <!-- 拖拽覆盖层 -->
    <div v-if="isDragOver" class="wb-chat-input__drag-overlay"> 松开鼠标上传文件 </div>
  </div>
</template>

<style scoped>
  .wb-chat-input {
    position: relative;
  }

  .wb-chat-input--drag {
    outline: 2px dashed var(--wb-accent);
    outline-offset: -4px;
    border-radius: 14px;
  }

  .wb-chat-input__drag-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(74, 144, 226, 0.12);
    color: var(--wb-accent);
    font-weight: 600;
    font-size: 14px;
    pointer-events: none;
    border-radius: 14px;
    z-index: 2;
  }

  /*
   * composer:带边框 + 圆角的容器,包住 textarea + 发送按钮(对齐 apps/web ChatInput)。
   *   - borderRadius:14、padding:10px、轻微 boxShadow。
   *   - 流式状态下边框变黄,与 apps/web 的流式边框表现一致。
   *   - textarea 吃 flex:1,send 按钮贴右下角(align-self:flex-end)。
   */
  .wb-chat-input__composer {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    background: var(--wb-bg, #fff);
    border: 1px solid
      color-mix(in srgb, var(--wb-border) 70%, transparent);
    border-radius: 12px;
    padding: 6px 8px 6px 12px;
    box-shadow:
      0 1px 2px rgba(15, 23, 42, 0.04),
      0 4px 16px -10px rgba(15, 23, 42, 0.08);
    transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
  }
  .wb-chat-input__composer.is-streaming {
    border-color: rgba(234, 179, 8, 0.4);
  }

  /* textarea 在 composer 内去掉自身的边框/背景,只保留文字输入能力 */
  .wb-chat-input__textarea {
    flex: 1;
    min-width: 0;
  }
  .wb-chat-input__textarea :deep(.el-textarea__inner) {
    background: transparent;
    border: none;
    box-shadow: none;
    padding: 2px 0;
    resize: none;
    color: var(--wb-text, inherit);
    font-size: 14px;
    line-height: 1.6;
    font-family: inherit;
    min-height: 24px;
    max-height: 200px;
    overflow-y: auto;
  }
  .wb-chat-input__textarea :deep(.el-textarea__inner):focus {
    outline: none;
  }
  .wb-chat-input__textarea :deep(.el-textarea__inner)::placeholder {
    color: var(--wb-text-dim);
  }

  /* 发送 / 停止按钮:对齐 apps/web 的 Send 按钮
   *   - flex-shrink:0、align-self:flex-end(贴右下角)
   *   - 有内容 → accent 背景白字;空内容 → panel 背景 dim 文字(禁用样式) */
  .wb-chat-input__send {
    flex-shrink: 0;
    align-self: flex-end;
    display: flex;
    align-items: center;
  }
  .wb-chat-input__send-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition: background 150ms ease, color 150ms ease, box-shadow 150ms ease;
  }
  .wb-chat-input__send-btn--send {
    background: var(--wb-accent, #3b82f6);
    color: #fff;
    box-shadow: 0 1px 3px rgba(37, 99, 235, 0.25);
  }
  .wb-chat-input__send-btn--send:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .wb-chat-input__send-btn--send.is-disabled,
  .wb-chat-input__send-btn--send:disabled {
    background: var(--wb-bg-elevated, #f3f4f6);
    color: var(--wb-text-dim);
    cursor: not-allowed;
    box-shadow: none;
  }
  .wb-chat-input__send-btn--stop {
    background: rgba(234, 179, 8, 0.12);
    color: rgb(180, 130, 0);
    border: 1px solid rgba(234, 179, 8, 0.35);
  }
  .wb-chat-input__send-btn--stop:hover {
    background: rgba(234, 179, 8, 0.2);
  }
  .wb-chat-input__send-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  /* slash palette 在 composer 内绝对定位到顶部(在 textarea 上方) */
  .wb-chat-input__mention-hint {
    position: absolute;
    top: -22px;
    left: 14px;
    font-size: 11px;
    color: var(--wb-text-dim);
    background: var(--wb-bg, #fff);
    padding: 0 6px;
    border-radius: 3px;
  }

  /*
   * 底部操作栏:对齐 apps/web —— LEFT model | center spacer | RIGHT thinking + tools preset。
   * model 在左侧、其它控件在右侧两端分布,保留顶部的状态指示作用。
   */
  .wb-chat-input__toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
    padding: 0 4px;
    font-size: 12px;
    color: var(--wb-text-dim);
    min-height: 24px;
  }
  .wb-chat-input__toolbar-left {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .wb-chat-input__toolbar-right {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
  }
  .wb-chat-input__toolbar.is-disabled {
    pointer-events: none;
    opacity: 0.5;
  }
</style>
