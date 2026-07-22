<script setup lang="ts">
/** T3.5 stub — replaced by real TextBlock in T4.1 */
import type { TextContent } from '../../types/assistant-blocks'

interface Props {
  block: TextContent
}
withDefaults(defineProps<Props>(), {})
</script>

<template>
  <span data-testid="wb-block-text" class="wb-block-text-stub">{{ block.text }}</span>
</template>

<style scoped>
.wb-block-text-stub { display: inline; }
</style>
