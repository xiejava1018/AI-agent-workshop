<script setup lang="ts">
/**
 * SessionSidebar.vue —— Agent 工作台会话侧栏
 *
 * 等价 apps/web/components/SessionSidebar.tsx 的列表/CRUD/搜索/置顶/重命名/删除部分。
 * 注意:
 *   - 工作树切换 / File Explorer / CWD picker 留给 Track C(它们依赖 /api/worktrees、
 *     /api/home 等端点,本次 Track A 不涉及)
 *   - 不持有消息流;点击会话只 emit 'select',由父组件 ChatWindow 接管
 *   - 复用 styles/workbench.css 中已有的 .wb-session-item / .wb-session-title /
 *     .wb-session-meta / .wb-running-dot 等
 *   - 使用 Element Plus:el-input / el-tooltip / el-popconfirm / el-dialog /
 *     el-button(其它视觉细节用原生 div + 类)
 *   - 错误通过 el-notification 提示(el-notification 由父组件挂载或全局注册)
 */

import { computed, ref } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import { useSessionList } from '../composables/useSessionList'
import { useRunningSessions } from '../composables/useRunningSessions'
import type { AgentSession } from '../types'

const props = defineProps<{
  currentSessionId: string | null
  collapsed?: boolean
}>()

const emit = defineEmits<{
  select: [sessionId: string]
  create: []
  rename: [sessionId: string, newTitle: string]
  pin: [sessionId: string, pinned: boolean]
  delete: [sessionId: string]
}>()

// ---- 数据 ----
const {
  searchQuery,
  pinnedSessions,
  unpinnedSessions,
  load,
  create,
  rename,
  togglePin,
  delete: deleteSession,
  error,
  clearError
} = useSessionList()

const { runningMap } = useRunningSessions()

// 初次挂载拉一次;失败时由 watch(error) 弹通知
load(true)

// ---- 错误提示 ----
import { watch } from 'vue'
watch(error, (msg) => {
  if (!msg) return
  ElNotification({
    type: 'error',
    title: '操作失败',
    message: msg,
    duration: 4000
  })
  clearError()
})

// ---- UI 状态 ----
const renamingId = ref<string | null>(null)
const renameValue = ref('')

function startRename(s: AgentSession) {
  renamingId.value = s.id
  renameValue.value = s.title
}

function cancelRename() {
  renamingId.value = null
  renameValue.value = ''
}

async function commitRename() {
  const id = renamingId.value
  if (!id) return
  const next = renameValue.value.trim()
  if (!next) {
    cancelRename()
    return
  }
  renamingId.value = null
  renameValue.value = ''
  await rename(id, next)
}

async function handleNewSession() {
  const sid = await create()
  if (sid) {
    ElMessage.success('已创建新会话')
    emit('select', sid)
  }
}

function handleSelect(s: AgentSession) {
  emit('select', s.id)
}

async function handleTogglePin(s: AgentSession) {
  const next = !(s.pinned ?? false)
  await togglePin(s.id, next)
  emit('pin', s.id, next)
}

async function handleDelete(s: AgentSession) {
  await deleteSession(s.id)
  emit('delete', s.id)
}

// 折叠时只显示头像/title,这里直接由 props.collapsed 控制列表项的 meta 显示
const showMeta = computed(() => !props.collapsed)

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr).getTime()
  if (Number.isNaN(d)) return ''
  const diff = Date.now() - d
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(diff / 86_400_000)
  if (days < 7) return `${days} 天前`
  return new Date(dateStr).toLocaleDateString()
}
</script>

