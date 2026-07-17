<template>
  <div class="team-page">
    <div class="page-header">
      <h2>团队管理</h2>
      <el-button type="primary" @click="showCreateDialog = true">创建团队</el-button>
    </div>

    <el-table :data="teams" v-loading="loading">
      <el-table-column prop="name" label="团队名称" />
      <el-table-column prop="role" label="我的角色" width="100">
        <template #default="{ row }">
          <el-tag size="small">{{ roleLabel(row.myRole) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="memberCount" label="成员数" width="80" />
      <el-table-column label="配额" width="120">
        <template #default="{ row }">
          {{ row.tokenLimit === 0 ? '无限制' : `${row.tokenLimit} tokens` }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button link type="primary" @click="manageTeam(row)">管理</el-button>
          <el-button link type="primary" @click="showInvite(row)">邀请链接</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 成员管理对话框 -->
    <el-dialog v-model="showMemberDialog" title="成员管理" width="600px">
      <el-form :model="inviteForm" inline>
        <el-form-item label="邮箱">
          <el-input v-model="inviteForm.email" placeholder="成员邮箱" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="inviteForm.role" style="width: 120px">
            <el-option label="管理员" value="ADMIN" />
            <el-option label="成员" value="MEMBER" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="inviteMember">邀请</el-button>
        </el-form-item>
      </el-form>
      <el-table :data="members" size="small">
        <el-table-column prop="email" label="邮箱" />
        <el-table-column prop="role" label="角色">
          <template #default="{ row }">
            <el-select v-model="row.role" size="small" @change="updateMemberRole(row)">
              <el-option label="OWNER" value="OWNER" />
              <el-option label="ADMIN" value="ADMIN" />
              <el-option label="MEMBER" value="MEMBER" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="removeMember(row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 邀请链接对话框 -->
    <el-dialog v-model="showInviteDialog" title="邀请链接" width="400px">
      <p>邀请链接（有效期 7 天）：</p>
      <el-input :value="inviteLink" readonly />
      <template #footer>
        <el-button @click="copyInviteLink">复制链接</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  listTeams,
  createTeam,
  getMembers,
  inviteMember as apiInviteMember,
  updateMemberRole as apiUpdateRole,
  removeMember as apiRemoveMember,
  createInviteLink
} from '@/api/team'

const teams = ref<any[]>([])
const members = ref<any[]>([])
const loading = ref(false)
const showCreateDialog = ref(false)
const showMemberDialog = ref(false)
const showInviteDialog = ref(false)
const inviteLink = ref('')
const currentTeamId = ref('')
const inviteForm = reactive({ email: '', role: 'MEMBER' })

const roleLabel = (r: string) => ({ OWNER: '所有者', ADMIN: '管理员', MEMBER: '成员' }[r] || r)

onMounted(async () => { await loadTeams() })

async function loadTeams() {
  loading.value = true
  try { teams.value = await listTeams() }
  finally { loading.value = false }
}

async function manageTeam(team: any) {
  currentTeamId.value = team.id
  members.value = await getMembers(team.id)
  showMemberDialog.value = true
}

async function inviteMember() {
  try {
    await apiInviteMember(currentTeamId.value, inviteForm)
    ElMessage.success('邀请已发送')
    members.value = await getMembers(currentTeamId.value)
    inviteForm.email = ''
  } catch (err: any) { ElMessage.error(err?.response?.data?.error || '邀请失败') }
}

async function updateMemberRole(member: any) {
  await apiUpdateRole(currentTeamId.value, member.id, member.role)
}

async function removeMember(member: any) {
  await apiRemoveMember(currentTeamId.value, member.id)
  members.value = members.value.filter(m => m.id !== member.id)
}

async function showInvite(team: any) {
  currentTeamId.value = team.id
  const link = await createInviteLink(team.id)
  inviteLink.value = link
  showInviteDialog.value = true
}

function copyInviteLink() {
  navigator.clipboard.writeText(inviteLink.value)
  ElMessage.success('已复制')
}
</script>

<style scoped>
.team-page { padding: 20px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
</style>
