<script setup lang="ts">
  import { computed, onMounted, ref, toRef } from 'vue'
  import { ElNotification } from 'element-plus'
  import FileIcons from './FileIcons.vue'
  import { useFileExplorer } from '../composables/useFileExplorer'
  import type { FileNode } from '../types'
  import { safeFilePath } from '../types'

  interface Props {
    sessionId: string
    rootPath?: string
  }

  const props = withDefaults(defineProps<Props>(), { rootPath: '' })
  const emit = defineEmits<{
    fileOpen: [path: string]
    fileChanged: [path: string]
  }>()

  const explorer = useFileExplorer(toRef(props, 'sessionId'))
  const hoverPath = ref<string | null>(null)

  const loadError = computed(() => explorer.error.value)

  const notifyError = (message: string): void => {
    ElNotification({
      title: '文件浏览失败',
      message,
      type: 'error'
    })
  }

  const onToggle = async (node: FileNode): Promise<void> => {
    try {
      await explorer.toggleExpand(node.path)
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error))
    }
  }

  const onNodeClick = (node: FileNode): void => {
    const safePath = safeFilePath(node.path, props.rootPath || undefined)
    if (!safePath) {
      notifyError('文件路径无效')
      return
    }
    explorer.select(safePath)
    if (!node.isDir) emit('fileOpen', safePath)
  }

  const load = async (): Promise<void> => {
    try {
      await explorer.loadTree(props.rootPath)
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error))
    }
  }

  onMounted(load)
</script>

<template>
  <section class="wb-file-explorer" aria-label="文件浏览器">
    <div v-if="explorer.loading.value" class="wb-file-explorer__state">正在加载文件...</div>
    <div v-else-if="loadError" class="wb-file-explorer__state wb-file-explorer__state--error">
      {{ loadError }}
    </div>
    <div v-else-if="explorer.tree.value.length === 0" class="wb-file-explorer__state">暂无文件</div>
    <ul v-else class="wb-file-tree" role="tree">
      <li v-for="node in explorer.tree.value" :key="node.path" role="treeitem">
        <button
          class="wb-file-tree__row"
          :class="{ 'is-selected': explorer.selectedPath.value === node.path }"
          :style="{ paddingLeft: `${8}px` }"
          type="button"
          :aria-expanded="node.isDir ? explorer.expanded.value.has(node.path) : undefined"
          @mouseenter="hoverPath = node.path"
          @mouseleave="hoverPath = null"
          @click="onNodeClick(node)"
        >
          <span
            class="wb-file-tree__toggle"
            :class="{ 'is-placeholder': !node.isDir }"
            @click.stop="node.isDir && onToggle(node)"
          >
            {{ node.isDir ? (explorer.expanded.value.has(node.path) ? '▼' : '▶') : '' }}
          </span>
          <FileIcons
            :filename="node.name"
            :is-dir="node.isDir"
            :expanded="explorer.expanded.value.has(node.path)"
          />
          <span class="wb-file-tree__name" :title="node.path">{{ node.name }}</span>
          <span v-if="hoverPath === node.path && node.isDir" class="wb-file-tree__hint">展开</span>
        </button>
        <ul
          v-if="node.isDir && explorer.expanded.value.has(node.path) && node.children"
          class="wb-file-tree wb-file-tree--nested"
          role="group"
        >
          <li v-for="child in node.children" :key="child.path" role="treeitem">
            <button
              class="wb-file-tree__row"
              :class="{ 'is-selected': explorer.selectedPath.value === child.path }"
              type="button"
              :aria-expanded="child.isDir ? explorer.expanded.value.has(child.path) : undefined"
              @click="onNodeClick(child)"
            >
              <span
                class="wb-file-tree__toggle"
                :class="{ 'is-placeholder': !child.isDir }"
                @click.stop="child.isDir && onToggle(child)"
              >
                {{ child.isDir ? (explorer.expanded.value.has(child.path) ? '▼' : '▶') : '' }}
              </span>
              <FileIcons
                :filename="child.name"
                :is-dir="child.isDir"
                :expanded="explorer.expanded.value.has(child.path)"
              />
              <span class="wb-file-tree__name" :title="child.path">{{ child.name }}</span>
            </button>
            <ul
              v-if="child.isDir && explorer.expanded.value.has(child.path) && child.children"
              class="wb-file-tree wb-file-tree--nested"
              role="group"
            >
              <li v-for="grandchild in child.children" :key="grandchild.path" role="treeitem">
                <button class="wb-file-tree__row" type="button" @click="onNodeClick(grandchild)">
                  <span class="wb-file-tree__toggle is-placeholder"></span>
                  <FileIcons :filename="grandchild.name" :is-dir="grandchild.isDir" />
                  <span class="wb-file-tree__name" :title="grandchild.path">{{
                    grandchild.name
                  }}</span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </li>
    </ul>
  </section>
</template>

<style scoped>
  .wb-file-explorer {
    min-height: 0;
    overflow: auto;
    color: var(--wb-text);
    font-family: var(--wb-font-sans);
  }

  .wb-file-explorer__state {
    padding: var(--wb-pad-md);
    color: var(--wb-text-muted);
    font-size: 12px;
  }

  .wb-file-explorer__state--error {
    color: var(--wb-danger);
  }

  .wb-file-tree {
    margin: 0;
    padding: 2px 4px;
    list-style: none;
  }

  .wb-file-tree--nested {
    padding-left: 14px;
  }

  .wb-file-tree__row {
    display: flex;
    align-items: center;
    gap: var(--wb-pad-xs);
    width: 100%;
    min-height: 26px;
    padding-top: 2px;
    padding-bottom: 2px;
    border: 0;
    border-radius: var(--wb-radius-sm);
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .wb-file-tree__row:hover,
  .wb-file-tree__row.is-selected {
    background: var(--wb-bg-hover);
  }

  .wb-file-tree__row.is-selected {
    outline: 1px solid color-mix(in srgb, var(--wb-accent) 40%, transparent);
  }

  .wb-file-tree__toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    color: var(--wb-text-muted);
    font-size: 9px;
  }

  .wb-file-tree__toggle.is-placeholder {
    color: transparent;
  }

  .wb-file-tree__name {
    min-width: 0;
    overflow: hidden;
    color: var(--wb-text);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wb-file-tree__hint {
    margin-left: auto;
    color: var(--wb-text-muted);
    font-size: 10px;
  }
</style>
