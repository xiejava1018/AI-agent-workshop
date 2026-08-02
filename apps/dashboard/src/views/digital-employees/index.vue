<template>
  <div class="digital-employees">
    <div class="page-header">
      <div>
        <h2>数字员工</h2>
        <p>管理可复用的 AI 数字员工及其模型、技能和工具配置</p>
      </div>
      <div class="header-actions">
        <el-button :loading="loading" @click="loadAgents">刷新</el-button>
        <el-button type="primary" @click="openCreateDialog">创建数字员工</el-button>
      </div>
    </div>

    <el-card shadow="never" class="filter-card">
      <div class="filter-row">
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索名称或描述"
          class="keyword-input"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="filterScope" class="scope-select" @change="loadAgents">
          <el-option label="全部作用域" value="all" />
          <el-option label="团队" value="team" />
          <el-option label="个人" value="personal" />
        </el-select>
        <el-button @click="resetFilters">重置</el-button>
      </div>
      <div class="scope-tabs">
        <el-radio-group v-model="filterScope" @change="loadAgents">
          <el-radio-button label="all">全部 {{ agents.length }}</el-radio-button>
          <el-radio-button label="team">团队</el-radio-button>
          <el-radio-button label="personal">个人</el-radio-button>
        </el-radio-group>
      </div>
    </el-card>

    <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon closable @close="errorMessage = ''">
      <template #default><el-button link type="danger" @click="loadAgents">重试</el-button></template>
    </el-alert>

    <el-card shadow="never" class="table-card">
      <el-table :data="filteredAgents" v-loading="loading" row-key="id">
        <template #empty>
          <el-empty :description="keyword ? '没有匹配的数字员工' : '暂无数字员工'">
            <el-button v-if="!keyword" type="primary" @click="openCreateDialog">创建数字员工</el-button>
          </el-empty>
        </template>
        <el-table-column prop="name" label="名称" min-width="180">
          <template #default="{ row }">
            <el-button link type="primary" class="agent-name" @click="editAgent(row)">
              {{ row.name }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">{{ row.description || '暂无描述' }}</template>
        </el-table-column>
        <el-table-column prop="model" label="模型" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.model || '系统默认' }}</template>
        </el-table-column>
        <el-table-column label="Skill" width="80" align="center">
          <template #default="{ row }">{{ row.skillIds.length }}</template>
        </el-table-column>
        <el-table-column label="MCP" width="80" align="center">
          <template #default="{ row }">{{ row.mcpServerIds.length }}</template>
        </el-table-column>
        <el-table-column prop="scope" label="作用域" width="100">
          <template #default="{ row }">
            <el-tag :type="row.scope === 'team' ? 'success' : 'info'" size="small">
              {{ row.scope === 'team' ? '团队' : '个人' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="160">
          <template #default="{ row }">{{ formatDate(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editAgent(row)">编辑</el-button>
            <el-button link type="primary" @click="cloneAgent(row)">克隆</el-button>
            <el-button link type="danger" @click="deleteAgent(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showDialog" :title="dialogTitle" width="820px" destroy-on-close>
      <div class="editor-layout">
        <aside class="editor-nav">
          <div class="editor-nav-group">基础</div>
          <button :class="['editor-nav-item', { active: activeSection === 'basic' }]" @click="activeSection = 'basic'"><el-icon><User /></el-icon><span>基础信息</span></button>
          <div class="editor-nav-group">能力</div>
          <button :class="['editor-nav-item', { active: activeSection === 'model' }]" @click="activeSection = 'model'"><el-icon><Cpu /></el-icon><span>模型配置</span></button>
          <button :class="['editor-nav-item', { active: activeSection === 'skills' }]" @click="activeSection = 'skills'"><el-icon><MagicStick /></el-icon><span>Skill 配置</span><em v-if="form.skillIds.length">{{ form.skillIds.length }}</em></button>
          <button :class="['editor-nav-item', { active: activeSection === 'mcp' }]" @click="activeSection = 'mcp'"><el-icon><Connection /></el-icon><span>MCP 配置</span><em v-if="form.mcpServerIds.length">{{ form.mcpServerIds.length }}</em></button>
        </aside>
        <section class="editor-content">
          <el-form :model="form" label-position="top" @submit.prevent="saveAgent">
            <template v-if="activeSection === 'basic'"><div class="section-heading"><h3>基础信息</h3><p>定义数字员工的名称、职责和行为约束。</p></div><el-form-item label="名称" required><el-input v-model="form.name" maxlength="80" show-word-limit placeholder="如：代码审查员" /></el-form-item><el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="3" maxlength="240" show-word-limit placeholder="一句话说明数字员工的职责" /></el-form-item><el-form-item label="System Prompt"><el-input v-model="form.systemPrompt" type="textarea" :rows="9" placeholder="定义数字员工的行为约束和工作场景" /></el-form-item><el-form-item label="作用域"><el-radio-group v-model="form.scope"><el-radio value="personal">个人</el-radio><el-radio value="team">团队</el-radio></el-radio-group></el-form-item><el-form-item v-if="form.scope === 'team'" label="所属团队" required><el-select v-model="form.teamId" :loading="teamsLoading" :disabled="!canCreateTeamEmployee()" style="width: 100%" placeholder="选择有管理权限的团队"><el-option v-for="team in teams.filter((item) => item.role === 'OWNER' || item.role === 'ADMIN')" :key="team.id" :label="team.name" :value="team.id"><span>{{ team.name }}</span><span class="option-description">{{ team.role === 'OWNER' ? '所有者' : '管理员' }}</span></el-option></el-select><div v-if="teamsLoadError" class="field-hint">{{ teamsLoadError }}</div><div v-else-if="!canCreateTeamEmployee()" class="field-hint">当前没有可管理的团队，无法创建团队数字员工。</div></el-form-item></template>
            <template v-else-if="activeSection === 'model'"><div class="section-heading"><h3>模型配置</h3><p>留空则使用系统默认模型。</p></div><el-form-item label="模型"><el-select v-model="form.model" clearable style="width: 100%" placeholder="使用系统默认模型"><el-option v-for="model in availableModels" :key="model.value" :label="`${model.label}（${model.provider}）`" :value="model.value" /></el-select></el-form-item><el-alert v-if="modelsLoadError" :title="modelsLoadError" type="warning" :closable="false" show-icon /><el-empty v-else-if="!availableModels.length" description="暂无已配置模型，请先完成模型配置" :image-size="80" /></template>
            <template v-else-if="activeSection === 'skills'"><div class="section-heading"><h3>Skill 配置</h3><p>选择数字员工可以继承和调用的技能能力。</p></div><el-form-item label="可用 Skill"><el-select v-model="form.skillIds" multiple filterable collapse-tags collapse-tags-tooltip style="width: 100%" placeholder="搜索并选择 Skill"><el-option v-for="skill in availableSkills" :key="skill.id" :label="skill.name" :value="skill.id"><span class="skill-opt-name">{{ skill.name }}<el-tag v-if="skill.scope" size="small" :type="scopeTagType(skill.scope)" effect="plain" class="skill-opt-tag">{{ scopeLabel(skill.scope) }}</el-tag><el-tag v-if="skill.source" size="small" type="info" effect="plain" class="skill-opt-tag">{{ sourceLabel(skill.source) }}</el-tag></span><span class="option-description">{{ skill.description }}</span></el-option></el-select></el-form-item><el-empty v-if="!availableSkills.length" description="暂无可用 Skill" :image-size="80" /></template>
            <template v-else><div class="section-heading"><h3>MCP 配置</h3><p>选择数字员工可以使用的 MCP 服务。</p></div><el-form-item label="可用 MCP 服务"><el-select v-model="form.mcpServerIds" multiple filterable collapse-tags collapse-tags-tooltip style="width: 100%" placeholder="搜索并选择 MCP 服务"><el-option v-for="server in availableMcp" :key="server.id" :label="server.name" :value="server.id" /></el-select></el-form-item><el-alert v-if="mcpLoadError" title="MCP 服务暂时不可用，可能需要平台管理员权限。" type="warning" :closable="false" show-icon /><el-empty v-else-if="!availableMcp.length" description="暂无可用 MCP 服务" :image-size="80" /></template>
          </el-form>
        </section>
      </div>
      <template #footer><el-button @click="showDialog = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveAgent">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, User, Cpu, MagicStick, Connection } from '@element-plus/icons-vue'
import {
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent as removeAgent,
  getSkills,
  getMcpServers,
  type DigitalEmployee,
  type SkillPackage,
  type McpServer
} from '@/api/digital-employees'
import { listMyTeams, type TeamOption } from '@/api/team'
import { fetchModelsConfig, getAvailableModelOptions, type AvailableModelOption } from '@/api/models-config'

const agents = ref<DigitalEmployee[]>([])
const loading = ref(false)
const filterScope = ref<'all' | 'team' | 'personal'>('all')
const showDialog = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const errorMessage = ref('')
const mcpLoadError = ref(false)
const keyword = ref('')
const activeSection = ref<'basic' | 'model' | 'skills' | 'mcp'>('basic')
const form = reactive<{
  name: string
  description: string
  model: string
  systemPrompt: string
  scope: 'team' | 'personal'
  teamId: string
  skillIds: string[]
  mcpServerIds: string[]
}>({
  name: '',
  description: '',
  model: '',
  systemPrompt: '',
  scope: 'personal',
  teamId: '',
  skillIds: [],
  mcpServerIds: []
})
const availableSkills = ref<SkillPackage[]>([])
const availableMcp = ref<McpServer[]>([])
const teams = ref<TeamOption[]>([])
const teamsLoading = ref(false)
const teamsLoadError = ref('')
const availableModels = ref<AvailableModelOption[]>([])
const modelsLoading = ref(false)
const modelsLoadError = ref('')

const dialogTitle = computed(() => (editingId.value ? '编辑数字员工' : '创建数字员工'))
const filteredAgents = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return agents.value
  return agents.value.filter((agent) =>
    [agent.name, agent.description].some((value) => value?.toLowerCase().includes(query))
  )
})

