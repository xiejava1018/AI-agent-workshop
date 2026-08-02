<script setup lang="ts">
/**
 * SessionSidebar.vue —— Agent 工作台会话侧栏
 *
 * 等价 apps/web/components/SessionSidebar.tsx(2150 行)。
 * 本次重构对齐 apps/web 视觉与交互:
 *   - Header:New 按钮加文字 + Refresh 按钮(2s 内显示绿色 √)
 *   - item 固定 54px 两行(title + meta)
 *   - active 行有左侧 2px accent border indicator
 *   - Delete 行内三段式确认(Delete "xxx"? [Delete][Cancel])
 *   - title 超 22 字 ellipsis,meta 行(时间 + 消息数 + worktree branch)
 *   - pinned 行常显 unpin icon(不再仅 hover)
 *   - hover 显示 pin(若未置顶)/ rename / delete 32×32 按钮,蓝色 hover 高亮
 *   - fork tree:子会话缩进显示 + 折叠 toggle
 *   - 未读标记 + localStorage 持久化
 *   - 未读 / running 双指示器(蓝点 / 绿点)
 *
 * 单行渲染细节见 ./SessionItemRow.vue。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import { useSessionList } from '../composables/useSessionList'
import { useRunningSessions } from '../composables/useRunningSessions'
import { useUserStore } from '@/store/modules/user'
import { useSessionTree, type SessionTreeNode } from '../composables/useSessionTree'
import { useUnreadSessions } from '../composables/useUnreadSessions'
import SessionItemRow from './SessionItemRow.vue'
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
const sessionList = useSessionList()
const {
  searchQuery,
  sessions,
  load,
  create,
  rename,
  togglePin,
  delete: deleteSession,
  error,
  clearError
} = sessionList

const { runningMap } = useRunningSessions()
const unread = useUnreadSessions()

// ---- fork tree ----
const tree = useSessionTree(
  computed(() => sessions.value),
  { searchQuery: searchQuery }
)

// 把 tree flat 拆成顶层 pinned + 顶层 unpinned 两段(标签用)。
// 子节点在 tree.flat 中已按深度顺序排在父后,渲染时通过 padding-left 缩进。
const topLevelPinned = computed<SessionTreeNode[]>(() =>
  tree.flat.value.filter((n) => n.depth === 0 && n.session.pinned === true)
)
const topLevelUnpinned = computed<SessionTreeNode[]>(() =>
  tree.flat.value.filter((n) => n.depth === 0 && n.session.pinned !== true)
)

// 初次挂载拉一次
load(true)

// ---- 错误提示 ----
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

// ---- 清理已删除会话的 unread 标记 ----
watch(
  () => sessions.value,
  (list) => unread.pruneTo(list)
)

// ---- 切换会话时清除 unread 标记 ----
watch(
  () => props.currentSessionId,
  (id) => {
    if (id) unread.clear(id)
  }
)

// ---- Refresh 按钮:绿色 √ 反馈 2s ----
const refreshDone = ref(false)
let refreshTimer: ReturnType<typeof setTimeout> | null = null
async function handleRefresh() {
  const ok = await load(false)
  if (ok) {
    refreshDone.value = true
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshDone.value = false
    }, 2000)
  }
}

// ---- UI 状态 ----
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const confirmDeleteId = ref<string | null>(null)

function startRename(s: AgentSession) {
  renamingId.value = s.id
  renameValue.value = s.title
  nextTick(() => {
    const el = document.querySelector<HTMLInputElement>(
      `.wb-session-item[data-sid="${s.id}"] .wb-rename-input`
    )
    el?.select()
  })
}

function cancelRename() {
  renamingId.value = null
  renameValue.value = ''
}

async function commitRename() {
  const id = renamingId.value
  if (!id) return
  const next = renameValue.value.trim()
  renamingId.value = null
  renameValue.value = ''
  if (!next) return
  await rename(id, next)
}

function startDelete(s: AgentSession) {
  confirmDeleteId.value = s.id
}

function cancelDelete() {
  confirmDeleteId.value = null
}

async function confirmDelete(s: AgentSession) {
  confirmDeleteId.value = null
  await deleteSession(s.id)
}

async function handleNewSession() {
  const userStore = useUserStore()
  const info = (userStore.info ?? {}) as { userId?: string | number }
  const userId =
    info.userId !== undefined && info.userId !== null ? String(info.userId) : 'default'
  const sid = await create(userId)
  if (sid) {
    ElMessage.success('已创建新会话')
    emit('select', sid)
  }
}

function handleSelect(s: AgentSession) {
  if (props.currentSessionId !== s.id) {
    emit('select', s.id)
  }
}

async function handleTogglePin(s: AgentSession) {
  const next = !(s.pinned ?? false)
  await togglePin(s.id, next)
  emit('pin', s.id, next)
}

const showMeta = computed(() => !props.collapsed)

function isUnread(s: AgentSession): boolean {
  return unread.isUnread(s.id)
}
function isRunning(s: AgentSession): boolean {
  return Boolean(runningMap.value.get(s.id))
}
function isActive(s: AgentSession): boolean {
  return s.id === props.currentSessionId
}

// 把整段节点渲染:渲染某顶层节点 + 它的所有子节点(受 collapsed 控制)
// 直接用 tree.flat 就行,只是要按"顶 pinned / 顶 unpinned"两段标签拆。
</script>

<template>
  <div class="wb-sidebar-pane">
    <!-- Header -->
    <div class="wb-sidebar-header">
      <div class="wb-sidebar-header-row">
        <el-input
          v-model="searchQuery"
          size="small"
          placeholder="搜索会话…"
          clearable
          class="wb-sidebar-search"
        >
          <template #prefix>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </template>
        </el-input>
        <div class="wb-sidebar-header-actions">
          <el-tooltip content="新建会话" placement="bottom">
            <button
              type="button"
              class="wb-sidebar-action-btn wb-sidebar-new-btn"
              aria-label="新建会话"
              @click="handleNewSession"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <line x1="6" y1="1" x2="6" y2="11" />
                <line x1="1" y1="6" x2="11" y2="6" />
              </svg>
              <span class="wb-sidebar-new-label">New</span>
            </button>
          </el-tooltip>
          <el-tooltip content="刷新会话列表" placement="bottom">
            <button
              type="button"
              class="wb-sidebar-action-btn wb-sidebar-refresh-btn"
              :class="{ done: refreshDone }"
              :aria-label="refreshDone ? '已刷新' : '刷新'"
              @click="handleRefresh"
            >
              <svg
                v-if="!refreshDone"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              <svg
                v-else
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          </el-tooltip>
        </div>
      </div>
    </div>

    <!-- Pinned 段 -->
    <div v-if="topLevelPinned.length > 0" class="wb-sidebar-section">
      <div class="wb-sidebar-section-label">置顶</div>
      <div
        v-for="node in topLevelPinned"
        :key="node.session.id"
        class="wb-session-item"
        :class="{
          active: isActive(node.session),
          pinned: true,
          unavailable: node.session.available === false,
          'is-deleting': confirmDeleteId === node.session.id
        }"
        :data-sid="node.session.id"
        :data-depth="node.depth"
        :style="{ paddingLeft: `${node.depth * 14}px` }"
      >
        <SessionItemRow
          :node="node"
          :is-active="isActive(node.session)"
          :is-running="isRunning(node.session)"
          :is-unread="isUnread(node.session)"
          :is-pinned="node.session.pinned === true"
          :show-meta="showMeta"
          :renaming="renamingId === node.session.id"
          :confirm-delete="confirmDeleteId === node.session.id"
          :rename-value="renameValue"
          :children="node.children"
          :collapsed="tree.isCollapsed(node.session.id)"
          @select="handleSelect(node.session)"
          @rename="startRename(node.session)"
          @commit-rename="commitRename"
          @cancel-rename="cancelRename"
          @update:rename-value="(v: string) => (renameValue = v)"
          @start-delete="startDelete(node.session)"
          @confirm-delete="confirmDelete(node.session)"
          @cancel-delete="cancelDelete"
          @toggle-pin="handleTogglePin(node.session)"
          @toggle-collapse="tree.toggle(node.session.id)"
        />
      </div>
    </div>

    <!-- Unpinned 段 -->
    <div v-if="topLevelUnpinned.length > 0" class="wb-sidebar-section">
      <div v-if="topLevelPinned.length > 0" class="wb-sidebar-section-label">所有会话</div>
      <div
        v-for="node in topLevelUnpinned"
        :key="node.session.id"
        class="wb-session-item"
        :class="{
          active: isActive(node.session),
          unavailable: node.session.available === false,
          'is-deleting': confirmDeleteId === node.session.id
        }"
        :data-sid="node.session.id"
        :data-depth="node.depth"
        :style="{ paddingLeft: `${node.depth * 14}px` }"
      >
        <SessionItemRow
          :node="node"
          :is-active="isActive(node.session)"
          :is-running="isRunning(node.session)"
          :is-unread="isUnread(node.session)"
          :is-pinned="node.session.pinned === true"
          :show-meta="showMeta"
          :renaming="renamingId === node.session.id"
          :confirm-delete="confirmDeleteId === node.session.id"
          :rename-value="renameValue"
          :children="node.children"
          :collapsed="tree.isCollapsed(node.session.id)"
          @select="handleSelect(node.session)"
          @rename="startRename(node.session)"
          @commit-rename="commitRename"
          @cancel-rename="cancelRename"
          @update:rename-value="(v: string) => (renameValue = v)"
          @start-delete="startDelete(node.session)"
          @confirm-delete="confirmDelete(node.session)"
          @cancel-delete="cancelDelete"
          @toggle-pin="handleTogglePin(node.session)"
          @toggle-collapse="tree.toggle(node.session.id)"
        />
      </div>
    </div>

    <!-- 空态:所有 sessions 为空时 -->
    <div
      v-if="
        topLevelPinned.length === 0 &&
        topLevelUnpinned.length === 0 &&
        sessions.length === 0
      "
      class="wb-sidebar-empty"
    >
      暂无会话,点击「+ New」新建
    </div>
    <!-- 搜索后无命中 -->
    <div
      v-else-if="
        topLevelPinned.length === 0 &&
        topLevelUnpinned.length === 0 &&
        sessions.length > 0
      "
      class="wb-sidebar-empty"
    >
      没有匹配的会话
    </div>
  </div>
</template>

<style scoped>
  /**
   * 根容器 = 路由外层 <aside class="wb-session-list"> 的滚动子。
   * 负责 header 不滚动 + sections 自动滚动。这里设 flex column + overflow-y:auto。
   */
  .wb-sidebar-pane {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--wb-bg-sidebar);
  }

  .wb-sidebar-header {
    flex-shrink: 0;
    padding: var(--wb-pad-sm) var(--wb-pad-md);
    border-bottom: 1px solid var(--wb-border);
    background: var(--wb-bg-sidebar);
  }

  .wb-sidebar-header-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .wb-sidebar-search {
    flex: 1;
    min-width: 0;
  }

  .wb-sidebar-header-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .wb-sidebar-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 28px;
    border: 1px solid var(--wb-border);
    border-radius: 7px;
    background: var(--wb-bg-hover);
    color: var(--wb-text-muted);
    cursor: pointer;
    padding: 0;
    font-size: 12px;
    font-weight: 500;
    transition:
      background var(--wb-transition-fast) var(--wb-ease-out),
      color var(--wb-transition-fast) var(--wb-ease-out),
      border-color var(--wb-transition-fast) var(--wb-ease-out);
  }

  .wb-sidebar-action-btn:hover {
    background: var(--wb-bg-selected);
    color: var(--wb-accent);
    border-color: rgba(37, 99, 235, 0.35);
  }

  .wb-sidebar-new-btn {
    padding: 0 10px;
    flex-shrink: 0;
  }

  .wb-sidebar-new-label {
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .wb-sidebar-refresh-btn {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
  }

  .wb-sidebar-refresh-btn.done {
    background: rgba(74, 222, 128, 0.18);
    border-color: rgba(74, 222, 128, 0.4);
    color: #4ade80;
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

  .wb-sidebar-empty {
    padding: var(--wb-pad-lg) var(--wb-pad-md);
    color: var(--wb-text-muted);
    font-size: 12px;
    text-align: center;
  }
</style>