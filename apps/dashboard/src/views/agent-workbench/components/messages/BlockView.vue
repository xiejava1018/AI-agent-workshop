<script setup lang="ts">
/**
 * BlockView —— assistant 消息内容级分发组件(参考 apps/web/components/MessageView.tsx 的 BlockView)。
 *
 * 接收 AssistantContentBlock[] 并按 block.type 分发到子组件:
 *   text → TextBlock
 *   thinking → ThinkingBlock
 *   toolCall → ToolCallBlock
 *   image → ImageBlock
 *
 * 4 个子组件在本目录下(T4.x),本组件只负责分发。
 * 空数组 / null → 渲染空 fragment(由父级 MessageView 决定空态)。
 *
 * 对应 OpenSpec spec.md "BlockView 组件契约" Requirement。
 */
import type { AssistantContentBlock } from '../../types/assistant-blocks'

interface Props {
  blocks: readonly AssistantContentBlock[]
}

withDefaults(defineProps<Props>(), {
  blocks: () => [] as readonly AssistantContentBlock[]
})
</script>

<template>
  <!-- T3.2 will fill the v-for dispatch; T3.1 leaves it empty for now -->
  <span data-testid="wb-block-view-placeholder" />
</template>

<style scoped>
/* BlockView 仅做分发,样式由各子组件 + 父级 bubble 容器提供 */
</style>