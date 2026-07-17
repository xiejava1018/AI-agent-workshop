<template>
  <div class="agent-workbench">
    <!-- 左侧会话列表 -->
    <aside class="session-list">
      <div class="list-header">
        <span>会话列表</span>
        <el-button type="primary" size="small" @click="handleCreateSession">新建</el-button>
      </div>
      <el-scrollbar>
        <div
          v-for="session in sessions"
          :key="session.id"
          class="session-item"
          :class="{ active: session.id === currentSessionId }"
          @click="selectSession(session.id)"
        >
          <div class="session-title">{{ session.title || '新会话' }}</div>
          <div class="session-meta">{{ session.createdAt }}</div>
        </div>
      </el-scrollbar>
    </aside>

    <!-- 右侧对话区 -->
    <main class="chat-area">
      <!-- 消息列表 -->
      <el-scrollbar class="messages" ref="messagesScrollRef">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="message"
          :class="msg.role"
        >
          <div class="message-content">{{ msg.content }}</div>
        </div>
        <div v-if="isTyping" class="message assistant typing">
          <div class="message-content typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </el-scrollbar>

      <!-- 输入区 -->
      <div class="input-area">
        <el-input
          v-model="inputText"
          type="textarea"
          :rows="3"
          placeholder="输入消息，支持 /&lt;skill&gt; 或 @MCP 调用..."
          @keydown.enter.ctrl="handleSend"
        />
        <div class="input-actions">
          <el-button type="primary" :loading="isSending" @click="handleSend">
            发送 (Ctrl+Enter)
          </el-button>
        </div>
      </div>
    </main>

    <!-- 右侧工具面板 -->
    <aside class="tools-panel">
      <el-card header="当前Agent" class="agent-card">
        <div class="agent-info">
          <div class="agent-name">{{ currentAgent?.name || '未选择' }}</div>
          <div class="agent-desc">{{ currentAgent?.description }}</div>
        </div>
      </el-card>
      <el-card header="可用工具" class="tools-list">
        <el-tag v-for="tool in availableTools" :key="tool" size="small">{{ tool }}</el-tag>
      </el-card>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useAgentEvents } from '@/composables/useAgentEvents'
import { listSessions, createSession, sendMessage as apiSendMessage } from '@/api/agent'

const route = useRoute()
const sessionId = (route.params.id as string) || ''
const userId = localStorage.getItem('user_id') || ''

// SSE
const { events, isConnected, connect } = useAgentEvents(sessionId, userId)

// Refs
const messagesScrollRef = ref<{ wrap?: { scrollTop?: number; scrollHeight?: number } } | null>(null)

// State
const sessions = ref<Array<{ id: string; title: string; createdAt: string }>>([])
const currentSessionId = ref(sessionId)
const messages = ref<Array<{ role: 'user' | 'assistant'; content: string }>>([])
const inputText = ref('')
const isTyping = ref(false)
const isSending = ref(false)
const currentAgent = ref<{ name: string; description?: string } | null>(null)
const availableTools = ref<string[]>([])

// Load sessions
onMounted(async () => {
  try {
    const resp = await listSessions()
    sessions.value = resp.data?.items || []
  } catch {
    sessions.value = []
  }
  connect()
})

// Watch SSE events
watch(
  () => events.value,
  (newEvents) => {
    const last = newEvents[newEvents.length - 1]
    if (!last) return

    if (last.type === 'message') {
      messages.value.push({ role: 'assistant', content: last.content || '' })
      isTyping.value = false
    } else if (last.type === 'tool_update') {
      messages.value.push({
        role: 'assistant',
        content: `[tool] ${last.toolName}: ${JSON.stringify(last.toolInput)}`
      })
    } else if (last.type === 'prompt_done') {
      isTyping.value = false
    } else if (last.type === 'error') {
      messages.value.push({ role: 'assistant', content: `错误: ${last.content}` })
      isTyping.value = false
    }

    nextTick(() => {
      const el = messagesScrollRef.value?.wrap
      if (el) {
        el.scrollTop = el.scrollHeight
      }
    })
  },
  { deep: true }
)

async function handleSend() {
  if (!inputText.value.trim() || isSending.value) return
  const text = inputText.value
  inputText.value = ''
  messages.value.push({ role: 'user', content: text })
  isTyping.value = true
  isSending.value = true
  try {
    await apiSendMessage(currentSessionId.value, text, userId)
  } catch {
    messages.value.push({ role: 'assistant', content: '发送失败，请重试' })
    isTyping.value = false
  } finally {
    isSending.value = false
  }
}

function selectSession(id: string) {
  currentSessionId.value = id
}

async function handleCreateSession() {
  try {
    const resp = await createSession(userId)
    const newSession = resp.data
    if (newSession) {
      sessions.value.unshift(newSession as { id: string; title: string; createdAt: string })
      selectSession(newSession.id)
    }
  } catch {
    /* ignore create errors */
  }
}
</script>

<style scoped>
.agent-workbench {
  display: flex;
  height: 100vh;
}

.session-list {
  width: 240px;
  border-right: 1px solid #eee;
  display: flex;
  flex-direction: column;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  font-weight: 600;
  border-bottom: 1px solid #eee;
}

.session-list .el-scrollbar {
  flex: 1;
}

.session-item {
  padding: 12px;
  cursor: pointer;
  border-bottom: 1px solid #f5f5f5;
}

.session-item:hover {
  background: #f9f9f9;
}

.session-item.active {
  background: #e6f0ff;
}

.session-title {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-meta {
  font-size: 12px;
  color: #999;
}

.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.message {
  margin-bottom: 12px;
}

.message.user {
  text-align: right;
}

.message-content {
  display: inline-block;
  padding: 8px 12px;
  border-radius: 8px;
  max-width: 80%;
  word-break: break-word;
  text-align: left;
}

.message.user .message-content {
  background: #1890ff;
  color: #fff;
}

.message.assistant .message-content {
  background: #f5f5f5;
}

.typing-indicator span {
  animation: blink 1.4s infinite;
  display: inline-block;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes blink {
  0%,
  60% {
    opacity: 1;
  }
  30% {
    opacity: 0.3;
  }
}

.input-area {
  padding: 12px;
  border-top: 1px solid #eee;
}

.input-actions {
  margin-top: 8px;
  text-align: right;
}

.tools-panel {
  width: 220px;
  border-left: 1px solid #eee;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.agent-card {
  margin-bottom: 0;
}

.agent-info {
  font-size: 13px;
}

.agent-name {
  font-weight: 600;
  margin-bottom: 4px;
}

.agent-desc {
  color: #666;
  font-size: 12px;
  line-height: 1.4;
}

.tools-list .el-tag {
  margin-right: 4px;
  margin-bottom: 4px;
}
</style>
