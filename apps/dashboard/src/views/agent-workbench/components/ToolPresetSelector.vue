<script setup lang="ts">
  /**
   * ToolPresetSelector —— 状态条右侧 tool preset 切换。
   *
   * 三档:none / default / full,常显三选项。当前项 is-active 高亮。
   * 选中仅触发 update:preset[preset],由父级 ChatInput 调
   * setTools(getToolNamesForPreset(preset)) + refreshTools()(职责分层)。
   */
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
  import { CaretBottom } from '@element-plus/icons-vue'
  import type { ToolPreset } from '../types'

  const PRESETS: ToolPreset[] = ['none', 'default', 'full']

  interface Props {
    preset: ToolPreset
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    'update:preset': [preset: ToolPreset]
  }>()

  const open = ref(false)
  const rootRef = ref<HTMLElement | null>(null)

  function toggle(): void {
    open.value = !open.value
  }

  function pick(p: ToolPreset): void {
    open.value = false
    emit('update:preset', p)
  }

  function onDocMouseDown(e: MouseEvent): void {
    if (!open.value) return
    const root = rootRef.value
    if (root && !root.contains(e.target as Node)) {
      open.value = false
    }
  }

  onMounted(() => {
    document.addEventListener('mousedown', onDocMouseDown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocMouseDown)
  })
</script>

<template>
  <div ref="rootRef" class="wb-tool-preset-selector">
    <button
      type="button"
      class="wb-tool-preset-selector__trigger"
      :aria-label="`当前工具预设:${preset},点击切换`"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="wb-tool-preset-selector__label">{{ preset }}</span>
      <el-icon class="wb-tool-preset-selector__caret"><CaretBottom /></el-icon>
    </button>
    <ul v-if="open" class="wb-tool-preset-selector__menu" role="listbox" aria-label="选择工具预设">
      <li
        v-for="p in PRESETS"
        :key="p"
        role="option"
        :aria-selected="p === preset"
        :class="{ 'is-active': p === preset }"
        @click="pick(p)"
      >
        {{ p }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
  .wb-tool-preset-selector {
    position: relative;
    display: inline-block;
  }

  .wb-tool-preset-selector__trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--wb-text-dim);
    font-size: 12px;
    cursor: pointer;
  }

  .wb-tool-preset-selector__trigger:hover {
    background: var(--wb-hover, rgba(0, 0, 0, 0.04));
    color: var(--wb-text);
  }

  .wb-tool-preset-selector__caret {
    font-size: 10px;
    line-height: 1;
  }

  .wb-tool-preset-selector__menu {
    position: absolute;
    bottom: calc(100% + 4px);
    right: 0;
    z-index: 50;
    min-width: 100px;
    margin: 0;
    padding: 4px 0;
    list-style: none;
    background: var(--wb-bg-panel, #fff);
    border: 1px solid var(--wb-border, #e4e7ed);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    color: var(--wb-text);
    font-size: 12px;
  }

  .wb-tool-preset-selector__menu li {
    padding: 6px 10px;
    cursor: pointer;
  }

  .wb-tool-preset-selector__menu li:hover {
    background: var(--wb-hover, rgba(0, 0, 0, 0.04));
  }

  .wb-tool-preset-selector__menu li.is-active {
    background: var(--wb-accent-bg, rgba(64, 158, 255, 0.1));
    color: var(--wb-accent, #409eff);
    font-weight: 600;
  }
</style>