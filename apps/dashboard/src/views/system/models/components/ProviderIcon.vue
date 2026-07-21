<template>
  <span class="provider-icon" :style="{ background: bg, color: fg }">{{ label }}</span>
</template>

<script setup lang="ts">
  import { computed } from 'vue'

  const props = defineProps<{ id: string; size?: number }>()

  // 已知供应商的品牌色（背景/文字）。未命中的走按名称哈希出的稳定色。
  const BRAND: Record<string, { bg: string; fg: string; label?: string }> = {
    anthropic: { bg: '#d97757', fg: '#fff', label: 'A' },
    openai: { bg: '#10a37f', fg: '#fff', label: 'AI' },
    'openai-codex': { bg: '#10a37f', fg: '#fff', label: 'AI' },
    google: { bg: '#4285f4', fg: '#fff', label: 'G' },
    'google-vertex': { bg: '#4285f4', fg: '#fff', label: 'G' },
    deepseek: { bg: '#4d6bfe', fg: '#fff', label: 'DS' },
    qwen: { bg: '#615ced', fg: '#fff', label: 'Q' },
    zhipu: { bg: '#3859ff', fg: '#fff', label: 'Z' },
    moonshotai: { bg: '#16181d', fg: '#fff', label: 'M' },
    minimax: { bg: '#ff3d00', fg: '#fff', label: 'MM' },
    mistral: { bg: '#fa520f', fg: '#fff', label: 'M' },
    groq: { bg: '#f55036', fg: '#fff', label: 'G' },
    'github-copilot': { bg: '#1f2328', fg: '#fff', label: 'GH' },
    xai: { bg: '#111111', fg: '#fff', label: 'xAI' },
    grok: { bg: '#111111', fg: '#fff', label: 'xAI' },
    openrouter: { bg: '#6467f2', fg: '#fff', label: 'OR' },
    fireworks: { bg: '#ef4d3c', fg: '#fff', label: 'FW' },
    together: { bg: '#0f6fff', fg: '#fff', label: 'TG' },
    perplexity: { bg: '#20808d', fg: '#fff', label: 'P' },
    cohere: { bg: '#39594d', fg: '#fff', label: 'C' },
    nvidia: { bg: '#76b900', fg: '#fff', label: 'NV' },
    cerebras: { bg: '#e2364d', fg: '#fff', label: 'CB' }
  }

  const palette = [
    '#5b6cff',
    '#0ea5e9',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#14b8a6',
    '#f97316',
    '#6366f1'
  ]

  function hash(str: string): number {
    let h = 0
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
    return h
  }

  const label = computed(() => {
    const b = BRAND[props.id]
    if (b?.label) return b.label
    // 取 id 首段前 2 个字符大写
    return (
      props.id
        .replace(/[/-].*/, '')
        .slice(0, 2)
        .toUpperCase() || '?'
    )
  })

  const bg = computed(() => {
    const b = BRAND[props.id]
    if (b) return b.bg
    return palette[hash(props.id) % palette.length]
  })

  const fg = computed(() => {
    const b = BRAND[props.id]
    return b ? b.fg : '#fff'
  })
</script>

<style scoped>
  .provider-icon {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: v-bind('(size || 18) + "px"');
    height: v-bind('(size || 18) + "px"');
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
    border-radius: 5px;
  }
</style>
