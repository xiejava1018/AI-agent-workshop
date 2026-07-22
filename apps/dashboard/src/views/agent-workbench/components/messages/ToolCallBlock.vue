<script setup lang="ts">
/** T3.5 stub — replaced by real ToolCallBlock in T4.3 */
import type { ToolCallContent } from '../../types/assistant-blocks'

interface Props {
  block: ToolCallContent
}
withDefaults(defineProps<Props>(), {})
</script>

<template>
  <span data-testid="wb-block-toolcall" class="wb-block-toolcall-stub">{{ block.toolName }}</span>
</template>

<style scoped>
.wb-block-toolcall-stub { display: inline; }
</style>
