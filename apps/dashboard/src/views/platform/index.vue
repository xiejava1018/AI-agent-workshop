<template>
  <div class="platform-page">
    <h2>平台管理</h2>

    <el-tabs>
      <!-- 用户管理 -->
      <el-tab-pane label="用户管理">
        <el-table :data="users" v-loading="loadingUsers">
          <el-table-column prop="username" label="用户名" />
          <el-table-column prop="email" label="邮箱" />
          <el-table-column prop="role" label="角色" />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200">
            <template #default="{ row }">
              <el-button link size="small" @click="disableUser(row)">{{ row.status === 'active' ? '停用' : '启用' }}</el-button>
              <el-button link size="small" type="danger" @click="resetPassword(row)">重置密码</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 审计日志 -->
      <el-tab-pane label="审计日志">
        <el-form :inline="true" :model="auditFilter" style="margin-bottom: 12px">
          <el-form-item label="用户">
            <el-input v-model="auditFilter.userId" placeholder="用户ID" />
          </el-form-item>
          <el-form-item label="操作">
            <el-select v-model="auditFilter.action" clearable>
              <el-option label="登录" value="auth.login" />
              <el-option label="创建会话" value="session.create" />
              <el-option label="委派" value="delegation.start" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="loadAuditLogs">查询</el-button>
          </el-form-item>
        </el-form>
        <el-table :data="auditLogs" v-loading="loadingAudit" size="small">
          <el-table-column prop="createdAt" label="时间" width="180" />
          <el-table-column prop="userId" label="用户" width="120" />
          <el-table-column prop="action" label="操作" />
          <el-table-column prop="resourceType" label="资源类型" />
          <el-table-column prop="metadata" label="详情">
            <template #default="{ row }">
              <span class="metadata">{{ JSON.stringify(row.metadata || {}) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 监控大盘 -->
      <el-tab-pane label="监控大盘">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-card header="Token 使用趋势">
              <div ref="tokenChartRef" style="height: 200px" />
            </el-card>
          </el-col>
          <el-col :span="12">
            <el-card header="活跃会话">
              <div ref="sessionChartRef" style="height: 200px" />
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { listUsers, disableUser as apiDisableUser, resetUserPassword, listAuditLogs, getStats } from '@/api/admin'

const users = ref<any[]>([])
const auditLogs = ref<any[]>([])
const loadingUsers = ref(false)
const loadingAudit = ref(false)
const auditFilter = reactive({ userId: '', action: '' })
const tokenChartRef = ref<HTMLElement>()
const sessionChartRef = ref<HTMLElement>()

onMounted(async () => {
  [users.value] = await Promise.all([listUsers()])
})

async function loadAuditLogs() {
  loadingAudit.value = true
  try { auditLogs.value = await listAuditLogs(auditFilter) }
  finally { loadingAudit.value = false }
}

async function disableUser(user: any) {
  const action = user.status === 'active' ? 'disable' : 'enable'
  await apiDisableUser(user.id, action)
  user.status = user.status === 'active' ? 'disabled' : 'active'
}

async function resetPassword(user: any) {
  await resetUserPassword(user.id)
  ElMessage.success('密码已重置')
}
</script>

<style scoped>
.platform-page { padding: 20px; }
.platform-page h2 { margin-bottom: 20px; }
.metadata { font-size: 11px; color: #666; font-family: monospace; }
</style>
