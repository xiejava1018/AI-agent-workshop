<template>
  <AppShell />
</template>

<script setup lang="ts">
  /**
   * Agent 工作台主路由(/workspace/agent)的薄壳入口。
   *
   * 三栏布局、Tab 切换、抽屉面板、SSE 流等所有逻辑均在 AppShell.vue 内。
   * 老实现(693 行单文件)保留在 index.old.vue,供对比 / 回退参考。
   *
   * 注意:styles/workbench.css 提供 .agent-workbench 三栏 flex 布局 +
   * 所有 .wb-* 子组件样式,必须在此入口引入(老 index.vue 同样在头部 import)。
   * AppShell 根 div 带 art-full-height class,workbench.css 用
   * var(--art-full-height) 拿到模板算好的可用区高度(已减 header/tabs)。
   *
   * 历史:
   * - 2026-07-19: 切换到 AppShell.vue(Track A/B/C 合并 + AppShell 集成)
   *               2026-07-19 hotfix: 补回 workbench.css import + art-full-height 高度
   */
  import './styles/workbench.css'
  import AppShell from './AppShell.vue'
</script>
