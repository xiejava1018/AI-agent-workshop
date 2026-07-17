<template>
  <div class="digital-employees">
    <div class="page-header">
      <h2>数字员工</h2>
      <el-button type="primary" @click="openCreateDialog">创建数字员工</el-button>
    </div>

    <!-- 筛选栏 -->
    <el-tabs v-model="filterScope" @tab-change="loadAgents">
      <el-tab-pane label="全部" value="all" />
      <el-tab-pane label="团队" value="team" />
      <el-tab-pane label="个人" value="personal" />
    </el-tabs>

    <!-- Agent 列表 -->
    <el-table :data="agents" v-loading="loading">
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="description" label="描述" />
      <el-table-column prop="model" label="模型" />
      <el-table-column prop="scope" label="作用域" width="100">
        <template #default="{ row }">
          <el-tag :type="row.scope === 'team' ? 'success' : 'info'" size="small">
            {{ row.scope === 'team' ? '团队' : '个人' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button link type="primary" @click="editAgent(row)">编辑</el-button>
          <el-button link type="primary" @click="cloneAgent(row)">克隆</el-button>
          <el-button link type="danger" @click="deleteAgent(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 创建/编辑对话框 -->
    <el-dialog v-model="showDialog" :title="editingId ? '编辑数字员工' : '创建数字员工'" width="600px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="如：代码审查员" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="模型">
          <el-select v-model="form.model" style="width: 100%">
            <el-option label="Claude Opus 4" value="anthropic/claude-opus-4-8" />
            <el-option label="Claude Sonnet 4" value="anthropic/claude-sonnet-4-6" />
          </el-select>
        </el-form-item>
        <el-form-item label="系统提示词">
          <el-input v-model="form.systemPrompt" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="绑定技能">
          <el-select v-model="form.skillIds" multiple style="width: 100%">
            <el-option v-for="s in availableSkills" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="绑定 MCP">
          <el-select v-model="form.mcpServerIds" multiple style="width: 100%">
            <el-option v-for="m in availableMcp" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" @click="saveAgent">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listAgents, createAgent, updateAgent, deleteAgent as removeAgent, getSkills, getMcpServers } from '@/api/digital-employees'

const agents = ref<any[]>([])
const loading = ref(false)
const filterScope = ref('all')
const showDialog = ref(false)
const editingId = ref<string | null>(null)
const form = reactive({
  name: '',
  description: '',
  model: '',
  systemPrompt: '',
  skillIds: [] as string[],
  mcpServerIds: [] as string[],
})
const availableSkills = ref<any[]>([])
const availableMcp = ref<any[]>([])

onMounted(async () => {
  await Promise.all([loadAgents(), loadOptions()])
})

async function loadAgents() {
  loading.value = true
  try {
    const params = filterScope.value !== 'all' ? { scope: filterScope.value } : {}
    agents.value = await listAgents(params)
  } finally {
    loading.value = false
  }
}

async function loadOptions() {
  const [skills, mcp] = await Promise.all([getSkills(), getMcpServers()])
  availableSkills.value = skills || []
  availableMcp.value = mcp || []
}

function openCreateDialog() {
  editingId.value = null
  Object.assign(form, {
    name: '',
    description: '',
    model: '',
    systemPrompt: '',
    skillIds: [],
    mcpServerIds: [],
  })
  showDialog.value = true
}

function editAgent(agent: any) {
  editingId.value = agent.id
  Object.assign(form, {
    name: agent.name,
    description: agent.description,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    skillIds: [],
    mcpServerIds: [],
  })
  showDialog.value = true
}

function cloneAgent(agent: any) {
  editingId.value = null
  Object.assign(form, {
    name: `${agent.name} (克隆)`,
    description: agent.description,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    skillIds: [],
    mcpServerIds: [],
  })
  showDialog.value = true
}

async function saveAgent() {
  try {
    if (editingId.value) {
      await updateAgent(editingId.value, form)
      ElMessage.success('更新成功')
    } else {
      await createAgent(form)
      ElMessage.success('创建成功')
    }
    showDialog.value = false
    loadAgents()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '操作失败')
  }
}

async function deleteAgent(agent: any) {
  try {
    await ElMessageBox.confirm(`确定删除「${agent.name}」？`, '删除确认', { type: 'warning' })
    await removeAgent(agent.id)
    ElMessage.success('删除成功')
    loadAgents()
  } catch {}
}
</script>

<style scoped>
.digital-employees {
  padding: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
</style>
