<!--
  modules/HeadersEditor.vue
  Key/value 多行编辑。 用 v-model。
-->
<template>
  <div class="headers-editor">
    <div v-for="(row, i) in rows" :key="i" class="headers-editor__row">
      <ElInput
        v-model="row.key"
        placeholder="Header 名"
        size="small"
        class="headers-editor__key"
        @change="emit"
      />
      <ElInput
        v-model="row.value"
        placeholder="值"
        size="small"
        class="headers-editor__value"
        @change="emit"
      />
      <ElButton :icon="Delete" size="small" link @click="remove(i)" />
    </div>
    <ElButton :icon="Plus" size="small" link @click="add">添加 header</ElButton>
  </div>
</template>

<script setup lang="ts">
  import { ref, watch } from 'vue'
  import { Plus, Delete } from '@element-plus/icons-vue'
  import type { HeaderEntry } from './types'

  const props = defineProps<{
    modelValue: Record<string, string> | undefined
  }>()
  const emitUpdate = defineEmits<{
    'update:modelValue': [Record<string, string>]
  }>()

  function toRows(input: Record<string, string> | undefined): HeaderEntry[] {
    const entries = Object.entries(input ?? {})
    if (entries.length === 0) return []
    return entries.map(([key, value]) => ({ key, value }))
  }

  const rows = ref<HeaderEntry[]>(toRows(props.modelValue))

  watch(
    () => props.modelValue,
    (v) => {
      rows.value = toRows(v)
    }
  )

  function emit(): void {
    const obj: Record<string, string> = {}
    for (const r of rows.value) {
      if (r.key) obj[r.key] = r.value
    }
    emitUpdate('update:modelValue', obj)
  }

  function add(): void {
    rows.value.push({ key: '', value: '' })
  }

  function remove(i: number): void {
    rows.value.splice(i, 1)
    emit()
  }
</script>

<style lang="scss" scoped>
  .headers-editor {
    display: flex;
    flex-direction: column;
    gap: 6px;

    &__row {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    &__key {
      flex: 1;
    }
    &__value {
      flex: 2;
    }
  }
</style>
