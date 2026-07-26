<script setup lang="ts">
/**
 * SessionItemRow —— 单个 session 行的渲染。
 *
 * 抽出来是为了让 SessionSidebar.vue 主文件代码量受控;视觉逻辑全部在这。
 * 视觉要点(对齐 apps/web SessionSidebar.tsx SessionItem 行 1749-2150):
 *   - 固定高度 54px(对齐 apps/web ITEM_HEIGHT)
 *   - 内容按 (running | unread) dot + title / meta 三段对齐
 *   - meta:相对时间 + 消息数 + worktree branch(图标 + 文字)
 *   - active:border-left 2px solid accent + bg selected
 *   - hover:32×32 pin/rename/delete 按钮,蓝色 hover 高亮
 *   - pinned:常显一颗 pin icon,可点 unpin(hover 时被替换为动作组)
 *   - 删除确认:行内变 Delete "xxx"? [Delete][Cancel] 三段(同高替换)
 */
import { computed } from 'vue'
import type { SessionTreeNode } from '../composables/useSessionTree'
import type { AgentSession } from '../types'

const props = defineProps<{
  node: SessionTreeNode
  isActive: boolean
  isRunning: boolean
  isUnread: boolean
  isPinned: boolean
  showMeta: boolean
  renaming: boolean
  confirmDelete: boolean
  renameValue: string
  children: SessionTreeNode[]
  collapsed: boolean
}>()

const emit = defineEmits<{
  select: []
  rename: []
  'commit-rename': []
  'cancel-rename': []
  'update:renameValue': [string]
  'start-delete': []
  'confirm-delete': []
  'cancel-delete': []
  'toggle-pin': []
  'toggle-collapse': []
}>()

const s = computed<AgentSession>(() => props.node.session)
const isTopLevel = computed(() => props.node.depth === 0)
const hasChildren = computed(() => props.children.length > 0)

function truncateTitle(title: string, max = 22): string {
  if (!title) return '未命名会话'
  return title.length > max ? title.slice(0, max) + '…' : title
}

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

function onRenameInput(e: Event) {
  emit('update:renameValue', (e.target as HTMLInputElement).value)
}

function onRowClick() {
  if (props.confirmDelete || props.renaming) return
  emit('select')
}
</script>

