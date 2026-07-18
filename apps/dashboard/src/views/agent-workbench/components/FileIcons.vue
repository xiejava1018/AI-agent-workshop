<script setup lang="ts">
  import { computed } from 'vue'
  import {
    Document,
    Folder,
    FolderOpened,
    Picture,
    VideoPlay,
    Setting
  } from '@element-plus/icons-vue'

  interface Props {
    filename: string
    isDir: boolean
    expanded?: boolean
  }

  const props = withDefaults(defineProps<Props>(), { expanded: false })

  const iconComponent = computed(() => {
    if (props.isDir) return props.expanded ? FolderOpened : Folder
    const lower = props.filename.toLowerCase()
    if (/\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/.test(lower)) return Picture
    if (/\.(mp3|wav|ogg|opus|m4a|aac|flac|webm)$/.test(lower)) return VideoPlay
    if (/\.(config\.)?(json|ya?ml|toml)$/.test(lower) || lower === '.env' || lower.includes('lock'))
      return Setting
    return Document
  })

  const label = computed(() => {
    if (props.isDir) return ''
    const lower = props.filename.toLowerCase()
    if (lower.endsWith('.tsx')) return 'TSX'
    if (lower.endsWith('.ts')) return 'TS'
    if (/\.(jsx?|mjs|cjs)$/.test(lower)) return 'JS'
    if (lower.endsWith('.py')) return 'PY'
    if (/\.jsonl?$/.test(lower)) return '{}'
    if (/\.mdx?$/.test(lower)) return 'M↓'
    if (/\.(css|scss|less)$/.test(lower)) return 'CSS'
    if (/\.ya?ml$/.test(lower)) return 'YML'
    if (lower.endsWith('.sql')) return 'SQL'
    if (lower.endsWith('.rs')) return 'RS'
    if (lower.endsWith('.go')) return 'GO'
    if (lower.endsWith('.pdf')) return 'PDF'
    if (lower.endsWith('.docx')) return 'DOC'
    return ''
  })
</script>

<template>
  <span class="wb-file-icon" :title="filename" aria-hidden="true">
    <el-icon v-if="!label" :size="15"><component :is="iconComponent" /></el-icon>
    <span v-else class="wb-file-icon__label">{{ label }}</span>
  </span>
</template>

<style scoped>
  .wb-file-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    color: var(--wb-text-muted);
  }

  .wb-file-icon__label {
    font-family: var(--wb-font-mono);
    font-size: 8px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.05em;
  }
</style>
