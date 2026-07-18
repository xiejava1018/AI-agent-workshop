<template>
  <div class="agent-workbench">
   <div class="workbench-card">
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
          :class="{ active: session.id === currentSessionId, unavailable: session.available === false }"
          :title="session.available === false ? '该 session 文件不存在,无法聊天,请新建' : ''"
          @click="session.available !== false && selectSession(session.id)"
        >
          <div class="session-title">{{ session.title || '新会话' }}</div>
          <div class="session-meta">{{ session.createdAt }}</div>
        </div>
      </el-scrollbar>
    </aside>

    <!-- 右侧对话区 -->
    <main class="chat-area" style="flex: 1; display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden;">
      <!-- 消息列表 -->
      <el-scrollbar class="messages" ref="messagesScrollRef" style="flex: 1 1 auto; min-height: 0; overflow-y: auto;">
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
        <!-- 空状态:未选 session / 无消息时提示 -->
        <div v-if="messages.length === 0 && !isTyping" class="empty-state">
          <div class="empty-icon">💬</div>
          <div class="empty-title">
            {{ currentSessionId ? '开始对话' : '请选择一个会话或点击左上角"新建"创建会话' }}
          </div>
          <div v-if="!currentSessionId && sessions.length > 0" class="empty-hint">
            列表中灰色项为历史 session(文件不存在),无法使用
          </div>
          <div v-else-if="currentSessionId" class="empty-hint">
            在下方输入框输入消息,按 Ctrl+Enter 发送
          </div>
        </div>
      </el-scrollbar>

      <!-- 输入区 -->
      <div class="input-area" style="flex: 0 0 auto; padding: 16px 20px; margin: 12px 20px 20px; border: 1px solid #e4e7ed; border-radius: 8px; background: #ffffff; box-shadow: 0 -1px 0 rgba(0, 0, 0, 0.02);">
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
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useAgentEvents } from '@/composables/useAgentEvents'
import { listSessions, createSession, sendMessage as apiSendMessage, type AgentSession } from '@/api/agent'

const route = useRoute()
const userId = localStorage.getItem('user_id') || ''

// Refs
const currentSessionId = ref<string>((route.params.id as string) || '')
const messagesScrollRef = ref<{ wrap?: { scrollTop?: number; scrollHeight?: number } } | null>(null)
const messages = ref<Array<{ role: 'user' | 'assistant'; content: string }>>([])
const inputText = ref('')
const isTyping = ref(false)
const isSending = ref(false)
const currentAgent = ref<{ name: string; description?: string } | null>(null)
const availableTools = ref<string[]>([])
const sessions = ref<AgentSession[]>([])

// SSE
const { events, isConnected, connect, disconnect } = useAgentEvents(currentSessionId)

// Load sessions
onMounted(async () => {
  try {
    const resp = await listSessions()
    sessions.value = resp.data?.items || []
  } catch {
    sessions.value = []
  }
  // menu 路径 /workspace/agent 无 :id 动态段 → 路由参数空。
  // 自动选第一个 session(后端 GET /api/agent/sessions 按 platform_admin 返所有可见)
  if (!currentSessionId.value && sessions.value.length > 0) {
    selectSession(sessions.value[0].id)
  }
  connect()
})

// Watch currentSessionId 变化 → 重连 SSE
watch(currentSessionId, () => {
  disconnect()
  connect()
})

// Watch SSE events
watch(
  () => events.value,
  (newEvents) => {
    const last = newEvents[newEvents.length - 1]
    if (!last) return

    // 修复:原代码 `last.type === 'message' | 'tool_update' | 'prompt_done' | 'error'`
    // 是 JS 优先级坑 —— `===` 高于 `|`,等价
    //   last.type === 'message' || 'tool_update' || 'prompt_done' || 'error'
    // 因字符串 truthy 永远成立,绕过类型检查,把 content=undefined 的空 assistant
    // 消息无限 push 进 messages,UI 看似"无回复"。显式枚举四种类型。
    switch (last.type) {
      case 'message':
        messages.value.push({ role: 'assistant', content: last.content || '' })
        isTyping.value = false
        break
      case 'tool_update':
        messages.value.push({
          role: 'assistant',
          content: `[tool] ${last.toolName}: ${JSON.stringify(last.toolInput)}`
        })
        break
      case 'prompt_done':
        isTyping.value = false
        break
      case 'error':
        messages.value.push({ role: 'assistant', content: `错误: ${last.content}` })
        isTyping.value = false
        break
      default:
        break
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
  // 防护:无 currentSessionId 或 session unavailable 时阻止发送
  const current = sessions.value.find((s) => s.id === currentSessionId.value)
  if (!current || current.available === false) {
    messages.value.push({
      role: 'assistant',
      content: '请先选择或创建一个可用的 session(列表中灰色项不可用)'
    })
    return
  }
  const text = inputText.value
  inputText.value = ''
  messages.value.push({ role: 'user', content: text })
  isTyping.value = true
  isSending.value = true
  // 发送前若 SSE 断了,先重连一次再发,否则即便消息送到后端,事件流也没人接
  if (!isConnected.value) {
    connect()
  }
  try {
    await apiSendMessage(currentSessionId.value, text, userId)
  } catch {
    messages.value.push({ role: 'assistant', content: '发送失败，请重试' })
    isTyping.value = false
    // 失败后再补一次重连,处理 SSE 在发送过程中被服务端 idle-timer 销毁的情况
    connect()
  } finally {
    isSending.value = false
  }
}

function selectSession(id: string) {
  currentSessionId.value = id
}

async function handleCreateSession() {
  try {
    // 修复:POST /api/agent/new 返 { success, sessionId, data: null }。
    // 原代码把 resp.data 当 AgentSession 推入列表,但:
    //   1) 字段名是 sessionId 不是 id
    //   2) data 为 null(ensure_session 不发消息,后端显式置 null)
    // 导致新 session 既不入列表、也不被选中,后续 sendMessage 触发
    // '请先选择或创建一个可用的 session' 防护。
    const resp = await createSession(userId) as { sessionId?: string; success?: boolean }
    const newId = resp?.sessionId
    if (newId) {
      const newSession: AgentSession = {
        id: newId,
        title: '新会话',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userId,
        teamId: null,
        // startRpcSession 已成功 → 内存里 runtime 存在,后续 GET /api/agent/sessions 会返 available:true
        available: true
      }
      sessions.value.unshift(newSession)
      selectSession(newId)
    }
  } catch {
    /* ignore create errors */
  }
}
</script>

<style scoped>
.agent-workbench {
  display: flex;
  /* 关键:用模板提供的可用区高度(已减去 header/tabs),不要用 100vh(整个视口会撑高溢出)。
     --art-full-height 由 useLayoutHeight 计算并注入到 documentElement。 */
  height: var(--art-full-height, calc(100vh - 60px));
  box-sizing: border-box;
  overflow: hidden;
  padding: 12px;
  background: #f5f7fa;
}

.workbench-card {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
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

.session-item.unavailable {
  opacity: 0.45;
  cursor: not-allowed;
}

.session-item.unavailable:hover {
  background: transparent;
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
  min-height: 0;
  overflow: hidden;
}

.messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px;
  margin: 0 12px;
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
  flex: 0 0 auto;
  padding: 16px 20px;
  margin: 12px 20px 20px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 -1px 0 rgba(0, 0, 0, 0.02);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  text-align: center;
  color: #909399;
  min-height: 200px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-title {
  font-size: 15px;
  color: #606266;
  margin-bottom: 6px;
}

.empty-hint {
  font-size: 13px;
  color: #909399;
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
