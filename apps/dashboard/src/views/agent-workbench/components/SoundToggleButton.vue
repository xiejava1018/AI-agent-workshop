<!--
  SoundToggleButton —— 完成提示音开关按钮。
  对齐 apps/web/components/ChatInput.tsx 第 1859~1891 行的 onSoundToggle 按钮:
    - 32x32 square,无 border 透明背景,hover 时 var(--bg-hover)
    - soundEnabled=true  → 实色喇叭图标(三道音波弧),normal opacity
    - soundEnabled=false → 喇叭 + 叉号图标(降透明度到 0.55 提示关闭)
-->
<script setup lang="ts">
  interface Props {
    soundEnabled: boolean
  }
  const props = defineProps<Props>()

  const emit = defineEmits<{
    'update:soundEnabled': [enabled: boolean]
  }>()

  function toggle(): void {
    emit('update:soundEnabled', !props.soundEnabled)
  }
</script>

<template>
  <button
    type="button"
    class="wb-sound-toggle"
    :title="soundEnabled ? '关闭完成提示音' : '开启完成提示音'"
    :aria-label="soundEnabled ? '关闭完成提示音' : '开启完成提示音'"
    @click="toggle"
  >
    <svg
      v-if="soundEnabled"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
    <svg
      v-else
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  </button>
</template>

<style scoped>
  .wb-sound-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 9px;
    color: var(--wb-text-dim, #a8abb2);
    cursor: pointer;
    /* apps/web:开启时正常色,关闭时把不透明度降到 0.55 暗示禁用 */
    opacity: 1;
    transition:
      background-color 0.12s ease,
      color 0.12s ease,
      opacity 0.12s ease;
  }

  .wb-sound-toggle:hover {
    background: var(--wb-hover, rgba(0, 0, 0, 0.04));
    color: var(--wb-text);
    opacity: 1;
  }

  /* 关闭态(opacity 降到 0.55);但 hover 时强制恢复 1 提供悬停反馈 */
  .wb-sound-toggle[aria-label='开启完成提示音'] {
    color: var(--wb-text-dim);
    opacity: 0.55;
  }
  .wb-sound-toggle[aria-label='开启完成提示音']:hover {
    opacity: 1;
  }
</style>