onMounted(async () => {
  await Promise.all([loadAgents(), loadOptions(), loadTeams(), loadModels()])
})

async function loadAgents() {
  loading.value = true
  errorMessage.value = ''
  try {
    const params = filterScope.value !== 'all' ? { scope: filterScope.value as 'team' | 'personal' } : undefined
    agents.value = await listAgents(params)
  } catch (error: any) {
    errorMessage.value = error?.message || '数字员工列表加载失败'
  } finally {
    loading.value = false
  }
}

async function loadOptions() {
  try {
    availableSkills.value = await getSkills()
  } catch {
    availableSkills.value = []
  }
  try {
    availableMcp.value = await getMcpServers()
    mcpLoadError.value = false
  } catch {
    availableMcp.value = []
    mcpLoadError.value = true
  }
}

async function loadModels() {
  modelsLoading.value = true
  modelsLoadError.value = ''
  try {
    availableModels.value = getAvailableModelOptions(await fetchModelsConfig())
  } catch (error: any) {
    availableModels.value = []
    modelsLoadError.value = error?.message || '模型列表加载失败'
  } finally {
    modelsLoading.value = false
  }
}

async function loadTeams() {
  teamsLoading.value = true
  teamsLoadError.value = ''
  try {
    teams.value = await listMyTeams()
  } catch (error: any) {
    teams.value = []
    teamsLoadError.value = error?.message || '团队列表加载失败'
  } finally {
    teamsLoading.value = false
  }
}

