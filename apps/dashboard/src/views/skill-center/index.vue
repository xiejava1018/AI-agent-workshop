<template>
  <div class="skill-center">
    <div class="page-header">
      <h2>技能中心</h2>
      <el-input v-model="searchKeyword" placeholder="搜索技能" style="width: 240px" @keydown.enter="search">
        <template #append><el-button @click="search">搜索</el-button></template>
      </el-input>
    </div>

    <el-tabs v-model="filterScope" @tab-change="loadSkills">
      <el-tab-pane label="全部" value="all" />
      <el-tab-pane label="全局" value="global" />
      <el-tab-pane label="团队" value="team" />
      <el-tab-pane label="个人" value="user" />
    </el-tabs>

    <el-table :data="skills" v-loading="loading" class="skill-table">
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="slug" label="标识" width="160" />
      <el-table-column prop="scope" label="作用域" width="100">
        <template #default="{ row }">
          <el-tag size="small">{{ scopeLabel(row.scope) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="enabled" label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
            {{ row.enabled ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180">
        <template #default="{ row }">
          <el-button link size="small" @click="toggleSkill(row)">
            {{ row.enabled ? '停用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="market-section">
      <h3>技能市场</h3>
      <el-row :gutter="16">
        <el-col v-for="s in marketSkills" :key="s.slug" :xs="24" :sm="12" :md="8">
          <el-card shadow="hover" class="skill-card">
            <div class="skill-name">{{ s.name }}</div>
            <div class="skill-desc">{{ s.description }}</div>
            <el-button type="primary" size="small" @click="installSkill(s.slug)">安装</el-button>
          </el-card>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { listSkills, searchSkills, installSkill as apiInstall, toggleSkill as apiToggle } from '@/api/skills'

const skills = ref<any[]>([])
const marketSkills = ref<any[]>([])
const loading = ref(false)
const filterScope = ref('all')
const searchKeyword = ref('')

const scopeLabel = (scope: string) => ({ global: '全局', team: '团队', user: '个人' }[scope] || scope)

onMounted(async () => { await loadSkills() })

async function loadSkills() {
  loading.value = true
  try {
    const params: any = {}
    if (filterScope.value !== 'all') params.scope = filterScope.value
    skills.value = await listSkills(params)
  } finally { loading.value = false }
}

async function search() {
  if (!searchKeyword.value.trim()) return
  marketSkills.value = await searchSkills({ q: searchKeyword.value })
}

async function installSkill(slug: string) {
  try {
    await apiInstall({ slug, scope: 'user' })
    ElMessage.success('安装成功')
    loadSkills()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '安装失败')
  }
}

async function toggleSkill(skill: any) {
  try {
    await apiToggle(skill.id, { enabled: !skill.enabled })
    ElMessage.success(skill.enabled ? '已停用' : '已启用')
    loadSkills()
  } catch {}
}
</script>

<style scoped>
.skill-center { padding: 20px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.skill-table { margin-bottom: 32px; }
.market-section { margin-top: 32px; }
.market-section h3 { margin-bottom: 16px; }
.skill-card { margin-bottom: 16px; }
.skill-name { font-weight: 600; margin-bottom: 4px; }
.skill-desc { color: #666; font-size: 13px; margin-bottom: 8px; }
</style>
