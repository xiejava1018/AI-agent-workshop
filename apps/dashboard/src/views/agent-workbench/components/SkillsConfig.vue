<script setup lang="ts">
/**
 * SkillsConfig.vue —— 技能配置抽屉面板
 *
 * 等价 apps/web/components/SkillsConfig.tsx 的开关 / 描述显示。
 * 依赖 cwd(当前工作目录)以调用 getSkills(cwd)。
 *
 * 如果父组件不传 cwd,展示「请选择工作目录」提示。
 */

import { onMounted, ref, watch } from 'vue'
import { ElNotification } from 'element-plus'
import { useConfigPanel } from '../composables/useConfigPanel'
import type { SkillConfig } from '../types'

const props = defineProps<{
  sessionId?: string
  cwd?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const {
  skills,
  loadingSkills,
  savingSkills,
  loadSkills,
  setSkillEnabled,
  error,
  clearError
} = useConfigPanel()

const localCwd = ref(props.cwd ?? '')

watch(
  () => props.cwd,
  (v) => {
    localCwd.value = v ?? ''
    if (localCwd.value) void loadSkills(localCwd.value)
  }
)

onMounted(async () => {
  if (localCwd.value) await loadSkills(localCwd.value)
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

async function handleToggle(s: SkillConfig, val: boolean) {
  if (!s.source) return
  await setSkillEnabled(s.id, s.source, val)
}
</script>

<template>
  <div class="wb-config-panel">
    <div class="wb-config-header">
      <div class="wb-config-title">
        <span>技能配置</span>
        <span v-if="loadingSkills" class="wb-config-subtitle">加载中…</span>
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
        请先选择工作目录后查看技能列表
      </div>
      <el-table
        v-else
        :data="skills"
        height="100%"
        stripe
        :empty-text="loadingSkills ? '加载中…' : '当前目录暂无技能'"
      >
        <el-table-column prop="name" label="技能名" min-width="140">
          <template #default="{ row }">
                      <div class="wb-skill-name">
              {{ row?.name  }}
              <span v-if="row?.source" class="wb-skill-source" :title="row.source">
                {{ row?.source.split('/').slice(-2).join('/')  }}
              </span>
            </div>
          </template>
        
        </el-table-column>
        <el-table-column label="说明" min-width="160">
          <template #default="{ row }">
                      <span v-if="row?.description" class="wb-skill-desc">{{ row?.description  }}</span>
            <span v-else class="wb-skill-desc-dim">—</span>
          </template>
        
        </el-table-column>
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
                      <el-switch
              :model-value="(row as SkillConfig).enabled"
              :loading="savingSkills"
              :disabled="!(row as SkillConfig).source"
              @change="(val: string | number | boolean) => handleToggle(row as SkillConfig, Boolean(val))"
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

.wb-skill-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wb-skill-source {
  font-family: var(--wb-font-mono);
  font-size: 11px;
  color: var(--wb-text-muted);
}

.wb-skill-desc {
  font-size: 12px;
  color: var(--wb-text-secondary);
}

.wb-skill-desc-dim {
  color: var(--wb-text-muted);
}

.wb-config-footer {
  display: flex;
  justify-content: flex-end;
  padding: var(--wb-pad-md) var(--wb-pad-lg);
  border-top: 1px solid var(--wb-border);
  flex-shrink: 0;
}
</style>