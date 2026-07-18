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
   */
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import { ElButton, ElInput, ElIcon } from 'element-plus'
  import { Promotion, CircleClose } from '@element-plus/icons-vue'

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
    // Enter:发送(Shift+Enter 换行,留作浏览器默认行为)
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      void handleSend()
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
</style>