<template>
  <div class="wb-session-list">
    <!-- Header -->
    <div class="wb-sidebar-header">
      <el-input
        v-model="searchQuery"
        size="small"
        placeholder="搜索会话…"
        clearable
        class="wb-sidebar-search"
      >
        <template #prefix>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </template>
      </el-input>
      <el-tooltip content="新建会话" placement="bottom">
        <el-button
          type="primary"
          size="small"
          :icon="undefined"
          class="wb-sidebar-new-btn"
          @click="handleNewSession"
        >
          +
        </el-button>
      </el-tooltip>
    </div>

    <!-- Pinned list -->
    <div v-if="pinnedSessions.length > 0" class="wb-sidebar-section">
      <div class="wb-sidebar-section-label">置顶</div>
      <div
        v-for="s in pinnedSessions"
        :key="s.id"
        class="wb-session-item"
        :class="{
          active: s.id === currentSessionId,
          pinned: true,
          unavailable: s.available === false,
          running: runningMap.get(s.id)
        }"
      >
        <!-- Rename mode -->
        <template v-if="renamingId === s.id">
          <input
            v-model="renameValue"
            class="wb-rename-input"
            autofocus
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="cancelRename"
            @blur="commitRename"
          />
        </template>

        <!-- Normal mode -->
        <template v-else>
          <div class="wb-session-row" @click="handleSelect(s)">
            <div class="wb-session-title">
              <span
                v-if="s.available === false"
                class="wb-session-badge"
                title="该会话文件不可用"
              >⚠</span>
              <span class="wb-session-title-text">{{ s.title || '未命名会话' }}</span>
            </div>
            <div v-if="showMeta" class="wb-session-meta">
              <span>{{ formatRelativeTime(s.updatedAt) }}</span>
              <span v-if="runningMap.get(s.id)" class="wb-running-dot" />
            </div>
          </div>

          <div v-if="!props.collapsed" class="wb-session-actions">
            <el-tooltip content="取消置顶" placement="top">
              <button
                type="button"
                class="wb-session-action-btn pinned-action"
                aria-label="取消置顶"
                @click.stop="handleTogglePin(s)"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7-6.3-4.6L5.7 20.8l2.3-7-6-4.4h7.6z" />
                </svg>
              </button>
            </el-tooltip>
            <el-tooltip content="重命名" placement="top">
              <button
                type="button"
                class="wb-session-action-btn"
                aria-label="重命名"
                @click.stop="startRename(s)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
            </el-tooltip>
            <el-popconfirm
              title="确认删除该会话?"
              confirm-button-text="删除"
              cancel-button-text="取消"
              @confirm.stop="handleDelete(s)"
            >
              <template #reference>
                <button
                  type="button"
                  class="wb-session-action-btn danger-action"
                  aria-label="删除"
                  @click.stop
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </template>
            </el-popconfirm>
          </div>
        </template>
      </div>
    </div>

    <!-- Unpinned list -->
    <div class="wb-sidebar-section">
      <div v-if="pinnedSessions.length > 0" class="wb-sidebar-section-label">所有会话</div>
      <div
        v-for="s in unpinnedSessions"
        :key="s.id"
        class="wb-session-item"
        :class="{
          active: s.id === currentSessionId,
          unavailable: s.available === false,
          running: runningMap.get(s.id)
        }"
      >
        <template v-if="renamingId === s.id">
          <input
            v-model="renameValue"
            class="wb-rename-input"
            autofocus
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="cancelRename"
            @blur="commitRename"
          />
        </template>

        <template v-else>
          <div class="wb-session-row" @click="handleSelect(s)">
            <div class="wb-session-title">
              <span
                v-if="s.available === false"
                class="wb-session-badge"
                title="该会话文件不可用"
              >⚠</span>
              <span class="wb-session-title-text">{{ s.title || '未命名会话' }}</span>
            </div>
            <div v-if="showMeta" class="wb-session-meta">
              <span>{{ formatRelativeTime(s.updatedAt) }}</span>
              <span v-if="runningMap.get(s.id)" class="wb-running-dot" />
            </div>
          </div>

          <div v-if="!props.collapsed" class="wb-session-actions">
            <el-tooltip content="置顶" placement="top">
              <button
                type="button"
                class="wb-session-action-btn"
                aria-label="置顶"
                @click.stop="handleTogglePin(s)"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7-6.3-4.6L5.7 20.8l2.3-7-6-4.4h7.6z" />
                </svg>
              </button>
            </el-tooltip>
            <el-tooltip content="重命名" placement="top">
              <button
                type="button"
                class="wb-session-action-btn"
                aria-label="重命名"
                @click.stop="startRename(s)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
            </el-tooltip>
            <el-popconfirm
              title="确认删除该会话?"
              confirm-button-text="删除"
              cancel-button-text="取消"
              @confirm.stop="handleDelete(s)"
            >
              <template #reference>
                <button
                  type="button"
                  class="wb-session-action-btn danger-action"
                  aria-label="删除"
                  @click.stop
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </template>
            </el-popconfirm>
          </div>
        </template>
      </div>

      <div v-if="pinnedSessions.length === 0 && unpinnedSessions.length === 0" class="wb-sidebar-empty">
        暂无会话,点击「+」新建
      </div>
    </div>
  </div>
</template>

<style scoped>
.wb-sidebar-header {
  display: flex;
  align-items: center;
  gap: var(--wb-pad-sm);
  padding: var(--wb-pad-sm) var(--wb-pad-md);
  border-bottom: 1px solid var(--wb-border);
  background: var(--wb-bg-sidebar);
}

.wb-sidebar-search {
  flex: 1;
}

.wb-sidebar-new-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 16px;
  font-weight: 600;
}

.wb-sidebar-section {
  display: flex;
  flex-direction: column;
  padding: var(--wb-pad-xs) 0;
}

.wb-sidebar-section-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--wb-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: var(--wb-pad-xs) var(--wb-pad-md);
}

.wb-session-row {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.wb-session-title {
  display: flex;
  align-items: center;
  gap: var(--wb-pad-xs);
  min-width: 0;
}

.wb-session-title-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-session-badge {
  color: var(--wb-warning);
  font-size: 11px;
  flex-shrink: 0;
}

.wb-session-actions {
  display: none;
  gap: 2px;
  align-items: center;
  flex-shrink: 0;
  margin-left: var(--wb-pad-xs);
}

.wb-session-item:hover .wb-session-actions {
  display: flex;
}

.wb-session-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid transparent;
  border-radius: var(--wb-radius-sm);
  background: transparent;
  color: var(--wb-text-muted);
  cursor: pointer;
  padding: 0;
  transition: background-color var(--wb-transition-fast) var(--wb-ease-out),
    color var(--wb-transition-fast) var(--wb-ease-out),
    border-color var(--wb-transition-fast) var(--wb-ease-out);
}

.wb-session-action-btn:hover {
  background: var(--wb-bg-hover);
  color: var(--wb-text);
  border-color: var(--wb-border);
}

.wb-session-action-btn.pinned-action {
  color: var(--wb-warning);
}

.wb-session-action-btn.danger-action:hover {
  color: var(--wb-danger);
  border-color: var(--wb-danger);
}

.wb-rename-input {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  padding: var(--wb-pad-xs) var(--wb-pad-sm);
  border: 1px solid var(--wb-accent);
  border-radius: var(--wb-radius-sm);
  outline: none;
  background: var(--wb-bg);
  color: var(--wb-text);
}

.wb-sidebar-empty {
  padding: var(--wb-pad-lg) var(--wb-pad-md);
  color: var(--wb-text-muted);
  font-size: 12px;
  text-align: center;
}
</style>