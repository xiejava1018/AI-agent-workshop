<script setup lang="ts">
/**
 * TextBlock —— 渲染 AssistantContentBlock['type' === 'text'] 的文本块。
 *
 * 复用 MarkdownBody 的 markdown-it + DOMPurify + safeUrl 管线,原封不动。
 * 不附加任何 chrome(没有 header / footer / 时间戳 / USER 标签)。
 *
 * 对应 OpenSpec spec.md "TextBlock 组件契约" Requirement。
 */
import type { TextContent } from '../../types/assistant-blocks'
import MarkdownBody from '../MarkdownBody.vue'

interface Props {
  block: TextContent
}

const props = defineProps<Props>()
</script>

<template>
  <MarkdownBody :content="props.block.text" />
</template>
