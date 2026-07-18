<script setup lang="ts">
/**
 * TabBar.vue —— IDE 风格的多 Tab 栏
 *
 * 等价 apps/web/components/TabBar.tsx(102 行)
 *
 * 设计:复用 styles/workbench.css 里已有的 .wb-tabbar / .wb-tab / .wb-tab-close。
 * 不引入 Element Plus —— 该组件足够简单且需要严格的 IDE 风格视觉。
 */

import type { WorkbenchTab } from '../types'

defineProps<{
  tabs: WorkbenchTab[]
  activeTabId: string
}>()

const emit = defineEmits<{
  select: [tabId: string]
  close: [tabId: string]
}>()

function handleClick(tabId: string) {
  emit('select', tabId)
}

function handleClose(e: MouseEvent, tabId: string) {
  e.stopPropagation()
  emit('close', tabId)
}
</script>

<template>
  <div class="wb-tabbar" role="tablist">
    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="wb-tab"
      :class="{ active: tab.id === activeTabId }"
      role="tab"
      :aria-selected="tab.id === activeTabId"
      :title="tab.title"
      @click="handleClick(tab.id)"
    >
      <span
        v-if="tab.running"
        class="wb-running-dot"
        aria-hidden="true"
      />
      <span class="wb-tab-label">{{ tab.title }}</span>
      <button
        type="button"
        class="wb-tab-close"
        aria-label="关闭 Tab"
        title="关闭"
        @click="handleClose($event, tab.id)"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        >
          <line x1="2" y1="2" x2="8" y2="8" />
          <line x1="8" y1="2" x2="8" y2="8" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.wb-tab-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
</style>