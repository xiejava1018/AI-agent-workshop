<script setup lang="ts">
/**
 * ImageBlock —— 渲染 AssistantContentBlock['type' === 'image'] 的图片。
 *
 * 两种 source 形态:
 *   - source.type === 'url' → safeUrl 校验后 <img :src="source.url">
 *   - source.type === 'base64' → data URL 直接用(无需 safeUrl,服务端发来安全)
 *
 * safeUrl 复制自 MarkdownBody(那里非 export)。这里独立实现一份以保持组件自含。
 * 没有 alt 字段(类型不存在);fallback 是 'image'。
 * 加载失败:@error 显示占位。
 *
 * 对应 OpenSpec spec.md "ImageBlock 组件契约" Requirement。
 */
import { ref } from 'vue'
import type { ImageContent } from '../../types/assistant-blocks'

const SAFE_URL_SCHEMES = new Set(['http:', 'https:'])

function safeUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  const trimmed = url.trim()
  if (!trimmed) return undefined
  try {
    const parsed = new URL(trimmed)
    return SAFE_URL_SCHEMES.has(parsed.protocol) ? trimmed : undefined
  } catch {
    return undefined
  }
}

interface Props {
  block: ImageContent
}

const props = defineProps<Props>()

const errored = ref(false)

const imgSrc = (() => {
  const src = props.block.source
  if (src.type === 'base64') {
    return `data:${src.media_type ?? 'image/png'};base64,${src.data}`
  }
  if (src.type === 'url') {
    const safe = safeUrl(src.url)
    return safe ?? ''
  }
  return ''
})()

function onError(): void {
  errored.value = true
}
</script>

<template>
  <div class="wb-image" :class="{ 'wb-image--errored': errored }">
    <img v-if="!errored" :src="imgSrc" alt="image" @error="onError" />
    <div v-else class="wb-image__fallback">
      图片加载失败,请刷新或重试
    </div>
  </div>
</template>

<style scoped>
.wb-image img { max-width: 100%; height: auto; border-radius: 4px; }
.wb-image__fallback {
  padding: 12px;
  background: var(--wb-bg-elevated, rgba(0, 0, 0, 0.03));
  border-radius: 4px;
  color: var(--wb-text-dim);
  font-size: 12px;
}
</style>