<template>
  <div
    class="wb-session-item-row"
    :class="{
      active: isActive,
      confirm: confirmDelete,
      renaming,
      'has-children': hasChildren,
      'is-collapsed': collapsed
    }"
    @click="onRowClick"
  >
    <!-- ============ Delete 确认 ============ -->
    <template v-if="confirmDelete">
      <div class="wb-confirm-text">
        Delete <strong>"{{ truncateTitle(s.title, 22) }}"</strong>?
      </div>
      <div class="wb-confirm-actions">
        <button
          type="button"
          class="wb-confirm-btn wb-confirm-btn--danger"
          aria-label="确认删除"
          @click.stop="emit('confirm-delete')"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
          Delete
        </button>
        <button
          type="button"
          class="wb-confirm-btn wb-confirm-btn--cancel"
          aria-label="取消删除"
          @click.stop="emit('cancel-delete')"
        >
          Cancel
        </button>
      </div>
    </template>

    <!-- ============ Rename 输入 ============ -->
    <template v-else-if="renaming">
      <input
        class="wb-rename-input"
        :value="renameValue"
        @input="onRenameInput"
        @keydown.enter.prevent="emit('commit-rename')"
        @keydown.esc.prevent="emit('cancel-rename')"
        @blur="emit('commit-rename')"
        @click.stop
        autofocus
      />
    </template>

    <!-- ============ 正常显示 ============ -->
    <template v-else>
      <svg
        v-if="!isTopLevel"
        class="wb-fork-icon"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>

      <div class="wb-session-info">
        <div class="wb-session-title">
          <span
            v-if="isRunning"
            class="wb-session-indicator wb-session-indicator--running"
            aria-hidden="true"
          />
          <span
            v-else-if="isUnread"
            class="wb-session-indicator wb-session-indicator--unread"
            aria-hidden="true"
          />
          <span
            class="wb-session-title-text"
            :class="{ 'is-bold': isActive }"
            :title="s.title"
            >{{ truncateTitle(s.title, 22) }}</span
          >
        </div>
        <div v-if="showMeta" class="wb-session-meta">
          <span>{{ formatRelativeTime(s.updatedAt) }}</span>
          <template v-if="typeof s.messageCount === 'number'">
            <span class="wb-session-meta-sep">·</span>
            <span>{{ s.messageCount }} msgs</span>
          </template>
          <span
            v-if="s.worktreeBranch"
            class="wb-session-meta-branch"
            :title="s.cwd ?? ''"
          >
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span class="wb-session-meta-branch-text">{{ s.worktreeBranch }}</span>
          </span>
        </div>
      </div>

      <!-- 折叠 toggle(只对有子的父节点显示) -->
      <button
        v-if="hasChildren && isTopLevel"
        type="button"
        class="wb-collapse-toggle"
        :aria-label="collapsed ? '展开 forks' : '折叠 forks'"
        :title="collapsed ? '展开 forks' : '折叠 forks'"
        @click.stop="emit('toggle-collapse')"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      <!-- pinned 行常显 unpin icon -->
      <button
        v-if="isPinned"
        type="button"
        class="wb-pin-persistent"
        title="已置顶,点击取消"
        aria-label="取消置顶"
        @click.stop="emit('toggle-pin')"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line x1="12" y1="17" x2="12" y2="22" />
          <path d="M5 17h14v-1.5a1.5 1.5 0 0 0-1.5-1.5H17l-1.4-1.4a2 2 0 0 0-1.4-.6H9.8a2 2 0 0 0-1.4.6L7 14H6.5A1.5 1.5 0 0 0 5 15.5V17z" />
          <path d="M12 2a3 3 0 0 0-3 3c0 1.5 1 2 1 4h4c0-2 1-2.5 1-4a3 3 0 0 0-3-3z" />
        </svg>
      </button>

      <!-- hover 动作组(pin / rename / delete) -->
      <div class="wb-session-actions-hover">
        <button
          v-if="!isPinned"
          type="button"
          class="wb-action-btn"
          title="置顶"
          aria-label="置顶"
          @click.stop="emit('toggle-pin')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14v-1.5a1.5 1.5 0 0 0-1.5-1.5H17l-1.4-1.4a2 2 0 0 0-1.4-.6H9.8a2 2 0 0 0-1.4.6L7 14H6.5A1.5 1.5 0 0 0 5 15.5V17z" />
            <path d="M12 2a3 3 0 0 0-3 3c0 1.5 1 2 1 4h4c0-2 1-2.5 1-4a3 3 0 0 0-3-3z" />
          </svg>
        </button>
        <button
          type="button"
          class="wb-action-btn"
          title="重命名"
          aria-label="重命名"
          @click.stop="emit('rename')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        </button>
        <button
          type="button"
          class="wb-action-btn wb-action-btn--danger"
          title="删除"
          aria-label="删除"
          @click.stop="emit('start-delete')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
  .wb-session-item-row {
    height: 54px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px 0 0;
    cursor: pointer;
    background: transparent;
    border-left: 2px solid transparent;
    transition:
      background var(--wb-transition-fast) var(--wb-ease-out),
      border-color var(--wb-transition-fast) var(--wb-ease-out);
    overflow: hidden;
    position: relative;
  }

  .wb-session-item-row:hover {
    background: var(--wb-bg-hover);
  }

  .wb-session-item-row.active {
    background: var(--wb-bg-selected);
    border-left-color: var(--wb-accent);
  }

  .wb-session-item-row.confirm {
    background: rgba(239, 68, 68, 0.06);
    border-left-color: #ef4444;
    cursor: default;
  }

  .wb-session-item-row.renaming {
    background: var(--wb-bg);
    cursor: default;
  }

  .wb-fork-icon {
    flex-shrink: 0;
    color: var(--wb-text-dim);
  }

  .wb-session-info {
    flex: 1;
    min-width: 0;
  }

  .wb-session-title {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    font-size: 12px;
    line-height: 1.4;
  }

  .wb-session-title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    color: var(--wb-text);
    font-weight: 400;
  }

  .wb-session-title-text.is-bold {
    font-weight: 500;
  }

  .wb-session-indicator {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--wb-success);
  }

  .wb-session-indicator--running {
    animation: wb-pulse 1.5s ease-in-out infinite;
  }

  .wb-session-indicator--unread {
    background: var(--wb-accent);
  }

  @keyframes wb-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  .wb-session-meta {
    margin-top: 2px;
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--wb-text-dim);
    font-size: 11px;
    min-width: 0;
  }

  .wb-session-meta-sep {
    color: var(--wb-text-dim);
  }

  .wb-session-meta-branch {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--wb-accent);
    min-width: 0;
    overflow: hidden;
  }

  .wb-session-meta-branch-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wb-collapse-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--wb-text-dim);
    cursor: pointer;
    transition: transform var(--wb-transition-fast) var(--wb-ease-out);
  }

  .wb-session-item-row.is-collapsed .wb-collapse-toggle {
    transform: rotate(-90deg);
  }

  .wb-pin-persistent {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    flex-shrink: 0;
    background: rgba(37, 99, 235, 0.1);
    border: 1px solid rgba(37, 99, 235, 0.35);
    border-radius: 6px;
    color: var(--wb-accent);
    cursor: pointer;
    transition:
      background var(--wb-transition-fast) var(--wb-ease-out),
      border-color var(--wb-transition-fast) var(--wb-ease-out);
  }

  .wb-pin-persistent:hover {
    background: rgba(37, 99, 235, 0.18);
  }

  /* hover 才显示动作按钮 */
  .wb-session-actions-hover {
    display: none;
    gap: 4px;
    flex-shrink: 0;
  }

  .wb-session-item-row:hover .wb-session-actions-hover {
    display: flex;
  }

  /* hover 时 pinned 持久按钮隐藏(避免重复) */
  .wb-session-item-row:hover .wb-pin-persistent {
    display: none;
  }

  .wb-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: var(--wb-bg-hover);
    border: 1px solid var(--wb-border);
    border-radius: 7px;
    color: var(--wb-text-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background var(--wb-transition-fast) var(--wb-ease-out),
      color var(--wb-transition-fast) var(--wb-ease-out),
      border-color var(--wb-transition-fast) var(--wb-ease-out);
  }

  .wb-action-btn:hover {
    background: var(--wb-bg-selected);
    color: var(--wb-accent);
    border-color: rgba(37, 99, 235, 0.35);
  }

  .wb-action-btn--danger:hover {
    background: rgba(239, 68, 68, 0.08);
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.35);
  }

  /* ============ Rename 输入 ============ */
  .wb-rename-input {
    flex: 1;
    font-size: 12px;
    padding: 5px 8px;
    border: 1px solid var(--wb-accent);
    border-radius: 5px;
    outline: none;
    background: var(--wb-bg);
    color: var(--wb-text);
    height: 30px;
  }

  /* ============ Delete 行内确认 ============ */
  .wb-confirm-text {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--wb-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wb-confirm-text strong {
    font-weight: 600;
  }

  .wb-confirm-actions {
    display: flex;
    gap: 5px;
    flex-shrink: 0;
  }

  .wb-confirm-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 30px;
    padding: 0 11px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    transition:
      background var(--wb-transition-fast) var(--wb-ease-out),
      border-color var(--wb-transition-fast) var(--wb-ease-out);
  }

  .wb-confirm-btn--danger {
    background: #ef4444;
    border: none;
    color: #fff;
    font-weight: 600;
  }

  .wb-confirm-btn--cancel {
    background: var(--wb-bg);
    border: 1px solid var(--wb-border);
    color: var(--wb-text-muted);
    font-weight: 500;
  }

  .wb-confirm-btn--cancel:hover {
    background: var(--wb-bg-hover);
  }
</style>