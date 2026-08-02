<!--
  views/skill-curated/modules/CuratedDetail.vue

  技能详情 (只读)。emit 'edit' 让父切到编辑态。
-->
<template>
  <div class="curated-detail" v-if="entry">
    <div class="d-section">
      <h3>{{ entry.name }}</h3>
      <div class="d-slug">{{ entry.slug }}</div>
      <div class="d-tags">
        <el-tag v-for="t in entry.tags" :key="t" size="small" effect="plain">{{ t }}</el-tag>
        <el-tag v-if="entry.featured" type="warning" size="small">精选</el-tag>
        <el-tag :type="entry.enabled ? 'success' : 'info'" size="small">
          {{ entry.enabled ? '启用' : '停用' }}
        </el-tag>
      </div>
    </div>

    <el-descriptions :column="2" border size="small">
      <el-descriptions-item label="分类">{{ entry.category }}</el-descriptions-item>
      <el-descriptions-item label="版本">v{{ entry.version }}</el-descriptions-item>
      <el-descriptions-item label="作者">{{ entry.author || '—' }}</el-descriptions-item>
      <el-descriptions-item label="安装次数">{{ entry.installCount }}</el-descriptions-item>
      <el-descriptions-item label="来源类型">
        <el-tag size="small">{{ sourceKindLabel(entry.sourceKind) }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="可见性">{{ entry.visibility }}</el-descriptions-item>
      <el-descriptions-item label="源文件路径" :span="2">
        <code>{{ entry.sourceFilePath || '—' }}</code>
      </el-descriptions-item>
      <el-descriptions-item v-if="entry.sourceUrl" label="源 URL" :span="2">
        <el-link :href="entry.sourceUrl" target="_blank" type="primary">{{
          entry.sourceUrl
        }}</el-link>
      </el-descriptions-item>
    </el-descriptions>

    <div v-if="entry.summary" class="d-section">
      <h4>摘要</h4>
      <p>{{ entry.summary }}</p>
    </div>
    <div v-if="entry.description" class="d-section">
      <h4>描述</h4>
      <p class="d-desc">{{ entry.description }}</p>
    </div>

    <div class="d-actions" v-if="!readonly">
      <el-button type="primary" @click="$emit('edit')">编辑</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import type { CuratedSkillMeta, CuratedSourceKind } from '@/api/curated-skills'

  defineProps<{ entry: CuratedSkillMeta; readonly?: boolean }>()
  defineEmits<{ (e: 'edit'): void }>()

  function sourceKindLabel(k: CuratedSourceKind): string {
    const map: Record<CuratedSourceKind, string> = {
      builtin: '内置',
      local: '本地',
      remote: '远程',
      package: '包'
    }
    return map[k] ?? k
  }
</script>

<style scoped>
  .curated-detail {
    padding: 0 20px;
  }
  .d-section {
    margin-bottom: 20px;
  }
  .d-section h3 {
    margin: 0 0 4px;
  }
  .d-section h4 {
    margin: 0 0 8px;
    color: var(--el-text-color-secondary);
  }
  .d-slug {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    font-family: monospace;
  }
  .d-tags {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .d-desc {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13px;
  }
  .d-actions {
    margin-top: 24px;
  }
</style>
