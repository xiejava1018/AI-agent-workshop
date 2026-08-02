<!--
  ToolPresetSelector —— 工具集预设下拉。

  完全对齐 apps/web/components/ChatInput.tsx 第 1692-1777 行的 tool preset 下拉:
    - 32px 高透明背景 button + 扳手 SVG + 当前 preset label
    - hover 时:背景 var(--bg-hover),文字 muted → text
    - 下拉从按钮上方展开(bottom: calc(100% + 6px), right: 0),每项含:
      · ✓ 选中标记
      · preset 标签
      · 右对齐 description("No tools, read-only" / "4 built-in tools" /
        "All built-in tools")

  视觉差异(枚举值 vs apps/web):
    - apps/web 内部枚举:off / default / full(对应 preset 值 none / default / full)
    - dashboard 内部 ToolPreset 是 'none' / 'default' / 'full'
    - 这里 UI label 用 apps/web 风格("Off" / "Default" / "Full"),内部仍按 dashboard
      ToolPreset 发送,所以约定不变。
-->
<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
  import type { ToolPreset } from '../types'

  /** 与 apps/web TOOL_PRESETS + DESC 同顺序。后端实际值看 showLabel 的映射。 */
  const PRESETS: ToolPreset[] = ['none', 'default', 'full']

  const PRESET_DESC: Record<ToolPreset, string> = {
    none: '无工具,只读',
    default: '4 个内置工具',
    full: '全部内置工具'
  }

  /** dashboard 内部 'none' 与 apps/web 'off' 同义,UI 显示统一用 "Off" 风格 */
  const PRESET_LABEL: Record<ToolPreset, string> = {
    none: 'Off',
    default: 'Default',
    full: 'Full'
  }

  interface Props {
    preset: ToolPreset
    /** streaming 时由父级传 true 把控件隐藏 —— apps/web 用 `!isStreaming && onToolPresetChange` */
    disabledByStreaming?: boolean
  }

  const props = withDefaults(defineProps<Props>(), {
    disabledByStreaming: false
  })

  const emit = defineEmits<{
    'update:preset': [preset: ToolPreset]
  }>()

  const open = ref(false)
  const rootRef = ref<HTMLElement | null>(null)

  const displayLabel = computed<string>(() => PRESET_LABEL[props.preset])

  function toggle(): void {
    if (props.disabledByStreaming) return
    open.value = !open.value
  }

  function pick(p: ToolPreset): void {
    open.value = false
    // 始终 emit,即使值不变 — 用户选择是对状态的“明确意图”,不能跳过;
    // (聊天窗口可能需要重发 / 调整请求)。父级 ChatInput 内部用 setTools
    // + refreshTools 是幂等的,重复发不会出问题。
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
      :class="['wb-tool-preset-selector__trigger', { 'is-open': open }]"
      :title="`调整工具预设:${displayLabel}`"
      aria-label="调整工具预设"
      :aria-expanded="open"
      :disabled="disabledByStreaming"
      @click="toggle"
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
      <span class="wb-tool-preset-selector__label">{{ displayLabel }}</span>
    </button>

    <div
      v-if="open"
      class="wb-tool-preset-selector__menu"
      role="listbox"
      aria-label="选择工具预设"
    >
      <button
        v-for="p in PRESETS"
        :key="p"
        type="button"
        role="option"
        :aria-selected="p === preset"
        :class="['wb-tool-preset-selector__option', { 'is-active': p === preset }]"
        @click="pick(p)"
      >
        <svg
          v-if="p === preset"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="var(--wb-accent, #409eff)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="wb-tool-preset-selector__check"
        >
          <polyline points="1.5 5 4 7.5 8.5 2.5" />
        </svg>
        <span v-else class="wb-tool-preset-selector__check-spacer" />
        <span class="wb-tool-preset-selector__option-label">{{ PRESET_LABEL[p] }}</span>
        <span class="wb-tool-preset-selector__option-desc">{{ PRESET_DESC[p] }}</span>
      </button>
    </div>
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
    justify-content: center;
    gap: 5px;
    padding: 8px 12px;
    height: 32px;
    background: transparent;
    border: none;
    border-radius: 9px;
    color: var(--wb-text-dim, #a8abb2);
    cursor: pointer;
    font-size: 12px;
    opacity: 1;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }

  .wb-tool-preset-selector__trigger:hover:not(:disabled),
  .wb-tool-preset-selector__trigger.is-open {
    background: var(--wb-hover, rgba(0, 0, 0, 0.04));
    color: var(--wb-text);
  }

  .wb-tool-preset-selector__trigger:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .wb-tool-preset-selector__label {
    white-space: nowrap;
  }

  .wb-tool-preset-selector__menu {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    z-index: 100;
    min-width: 140px;
    background: var(--wb-bg, #fff);
    border: 1px solid var(--wb-border, #e4e7ed);
    border-radius: 8px;
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    padding: 4px 0;
  }

  .wb-tool-preset-selector__option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 12px;
    background: transparent;
    border: none;
    color: var(--wb-text-dim, #a8abb2);
    cursor: pointer;
    font-size: 12px;
    font-weight: 400;
    text-align: left;
    white-space: nowrap;
    transition: background-color 0.12s ease;
  }

  .wb-tool-preset-selector__option:hover:not(.is-active) {
    background: var(--wb-hover, rgba(0, 0, 0, 0.04));
  }

  .wb-tool-preset-selector__option.is-active {
    background: var(--wb-accent-bg, rgba(64, 158, 255, 0.1));
    color: var(--wb-text);
    font-weight: 600;
  }

  .wb-tool-preset-selector__check {
    flex-shrink: 0;
  }
  .wb-tool-preset-selector__check-spacer {
    width: 10px;
    flex-shrink: 0;
  }

  .wb-tool-preset-selector__option-label {
    flex: 1;
  }

  .wb-tool-preset-selector__option-desc {
    font-size: 11px;
    color: var(--wb-text-dim);
    margin-left: 8px;
    flex-shrink: 0;
  }
</style>
