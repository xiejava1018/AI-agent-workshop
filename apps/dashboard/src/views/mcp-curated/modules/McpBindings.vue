<!--
  views/mcp-curated/modules/McpBindings.vue

  MCP 服务器的 Agent 绑定管理。
  - 加载全部 Agent + 当前 MCP 的绑定列表
  - 每个 Agent 选择绑定模式: inherit(继承作用域默认) | include(强制加入) | exclude(强制排除)
  - 保存为"替换式" (PATCH 整体替换该 MCP 的全部绑定)

  四层收敛说明 (global→team→user→agent):
    作用域层已使相关 Agent 默认 inherit;Agent 层的 include/exclude 用于精确覆盖。
-->
<template>
  <div class="mcp-bindings" v-loading="loading">
    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
      绑定模式用于在 Agent 层精确覆盖作用域默认:
      <strong>继承</strong>(inherit,跟随作用域层)、
      <strong>加入</strong>(include,强制启用)、
      <strong>排除</strong>(exclude,强制禁用)。
    </el-alert>

    <div class="toolbar">
      <el-input
        v-model="keyword"
        placeholder="筛选 Agent 名称"
        style="width: 220px"
        clearable
        :prefix-icon="Search"
      />
      <span class="toolbar-stat">共 {{ filteredAgents.length }} 个 Agent</span>
    </div>

    <el-table :data="filteredAgents" size="small" max-height="480">
      <el-table-column prop="name" label="数字员工" min-width="180">
        <template #default="{ row }">
          <span>{{ row.name }}</span>
          <el-tag size="small" effect="plain" style="margin-left: 6px">{{ row.model || '—' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="id" label="ID" width="180">
        <template #default="{ row }">
          <code class="mono">{{ row.id }}</code>
        </template>
      </el-table-column>
      <el-table-column label="绑定模式" width="280">
        <template #default="{ row }">
          <el-radio-group v-model="modeMap[row.id]" size="small">
            <el-radio-button value="inherit">继承</el-radio-button>
            <el-radio-button value="include">加入</el-radio-button>
            <el-radio-button value="exclude">排除</el-radio-button>
          </el-radio-group>
        </template>
      </el-table-column>
    </el-table>

    <div class="binding-actions">
      <el-button @click="$emit('cancel')">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canEdit" @click="onSave">
        保存绑定
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, computed, onMounted } from 'vue'
  import { Search } from '@element-plus/icons-vue'
  import { ElMessage } from 'element-plus'
  import { getMcpBindings, setMcpBindings, type McpServer, type BindingMode } from '@/api/mcp'
  import { listAgents, type DigitalEmployee } from '@/api/digital-employees'

  const props = defineProps<{ server: McpServer; canEdit?: boolean }>()
  const emit = defineEmits<{
    (e: 'saved'): void
    (e: 'cancel'): void
  }>()

  const agents = ref<DigitalEmployee[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const keyword = ref('')
  // agentId → mode, 默认 inherit
  const modeMap = reactive<Record<string, BindingMode>>({})

  const filteredAgents = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    if (!kw) return agents.value
    return agents.value.filter((a) => a.name?.toLowerCase().includes(kw))
  })

  async function load() {
    loading.value = true
    try {
      const [allAgents, bindings] = await Promise.all([
        listAgents(),
        getMcpBindings(props.server.id)
      ])
      agents.value = allAgents
      // 重置: 全部默认 inherit, 再用现有绑定覆盖
      for (const a of allAgents) {
        modeMap[a.id] = 'inherit'
      }
      for (const b of bindings) {
        if (b.agentId && b.mode) modeMap[b.agentId] = b.mode
      }
    } catch (e) {
      ElMessage.error('加载绑定失败: ' + (e as Error).message)
    } finally {
      loading.value = false
    }
  }

  async function onSave() {
    saving.value = true
    try {
      // 替换式: 提交全部 agent 的 mode
      const payload = agents.value.map((a) => ({
        agentId: a.id,
        mode: modeMap[a.id] ?? 'inherit'
      }))
      await setMcpBindings(props.server.id, payload)
      ElMessage.success('绑定已保存')
      emit('saved')
    } catch (e) {
      ElMessage.error('保存失败: ' + (e as Error).message)
    } finally {
      saving.value = false
    }
  }

  onMounted(load)
</script>

<style scoped>
  .mcp-bindings {
    padding: 0 20px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .toolbar-stat {
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }
  .mono {
    font-family: monospace;
    font-size: 12px;
  }
  .binding-actions {
    margin-top: 24px;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }
</style>
