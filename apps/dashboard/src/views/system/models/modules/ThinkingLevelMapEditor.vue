<!--
  modules/ThinkingLevelMapEditor.vue
  复刻 React ModelsConfig.tsx ThinkingLevelMapEditor: 每个 thinking level 一行,三个
  状态: Default (omit) / Disabled (null) / Custom (string)。 map 里的 null entry 是显式
  null(string key 存在但 value null),而不是缺省。

  Props/Emits:
    :modelValue  Record<ThinkingLevel, string | null> | undefined
    @update:modelValue
-->
<template>
  <div class="tlm-editor">
    <div v-for="level in THINKING_LEVELS" :key="level" class="tlm-editor__row">
      <div class="tlm-editor__level">
        <span
          class="tlm-editor__dot"
          :style="{
            background: LEVEL_COLORS[level],
            opacity: stateFor(level) === 'null' ? 0.3 : 1
          }"
        />
        <span
          class="tlm-editor__name"
          :class="{ 'tlm-editor__name--muted': stateFor(level) === 'null' }"
          >{{ level }}</span
        >
      </div>

      <div class="tlm-editor__buttons">
        <ElButton
          size="small"
          :type="stateFor(level) === 'omit' ? 'primary' : 'default'"
          :class="{ 'is-active': stateFor(level) === 'omit' }"
          @click="setLevel(level, 'omit')"
          >Default</ElButton
        >
        <ElButton
          size="small"
          :class="{ 'is-active-disabled': stateFor(level) === 'null' }"
          @click="setLevel(level, null)"
          >Disabled</ElButton
        >
      </div>

      <div class="tlm-editor__custom">
        <ElInput
          :model-value="strFor(level)"
          maxlength="10"
          :placeholder="level"
          size="small"
          @update:model-value="(v: string) => setLevel(level, v || level)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { THINKING_LEVELS, LEVEL_COLORS, type ThinkingLevel } from './types'

  type Entry = string | null
  type RowState = 'omit' | 'null' | 'string'

  const props = defineProps<{
    modelValue: Record<string, Entry> | undefined
  }>()
  const emit = defineEmits<{
    'update:modelValue': [Record<string, Entry> | undefined]
  }>()

  const map = ref<Record<string, Entry>>(props.modelValue ?? {})
  watch(
    () => props.modelValue,
    (v) => {
      map.value = { ...(v ?? {}) }
    }
  )

  const m = computed<Record<string, Entry>>(() => map.value)

  function stateFor(level: ThinkingLevel): RowState {
    if (!(level in m.value)) return 'omit'
    if (m.value[level] === null) return 'null'
    return 'string'
  }

  function strFor(level: ThinkingLevel): string {
    const v = m.value[level]
    return typeof v === 'string' ? v : ''
  }

  function setLevel(level: ThinkingLevel, entry: Entry | 'omit'): void {
    const next = { ...m.value }
    if (entry === 'omit') {
      delete next[level]
    } else {
      next[level] = entry
    }
    map.value = next
    emit('update:modelValue', Object.keys(next).length ? next : undefined)
  }
</script>

<style lang="scss" scoped>
  .tlm-editor {
    display: flex;
    flex-direction: column;
    gap: 2px;

    &__row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px;
    }
    &__level {
      display: flex;
      align-items: center;
      gap: 5px;
      width: 78px;
      flex-shrink: 0;
    }
    &__dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    &__name {
      font-family: var(--el-font-family-monospace, monospace);
      font-size: 11px;
      color: var(--el-text-color-secondary);
      &--muted {
        color: var(--el-text-color-placeholder);
        text-decoration: line-through;
      }
    }
    &__buttons {
      display: flex;
      gap: 4px;
      flex-shrink: 0;

      :deep(.el-button.is-active) {
        background: var(--el-color-primary);
        color: #fff;
      }
      :deep(.el-button.is-active-disabled) {
        background: var(--el-color-danger);
        color: #fff;
      }
    }
    &__custom {
      flex: 0 0 12ch;
    }
  }
</style>