function canCreateTeamEmployee() {
  return teams.value.some((team) => team.role === 'OWNER' || team.role === 'ADMIN')
}
function resetFilters() {
  keyword.value = ''
  filterScope.value = 'all'
  loadAgents()
}

function formatDate(value?: string | number) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// P2.3: skill 来源徽标辅助
function scopeLabel(scope?: string): string {
  if (scope === 'global') return '全局'
  if (scope === 'team') return '团队'
  if (scope === 'user') return '个人'
  return scope ?? ''
}
function sourceLabel(source?: string): string {
  if (source === 'builtin') return '内置'
  if (source === 'uploaded') return '上传'
  if (source === 'git') return 'Git'
  if (source === 'npm') return 'NPM'
  return source ?? ''
}
function scopeTagType(scope?: string): 'success' | 'warning' | 'info' {
  if (scope === 'global') return 'warning'
  if (scope === 'team') return 'success'
  return 'info'
}

function openCreateDialog() {
  editingId.value = null
  activeSection.value = 'basic'
  Object.assign(form, {
    name: '',
    description: '',
    model: '',
    systemPrompt: '',
    skillIds: [],
    mcpServerIds: [],
    scope: 'personal',
    teamId: ''
  })
  showDialog.value = true
}

function editAgent(agent: DigitalEmployee | Record<string, any>) {
  editingId.value = agent.id
  activeSection.value = 'basic'
  Object.assign(form, {
    name: agent.name,
    description: agent.description,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    skillIds: agent.skillIds ?? [],
    mcpServerIds: agent.mcpServerIds ?? [],
    scope: agent.scope ?? 'personal',
    teamId: agent.teamId ?? ''
  })
  showDialog.value = true
}

