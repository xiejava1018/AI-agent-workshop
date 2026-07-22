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
import TextBlock from './TextBlock.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolCallBlock from './ToolCallBlock.vue'
import ImageBlock from './ImageBlock.vue'

interface Props {
  blocks: readonly AssistantContentBlock[]
}

const props = withDefaults(defineProps<Props>(), {
  blocks: () => [] as readonly AssistantContentBlock[]
})

/**
 * T3.4 MVP stable-key strategy: prefer block.id when present (future T4.x may add it),
 * else fall back to `${type}-${index}` which is stable across re-renders for the same
 * blocks array reference. Good enough for v-for dispatch; will revisit when subcomponents
 * need persistent keyed state.
 */
function blockKey(block: AssistantContentBlock, index: number): string | number {
  const id = (block as { id?: string }).id
  return id ?? `${block.type}-${index}`
}
</script>

<template>
  <template v-if="props.blocks && props.blocks.length > 0">
    <template v-for="(block, index) in props.blocks" :key="blockKey(block, index)">
      <TextBlock
        v-if="block.type === 'text'"
        :block="block"
      />
      <ThinkingBlock
        v-else-if="block.type === 'thinking'"
        :block="block"
        :streaming="false"
      />
      <ToolCallBlock
        v-else-if="block.type === 'toolCall'"
        :block="block"
      />
      <ImageBlock
        v-else-if="block.type === 'image'"
        :block="block"
      />
    </template>
  </template>
</template>

<style scoped>
/* BlockView 仅做分发,样式由各子组件 + 父级 bubble 容器提供 */
</style>