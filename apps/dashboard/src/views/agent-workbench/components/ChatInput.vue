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
  import { ElButton, ElInput, ElIcon } from 'element-plus'
  import { Promotion, CircleClose } from '@element-plus/icons-vue'
  import { useAgentSession } from '../composables/useAgentSession'
  import { getToolNamesForPreset } from '@/api/agent'
  import type { SlashCommandPaletteItem, ToolPreset } from '../types'
  import { BUILTIN_SLASH_COMMANDS } from '../slash/builtin'
  import ModelSelector from './ModelSelector.vue'
  import ThinkingLevelSelector from './ThinkingLevelSelector.vue'
  import ToolPresetSelector from './ToolPresetSelector.vue'
  import SlashPalette from './SlashPalette.vue'

  interface Props {
    disabled?: boolean
    placeholder?: string
    sessionId: string
    isStreaming?: boolean
  }

  const props = withDefaults(defineProps<Props>(), {
    disabled: false,
    placeholder: '输入消息，支持 /<skill> 或 @MCP 调用...',
    isStreaming: false
  })

  const emit = defineEmits<{
    send: [text: string, attachments: File[]]
    abort: []
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
  const attachments = ref<File[]>([])
  const isDragOver = ref(false)
  const historyCursor = ref<number>(-1) // -1 = 不在历史模式
  const historyDraft = ref('') // 进入历史模式时保存的当前 draft,退出时还原

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

  // —— 键盘 ——
  function onKeydown(evt: Event | KeyboardEvent): void {
    const e = evt as KeyboardEvent
    // T5.3:slash palette 打开时,面板专属键(ArrowUp/ArrowDown/Enter/Escape)优先拦截;
    // 其它键 fall through 让 inputText 继续更新(用户能在面板打开时继续打字)。
    // 结构与 T6 IME 守卫解耦:T6 会在本块之后、既有 Enter/steer/followUp/history 逻辑
    // 之前插入 `if (isComposing.value) return`,此处不要把面板逻辑与 IME 耦合。
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
</script>

<template>
  <div class="wb-chat-input" :class="{ 'wb-chat-input--drag': isDragOver }">
    <!-- chrome v1 B7:streaming 队列条(slot 由父级填充 StreamingQueueBar) -->
    <slot name="queue" />

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

    <!-- 状态条(model / thinking / tool preset)—— chrome v1 B 组 -->
    <footer
      class="wb-chat-input__statusbar"
      :class="{ 'is-disabled': isStreaming }"
      data-testid="wb-chat-input-statusbar"
    >
      <ModelSelector
        :model="currentModel"
        :model-list="modelList"
        :model-names="modelNames"
        :is-auto="isAutoModelSelection"
        @update:model="(p, m) => setModel(p, m)"
      />
      <ThinkingLevelSelector
        :level="thinkingLevel"
        :available-levels="availableThinkingLevelsForCurrentModel"
        @update:level="handleThinkingLevelChange"
      />
      <ToolPresetSelector :preset="toolPreset" @update:preset="handlePresetChange" />
    </footer>

    <!-- 输入框 -->
    <el-input
      v-model="inputText"
      type="textarea"
      :rows="3"
      :placeholder="placeholder"
      :disabled="disabled"
      class="wb-chat-input__textarea"
      @keydown="onKeydown"
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

    <!-- 操作 -->
    <div class="wb-chat-input__actions">
      <template v-if="isStreaming">
        <el-button type="danger" plain @click="handleAbort">
          <el-icon class="el-icon--left"><CircleClose /></el-icon>
          停止
        </el-button>
      </template>
      <template v-else>
        <el-button
          type="primary"
          :disabled="disabled || (!inputText.trim() && attachments.length === 0)"
          @click="handleSend"
        >
          <el-icon class="el-icon--left"><Promotion /></el-icon>
          发送 (Enter)
        </el-button>
      </template>
    </div>

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
    border-radius: 8px;
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
    border-radius: 8px;
  }

  /* chrome v1 B 组:状态条 —— 横向布局,8px 间距 */
  .wb-chat-input__statusbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 12px;
    color: var(--wb-text-dim);
  }

  .wb-chat-input__statusbar.is-disabled {
    pointer-events: none;
    opacity: 0.5;
  }
</style>
