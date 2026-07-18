<script setup lang="ts">
/**
 * PluginsConfig.vue —— 插件配置抽屉面板
 *
 * 等价 apps/web/components/PluginsConfig.tsx 的启用/禁用 UI 精简版。
 *
 * 范围裁剪:
 *   - 不实现 install / remove / scope 编辑
 *   - 只暴露 switch 切换 enabled + scope / version 显示
 */

import { onMounted, ref, watch } from 'vue'
import { ElNotification } from 'element-plus'
import { useConfigPanel } from '../composables/useConfigPanel'
import type { PluginConfig } from '../types'

const props = defineProps<{
  sessionId?: string
  cwd?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const {
  plugins,
  loadingPlugins,
  savingPlugins,
  loadPlugins,
  setPluginEnabled,
  error,
  clearError
} = useConfigPanel()

const localCwd = ref(props.cwd ?? '')

watch(
  () => props.cwd,
  (v) => {
    localCwd.value = v ?? ''
    if (localCwd.value) void loadPlugins(localCwd.value)
  }
)

onMounted(async () => {
  if (localCwd.value) await loadPlugins(localCwd.value)
})

watch(error, (msg) => {
  if (!msg) return
  ElNotification({
    type: 'error',
    title: '操作失败',
    message: msg,
    duration: 4000
  })
  clearError()
})

function parseId(id: string): { scope: string; source: string } | null {
  const idx = id.indexOf('::')
  if (idx === -1) return null
  return { scope: id.slice(0, idx), source: id.slice(idx + 2) }
}

async function handleToggle(p: PluginConfig, val: boolean) {
  if (!localCwd.value) return
  const parsed = parseId(p.id)
  if (!parsed) return
  await setPluginEnabled(p.id, localCwd.value, parsed.scope, parsed.source, val)
}
</script>

<template>
  <div class="wb-config-panel">
    <div class="wb-config-header">
      <div class="wb-config-title">
        <span>插件配置</span>
        <span v-if="loadingPlugins" class="wb-config-subtitle">加载中…</span>
      </div>
      <button class="wb-config-close" aria-label="关闭" @click="emit('close')">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="2" y1="2" x2="12" y2="12" />
          <line x1="12" y1="2" x2="2" y2="12" />
        </svg>
      </button>
    </div>

    <div class="wb-config-body">
      <div v-if="!localCwd" class="wb-config-empty">
        请先选择工作目录后查看插件列表
      </div>
      <el-table
        v-else
        :data="plugins"
        height="100%"
        stripe
        :empty-text="loadingPlugins ? '加载中…' : '当前目录暂无已安装插件'"
      >
        <el-table-column prop="name" label="包名" min-width="160">
          <template #default="{ row }">
                      <div class="wb-plugin-name">
              {{ row?.name  }}
              <span v-if="row?.version" class="wb-plugin-version">v{{ row?.version  }}</span>
            </div>
          </template>
        
        </el-table-column>
        <el-table-column label="来源" min-width="180">
          <template #default="{ row }">
                      <code v-if="row?.description" class="wb-plugin-source">{{ row?.description  }}</code>
            <span v-else class="wb-plugin-source-dim">—</span>
          </template>
        
        </el-table-column>
        <el-table-column label="Scope" min-width="80">
          <template #default="{ row }">
                      <span class="wb-plugin-scope">
              {{ parseId(row.id)?.scope ?? '—' }}
            </span>
          </template>
        
        </el-table-column>
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
                      <el-switch
              :model-value="(row as PluginConfig).enabled"
              :loading="savingPlugins"
              @change="(val: string | number | boolean) => handleToggle(row as PluginConfig, Boolean(val))"
            />
          </template>
        
        </el-table-column>
      </el-table>
    </div>

    <div class="wb-config-footer">
      <el-button @click="emit('close')">关闭</el-button>
    </div>
  </div>
</template>

<style scoped>
.wb-config-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--wb-bg-elevated);
  border-left: 1px solid var(--wb-border);
  overflow: hidden;
}

.wb-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--wb-pad-md) var(--wb-pad-lg);
  border-bottom: 1px solid var(--wb-border);
  flex-shrink: 0;
}

.wb-config-title {
  display: flex;
  align-items: baseline;
  gap: var(--wb-pad-sm);
  font-size: 14px;
  font-weight: 600;
  color: var(--wb-text);
}

.wb-config-subtitle {
  font-size: 11px;
  font-weight: 400;
  color: var(--wb-text-muted);
}

.wb-config-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--wb-text-muted);
  cursor: pointer;
  border-radius: var(--wb-radius-sm);
}

.wb-config-close:hover {
  background: var(--wb-bg-hover);
  color: var(--wb-text);
}

.wb-config-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: var(--wb-pad-sm);
}

.wb-config-empty {
  padding: var(--wb-pad-xl);
  color: var(--wb-text-muted);
  font-size: 12px;
  text-align: center;
}

.wb-plugin-name {
  display: flex;
  align-items: baseline;
  gap: var(--wb-pad-xs);
}

.wb-plugin-version {
  font-family: var(--wb-font-mono);
  font-size: 11px;
  color: var(--wb-text-muted);
}

.wb-plugin-source {
  font-family: var(--wb-font-mono);
  font-size: 11px;
  color: var(--wb-text-secondary);
  background: var(--wb-bg-hover);
  padding: 1px 6px;
  border-radius: var(--wb-radius-sm);
}

.wb-plugin-source-dim {
  color: var(--wb-text-muted);
}

.wb-plugin-scope {
  font-family: var(--wb-font-mono);
  font-size: 11px;
  color: var(--wb-text-secondary);
}

.wb-config-footer {
  display: flex;
  justify-content: flex-end;
  padding: var(--wb-pad-md) var(--wb-pad-lg);
  border-top: 1px solid var(--wb-border);
  flex-shrink: 0;
}
</style>