<script setup lang="ts">
/** T3.5 stub — replaced by real ImageBlock in T4.4 */
import type { ImageContent } from '../../types/assistant-blocks'

interface Props {
  block: ImageContent
}
withDefaults(defineProps<Props>(), {})
</script>

<template>
  <span data-testid="wb-block-image" class="wb-block-image-stub">image</span>
</template>

<style scoped>
.wb-block-image-stub { display: inline; }
</style>
