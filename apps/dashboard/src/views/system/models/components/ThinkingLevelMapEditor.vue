<template>
  <div class="level-map">
    <div v-for="level in THINKING_LEVELS" :key="level" class="level-row">
      <div class="level-badge">
        <span
          class="dot"
          :style="{ background: LEVEL_COLORS[level], opacity: stateOf(level) === 'null' ? 0.3 : 1 }"
        />
        <span class="level-name" :class="{ strike: stateOf(level) === 'null' }">{{ level }}</span>
      </div>
      <ElRadioGroup
        :model-value="modeOf(level)"
        size="small"
        @update:model-value="(m) => onMode(level, m as Mode)"
      >
        <ElRadioButton value="omit">默认</ElRadioButton>
        <ElRadioButton value="null">禁用</ElRadioButton>
        <ElRadioButton value="string">自定义</ElRadioButton>
      </ElRadioGroup>
      <ElInput
        v-if="modeOf(level) === 'string'"
        size="small"
        :model-value="strVal(level)"
        placeholder="thinking 值"
        @update:model-value="(v) => setCustom(level, v)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
  import { THINKING_LEVELS, type ThinkingLevel } from '@/api/models-config'

  const props = defineProps<{ value?: Record<string, string | null> }>()
  const emit = defineEmits<{ change: [v: Record<string, string | null> | undefined] }>()

  const LEVEL_COLORS: Record<ThinkingLevel, string> = {
    off: '#9ca3af',
    minimal: '#6b7280',
    low: '#60a5fa',
    medium: '#a78bfa',
    high: '#f472b6',
    xhigh: '#fb923c',
    max: '#ef4444'
  }

  type Mode = 'omit' | 'null' | 'string'

  function stateOf(level: ThinkingLevel): 'omit' | 'null' | 'string' {
    const map = props.value ?? {}
    if (!(level in map)) return 'omit'
    return map[level] === null ? 'null' : 'string'
  }
  function modeOf(level: ThinkingLevel): Mode {
    return stateOf(level)
  }
  function strVal(level: ThinkingLevel): string {
    return (props.value?.[level] as string) ?? ''
  }

  function apply(next: Record<string, string | null>) {
    emit('change', Object.keys(next).length ? next : undefined)
  }

  function onMode(level: ThinkingLevel, mode: Mode) {
    const map = { ...(props.value ?? {}) }
    if (mode === 'omit') delete map[level]
    else if (mode === 'null') map[level] = null
    else map[level] = strVal(level) || level
    apply(map)
  }

  function setCustom(level: ThinkingLevel, v: string) {
    apply({ ...(props.value ?? {}), [level]: v })
  }
</script>

<style scoped>
  .level-map {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .level-row {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .level-badge {
    display: flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;
    width: 72px;
  }

  .dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .level-name {
    font-family: var(--el-font-family-mono, ui-monospace, monospace);
    font-size: 11px;
    color: var(--el-text-color-regular);
  }

  .strike {
    color: var(--el-text-color-placeholder);
    text-decoration: line-through;
  }
</style>
