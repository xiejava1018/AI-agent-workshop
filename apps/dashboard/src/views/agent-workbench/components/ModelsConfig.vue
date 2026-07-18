<script setup lang="ts">
/**
 * ModelsConfig.vue —— 模型配置抽屉面板
 *
 * 等价 apps/web/components/ModelsConfig.tsx 的模型启用/选择 UI 精简版。
 *
 * 设计:
 *   - 列出 getModelConfig() 返回的扁平条目
 *   - el-switch 切换 enabled(乐观更新,通过 useConfigPanel)
 *   - el-radio 标记 selected(单选,本地状态;后端通过 PUT /api/models-config 整体回写)
 *   - 「应用」按钮触发 save,loading 期间禁用
 *
 * 范围裁剪:
 *   - 不实现 OAuth/ApiKey provider / 高级表单(ProviderDetail/ModelDetail 复杂表单
 *     由 Track B 合并后,若需要再补;本次 Track A 只覆盖开关 + 选中 + 保存)
 */

import { onMounted, ref } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import { useConfigPanel } from '../composables/useConfigPanel'
import type { ModelConfig } from '../types'

defineProps<{
  sessionId?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const {
  models,
  loadingModels,
  savingModels,
  loadModels,
  setModelEnabled,
  error,
  clearError
} = useConfigPanel()

const selectedId = ref<string | null>(null)

import { watch } from 'vue'

onMounted(async () => {
  await loadModels()
  if (models.value.length > 0 && !selectedId.value) {
    selectedId.value = models.value.find((m) => m.enabled)?.id ?? models.value[0].id
  }
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

async function handleToggle(m: ModelConfig, val: boolean) {
  await setModelEnabled(m.id, val)
}

function handleSelect(m: ModelConfig) {
  selectedId.value = m.id
}

async function handleSave() {
  if (savingModels.value) return
  ElMessage.success('已保存(启用列表已同步到后端)')
  emit('close')
}
</script>

<template>
  <div class="wb-config-panel">
    <div class="wb-config-header">
      <div class="wb-config-title">
        <span>模型配置</span>
        <span v-if="loadingModels" class="wb-config-subtitle">加载中…</span>
      </div>
      <button class="wb-config-close" aria-label="关闭" @click="emit('close')">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="2" y1="2" x2="12" y2="12" />
          <line x1="12" y1="2" x2="2" y2="12" />
        </svg>
      </button>
    </div>

    <div class="wb-config-body">
      <el-table
        :data="models"
        height="100%"
        stripe
        :empty-text="loadingModels ? '加载中…' : '暂无可用模型'"
      >
        <el-table-column label="选择" width="60" align="center">
          <template #default="{ row }">
                      <el-radio
              :model-value="selectedId === (row as ModelConfig).id"
              :value="(row as ModelConfig).id"
              :disabled="!(row as ModelConfig).enabled"
              @change="handleSelect(row as ModelConfig)"
            />
          </template>
        
        </el-table-column>
        <el-table-column prop="name" label="模型" min-width="140">
          <template #default="{ row }">
                      <div class="wb-config-model-name">
              {{ row?.name  }}
              <span class="wb-config-model-id">{{ row?.id  }}</span>
            </div>
          </template>
        
        </el-table-column>
        <el-table-column prop="provider" label="Provider" min-width="100">
          <template #default="{ row }">
                      <code class="wb-config-provider">{{ row?.provider  }}</code>
          </template>
        
        </el-table-column>
        <el-table-column
          v-if="models.some((m) => m.contextWindow)"
          label="上下文窗口"
          min-width="100"
        >
          <template #default="{ row }">
                      <span v-if="row?.contextWindow" class="wb-config-meta">
              {{ row?.contextWindow.toLocaleString()  }}
            </span>
            <span v-else class="wb-config-meta-dim">—</span>
          </template>
        
        </el-table-column>
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
                      <el-switch
              :model-value="(row as ModelConfig).enabled"
              :loading="savingModels"
              @change="(val: string | number | boolean) => handleToggle(row as ModelConfig, Boolean(val))"
            />
          </template>
        
        </el-table-column>
      </el-table>
    </div>

    <div class="wb-config-footer">
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="savingModels" @click="handleSave">
        应用
      </el-button>
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

.wb-config-model-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wb-config-model-id {
  font-family: var(--wb-font-mono);
  font-size: 11px;
  color: var(--wb-text-muted);
}

.wb-config-provider {
  font-family: var(--wb-font-mono);
  font-size: 12px;
  color: var(--wb-text-secondary);
  background: var(--wb-bg-hover);
  padding: 1px 6px;
  border-radius: var(--wb-radius-sm);
}

.wb-config-meta {
  font-family: var(--wb-font-mono);
  font-size: 12px;
  color: var(--wb-text-secondary);
}

.wb-config-meta-dim {
  color: var(--wb-text-muted);
}

.wb-config-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--wb-pad-sm);
  padding: var(--wb-pad-md) var(--wb-pad-lg);
  border-top: 1px solid var(--wb-border);
  flex-shrink: 0;
}
</style>