<script setup lang="ts">
  /**
   * BranchNavigator — 单条消息上多分支版本的简易切换器。
   *
   * apps/web 的 BranchNavigator 是一个带缩进的复杂树(支持嵌套 / 多层分支),
   * 完整复刻需要 ~400 行 + 一堆 SVG / 缩进计算。Vue 端 v1 我们只暴露
   * 「◀ 1/3 ▶」+ 分支标题 的紧凑按钮组,简化交互,等同 apps/web 的
   * "linear chain between branches" 用法(没有树状结构)。
   *
   * props / emits 与 design §"组件契约 / BranchNavigator.vue" 一致。
   */
  import { computed } from 'vue'
  import type { Branch } from '../types'

  interface Props {
    branches: readonly Branch[]
    currentBranchId: string
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    switch: [branchId: string]
  }>()

  const currentIndex = computed(() => {
    return props.branches.findIndex((b) => b.id === props.currentBranchId)
  })

  const currentBranch = computed(() => {
    return props.branches[currentIndex.value] ?? null
  })

  function goPrev(): void {
    if (currentIndex.value <= 0) return
    const prev = props.branches[currentIndex.value - 1]
    if (prev) emit('switch', prev.id)
  }

  function goNext(): void {
    if (currentIndex.value < 0 || currentIndex.value >= props.branches.length - 1) return
    const next = props.branches[currentIndex.value + 1]
    if (next) emit('switch', next.id)
  }
</script>

<template>
  <div v-if="branches.length > 1" class="wb-branch-nav" role="group" aria-label="分支切换">
    <button
      type="button"
      class="wb-branch-nav__btn"
      :disabled="currentIndex <= 0"
      aria-label="上一分支"
      @click="goPrev"
    >
      ◀
    </button>
    <span class="wb-branch-nav__count"> {{ currentIndex + 1 }}/{{ branches.length }} </span>
    <button
      type="button"
      class="wb-branch-nav__btn"
      :disabled="currentIndex >= branches.length - 1"
      aria-label="下一分支"
      @click="goNext"
    >
      ▶
    </button>
    <span v-if="currentBranch?.title" class="wb-branch-nav__title" :title="currentBranch.title">
      {{ currentBranch.title }}
    </span>
  </div>
</template>

<style scoped>
  .wb-branch-nav__count {
    font-variant-numeric: tabular-nums;
    color: var(--wb-text-muted);
  }

  .wb-branch-nav__title {
    color: var(--wb-text-dim);
    font-size: 12px;
    margin-left: 8px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
