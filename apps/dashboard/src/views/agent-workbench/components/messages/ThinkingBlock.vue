<script setup lang="ts">
/** T3.5 stub — replaced by real ThinkingBlock in T4.2 */
import type { ThinkingContent } from '../../types/assistant-blocks'

interface Props {
  block: ThinkingContent
  streaming?: boolean
}
withDefaults(defineProps<Props>(), { streaming: false })
</script>

<template>
  <span data-testid="wb-block-thinking" class="wb-block-thinking-stub">{{ block.thinking }}</span>
</template>

<style scoped>
.wb-block-thinking-stub { display: inline; }
</style>
