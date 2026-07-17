<template>
  <div class="workspace">
    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stat-cards">
      <el-col :xs="12" :sm="6" v-for="stat in stats" :key="stat.key">
        <el-card shadow="hover">
          <div class="stat-value">{{ stat.value }}</div>
          <div class="stat-label">{{ stat.label }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 最近会话 -->
    <el-card class="recent-sessions" shadow="never">
      <template #header>
        <div class="card-header">
          <span>最近会话</span>
          <el-button link type="primary" @click="$router.push('/agents')">查看全部</el-button>
        </div>
      </template>
      <el-empty v-if="recentSessions.length === 0" description="暂无会话" />
      <el-table v-else :data="recentSessions" style="width: 100%">
        <el-table-column prop="title" label="标题" />
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="tokenUsage" label="Token" width="120" />
        <el-table-column prop="createdAt" label="创建时间" width="180" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button link type="primary" @click="openSession(row.id)">继续</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getWorkspaceStats, getRecentSessions } from '@/api/workspace'

defineOptions({ name: 'WorkspaceView' })

const router = useRouter()
const stats = ref([
  { key: 'sessions', label: '今日会话', value: 0 },
  { key: 'tokens', label: '今日Token', value: 0 },
  { key: 'agents', label: '活跃Agent', value: 0 },
  { key: 'skills', label: '已安装技能', value: 0 },
])

const recentSessions = ref<any[]>([])

onMounted(async () => {
  try {
    const [statsData, sessionsData] = await Promise.all([
      getWorkspaceStats(),
      getRecentSessions(),
    ])
    stats.value = statsData
    recentSessions.value = sessionsData
  } catch (err) {
    console.error('Failed to load workspace data', err)
  }
})

function openSession(id: string) {
  router.push(`/agents/${id}`)
}
</script>

<style scoped>
.workspace { padding: 20px; }
.stat-cards { margin-bottom: 20px; }
.stat-value { font-size: 28px; font-weight: 700; color: var(--el-color-primary); }
.stat-label { font-size: 14px; color: #666; margin-top: 4px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
</style>
