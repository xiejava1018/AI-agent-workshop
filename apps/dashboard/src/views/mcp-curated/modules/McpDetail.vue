<!--
  views/mcp-curated/modules/McpDetail.vue

  MCP 服务器详情 (只读)。emit 'edit' 让父切到编辑态。
  configEnc 永不展示 (后端 stripConfig 保证)。
-->
<template>
  <div class="mcp-detail" v-if="entry">
    <div class="d-section">
      <h3>{{ entry.name }}</h3>
      <div class="d-tags">
        <el-tag :type="entry.enabled ? 'success' : 'info'" size="small">
          {{ entry.enabled ? '启用' : '停用' }}
        </el-tag>
        <el-tag size="small" effect="plain">{{ transportLabel(entry.transport) }}</el-tag>
        <el-tag size="small" effect="plain" :type="scopeTagType(entry.scope)">
          {{ scopeLabel(entry.scope) }}
        </el-tag>
        <el-tag v-if="entry.transport === 'stdio'" type="info" size="small">本地进程</el-tag>
        <el-tag v-else type="info" size="small">远程服务</el-tag>
      </div>
    </div>

    <el-descriptions :column="2" border size="small">
      <el-descriptions-item label="名称">{{ entry.name }}</el-descriptions-item>
      <el-descriptions-item label="传输协议">
        {{ transportLabel(entry.transport) }}
      </el-descriptions-item>
      <el-descriptions-item label="作用域">{{ scopeLabel(entry.scope) }}</el-descriptions-item>
      <el-descriptions-item label="状态">
        <el-tag :type="entry.enabled ? 'success' : 'info'" size="small">
          {{ entry.enabled ? '启用' : '停用' }}
        </el-tag>
      </el-descriptions-item>

      <!-- 传输配置: stdio→command; sse/http→endpoint -->
      <el-descriptions-item v-if="entry.transport === 'stdio'" label="启动命令" :span="2">
        <code class="mono">{{ entry.command || '—' }}</code>
      </el-descriptions-item>
      <el-descriptions-item v-else label="服务地址" :span="2">
        <code class="mono">{{ entry.endpoint || '—' }}</code>
      </el-descriptions-item>

      <!-- 作用域归属 -->
      <el-descriptions-item v-if="entry.scope === 'team'" label="团队 ID" :span="2">
        <code class="mono">{{ entry.teamId || '—' }}</code>
      </el-descriptions-item>
      <el-descriptions-item v-if="entry.scope === 'user'" label="用户 ID" :span="2">
        <code class="mono">{{ entry.userId || '—' }}</code>
      </el-descriptions-item>

      <el-descriptions-item label="凭证" :span="2">
        <el-tag size="small" type="warning">加密存储 · 不回传明文</el-tag>
        <span class="d-note">global 作用域禁止携带凭证;team/user 可选。</span>
      </el-descriptions-item>
    </el-descriptions>

    <div class="d-actions" v-if="!readonly">
      <el-button type="primary" @click="$emit('edit')">编辑</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import type { McpServer, McpTransport, McpScope } from '@/api/mcp'

  defineProps<{ entry: McpServer; readonly?: boolean }>()
  defineEmits<{ (e: 'edit'): void }>()

  function transportLabel(t: McpTransport): string {
    const map: Record<McpTransport, string> = { stdio: 'stdio', sse: 'sse', http: 'http' }
    return map[t] ?? t
  }

  function scopeLabel(s: McpScope): string {
    const map: Record<McpScope, string> = { global: '全局', team: '团队', user: '个人' }
    return map[s] ?? s
  }

  function scopeTagType(s: McpScope) {
    return s === 'global' ? 'warning' : s === 'team' ? 'primary' : 'info'
  }
</script>

<style scoped>
  .mcp-detail {
    padding: 0 20px;
  }
  .d-section {
    margin-bottom: 20px;
  }
  .d-section h3 {
    margin: 0 0 8px;
  }
  .d-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .mono {
    font-family: monospace;
    word-break: break-all;
  }
  .d-note {
    margin-left: 8px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  .d-actions {
    margin-top: 24px;
  }
</style>