function cloneAgent(agent: DigitalEmployee | Record<string, any>) {
  editingId.value = null
  activeSection.value = 'basic'
  Object.assign(form, {
    name: `${agent.name}（副本）`,
    description: agent.description,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    skillIds: agent.skillIds ?? [],
    mcpServerIds: agent.mcpServerIds ?? [],
    scope: agent.scope ?? 'personal',
    teamId: agent.teamId ?? ''
  })
  showDialog.value = true
}

async function saveAgent() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入数字员工名称')
    return
  }
  if (form.scope === 'team' && (!form.teamId.trim() || !canCreateTeamEmployee())) {
    ElMessage.warning('请选择当前有管理权限的团队')
    return
  }

  saving.value = true
  try {
    const payload = {
      ...form,
      name: form.name.trim(),
      teamId: form.scope === 'team' ? form.teamId.trim() : undefined,
      skillIds: [...form.skillIds],
      mcpServerIds: [...form.mcpServerIds]
    }
    if (editingId.value) {
      await updateAgent(editingId.value, payload)
      ElMessage.success('更新成功')
    } else {
      await createAgent(payload)
      ElMessage.success('创建成功')
    }
    showDialog.value = false
    await loadAgents()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || err?.message || '操作失败')
  } finally {
    saving.value = false
  }
}

async function deleteAgent(agent: DigitalEmployee | Record<string, any>) {
  try {
    await ElMessageBox.confirm(`确定删除「${agent.name}」？`, '删除确认', { type: 'warning' })
    await removeAgent(agent.id)
    ElMessage.success('删除成功')
    await loadAgents()
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
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  font-size: 22px;
}

.page-header p {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.header-actions,
.filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.filter-card,
.table-card {
  margin-bottom: 16px;
}

.filter-card :deep(.el-card__body) {
  padding-bottom: 12px;
}

.keyword-input {
  width: 320px;
}

.scope-select {
  width: 160px;
}

.scope-tabs {
  margin-top: 16px;
}

.agent-name {
  padding: 0;
  font-weight: 600;
}

.option-description {
  float: right;
  max-width: 260px;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-opt-name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.skill-opt-tag {
  transform: scale(0.85);
}

.field-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 20px;
}

.editor-layout {
  display: flex;
  min-height: 430px;
  margin: -4px -4px 0;
}

.editor-nav {
  width: 170px;
  flex: 0 0 170px;
  padding: 8px;
  border-right: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}

.editor-nav-group {
  padding: 10px 12px 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 600;
}

.editor-nav-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}

.editor-nav-item:hover,
.editor-nav-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.editor-nav-item span {
  flex: 1;
}

.editor-nav-item em {
  min-width: 18px;
  border-radius: 9px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 11px;
  font-style: normal;
  line-height: 18px;
  text-align: center;
}

.editor-content {
  flex: 1;
  min-width: 0;
  padding: 8px 20px;
  overflow-y: auto;
}

.section-heading {
  margin-bottom: 22px;
}

.section-heading h3 {
  margin: 0 0 6px;
  color: var(--el-text-color-primary);
  font-size: 16px;
}

.section-heading p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

@media (max-width: 768px) {
  .digital-employees {
    padding: 12px;
  }

  .page-header,
  .filter-row {
    align-items: stretch;
    flex-direction: column;
  }

  .header-actions {
    justify-content: flex-end;
  }

  .keyword-input,
  .scope-select {
    width: 100%;
  }
}
</style>
