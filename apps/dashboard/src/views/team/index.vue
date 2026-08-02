<!--
  团队管理(team_owner / admin / member 视角)

  与 /views/system/team/index.vue(platform_admin 视角,管所有团队)区别:
    - 这里只看「我加入的团队」(GET /api/teams/my)
    - 点团队进详情:看成员 + 项目(任意成员可读)
    - OWNER/ADMIN 才能改成员/创项目(写操作走 /api/admin/teams/...)

  页面布局: 左侧团队列表,右侧选中团队详情(成员表 + 项目表 + 操作)。
-->
<template>
  <div class="team-page art-full-height">
    <div class="team-layout">
      <!-- 左:团队列表 -->
      <aside class="team-list-pane">
        <div class="pane-header">
          <span>我的团队</span>
          <el-button text size="small" @click="loadTeams" :loading="loadingTeams">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </div>
        <div v-loading="loadingTeams" class="pane-body">
          <div
            v-for="t in teams"
            :key="t.id"
            class="team-item"
            :class="{ active: t.id === selectedTeamId }"
            @click="selectTeam(t.id)"
          >
            <div class="team-item-name">{{ t.name }}</div>
            <div class="team-item-role">
              <el-tag size="small" :type="roleTagType(t.role)">{{ roleLabel(t.role) }}</el-tag>
            </div>
          </div>
          <el-empty v-if="!loadingTeams && teams.length === 0" description="你还没加入任何团队" />
        </div>
      </aside>

      <!-- 右:团队详情 -->
      <section class="team-detail-pane" v-loading="loadingDetail">
        <template v-if="selectedTeam">
          <div class="detail-header">
            <div>
              <h2 class="detail-title">{{ selectedTeam.name }}</h2>
              <div class="detail-meta">
                <span>成员 {{ selectedTeam.members.length }} 人</span>
                <span>·</span>
                <span>配额 {{ selectedTeam.tokenDailyLimit === 0 ? '不限' : selectedTeam.tokenDailyLimit }} tokens/日</span>
              </div>
            </div>
            <el-button
              v-if="canAdminister"
              type="primary"
              size="small"
              @click="showInviteDialog = true"
            >
              <el-icon><Link /></el-icon>&nbsp;邀请链接
            </el-button>
          </div>

          <el-tabs v-model="activeTab">
            <!-- 成员 -->
            <el-tab-pane label="成员" name="members">
              <div class="tab-toolbar" v-if="canAdminister">
                <el-input
                  v-model="addMemberUsername"
                  placeholder="输入用户登录账号(username)"
                  style="width: 240px;"
                  clearable
                />
                <el-select v-model="addMemberRole" style="width: 130px;">
                  <el-option label="成员" value="MEMBER" />
                  <el-option label="管理员" value="ADMIN" />
                </el-select>
                <el-button type="primary" @click="handleAddMember" :loading="addingMember">
                  添加成员
                </el-button>
              </div>
              <el-alert
                v-if="!canAdminister"
                type="info"
                :closable="false"
                title="仅团队 OWNER / ADMIN 可管理成员与项目"
                style="margin-bottom: 12px;"
              />
              <el-table :data="selectedTeam.members" stripe>
                <el-table-column prop="username" label="登录账号" min-width="140" />
                <el-table-column label="角色" width="160">
                  <template #default="{ row }">
                    <el-tag size="small" :type="roleTagType(row.role)">
                      {{ roleLabel(row.role) }}
                    </el-tag>
                    <span v-if="row.isOwner" class="owner-badge">团队所有者</span>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.disabled ? 'danger' : 'success'">
                      {{ row.disabled ? '已禁用' : '正常' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="加入时间" width="180">
                  <template #default="{ row }">{{ formatDate(row.joinedAt) }}</template>
                </el-table-column>
                <el-table-column label="操作" width="200" v-if="canAdminister">
                  <template #default="{ row }">
                    <el-select
                      v-if="!row.isOwner"
                      :model-value="row.role"
                      size="small"
                      style="width: 100px;"
                      @change="(v) => handleChangeRole(row, v)"
                    >
                      <el-option label="管理员" value="ADMIN" />
                      <el-option label="成员" value="MEMBER" />
                    </el-select>
                    <el-button
                      v-if="!row.isOwner"
                      link
                      type="danger"
                      size="small"
                      @click="handleRemoveMember(row)"
                    >
                      移除
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <!-- 项目 -->
            <el-tab-pane label="项目" name="projects">
              <div class="tab-toolbar" v-if="canAdminister">
                <el-button type="primary" size="small" @click="showProjectDialog = true">
                  <el-icon><Plus /></el-icon>&nbsp;创建项目
                </el-button>
              </div>
              <el-table :data="projects" stripe v-loading="loadingProjects">
                <el-table-column prop="name" label="项目名称" min-width="180" />
                <el-table-column prop="rootPath" label="根目录" min-width="280" show-overflow-tooltip />
                <el-table-column label="创建时间" width="180">
                  <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
                </el-table-column>
              </el-table>
              <el-empty v-if="!loadingProjects && projects.length === 0" description="该团队暂无项目" />
            </el-tab-pane>
          </el-tabs>
        </template>

        <el-empty v-else-if="!loadingDetail" description="请从左侧选择一个团队" />
      </section>
    </div>

    <!-- 邀请链接对话框 -->
    <el-dialog v-model="showInviteDialog" title="邀请链接" width="500px">
      <p class="invite-hint">有效期 7 天。新用户通过此链接注册后将自动加入本团队。</p>
      <el-input v-if="inviteLink" :model-value="inviteLink" readonly>
        <template #append>
          <el-button @click="copyInviteLink">复制</el-button>
        </template>
      </el-input>
      <el-button v-else type="primary" @click="generateInvite" :loading="generatingInvite">
        生成邀请链接
      </el-button>
    </el-dialog>

    <!-- 创建项目对话框 -->
    <el-dialog v-model="showProjectDialog" title="创建项目" width="500px">
      <el-form :model="projectForm" label-width="90px">
        <el-form-item label="项目名称" required>
          <el-input v-model="projectForm.name" placeholder="如:电商网站" />
        </el-form-item>
        <el-form-item label="根目录" required>
          <el-input v-model="projectForm.rootPath" placeholder="绝对路径,必须已存在" />
          <div class="form-tip">会话的 cwd 将是这个目录,Agent 只能在此目录内读写文件。</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showProjectDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreateProject" :loading="creatingProject">
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import { Refresh, Link, Plus } from '@element-plus/icons-vue'
  import {
    listMyTeams,
    getTeam,
    listTeamProjects,
    createTeamProject,
    addTeamMember,
    updateMemberRole,
    removeTeamMember,
    createInviteLink,
    roleLabel,
    type MyTeamItem,
    type TeamDetail,
    type TeamProjectItem
  } from '@/api/team'

  defineOptions({ name: 'TeamManagement' })

  // ====== 团队列表 ======
  const teams = ref<MyTeamItem[]>([])
  const loadingTeams = ref(false)
  const selectedTeamId = ref<string | null>(null)
  const selectedTeam = ref<TeamDetail | null>(null)
  const loadingDetail = ref(false)

  // 当前用户在选中团队的角色 => 是否可管理(OWNER/ADMIN)
  const canAdminister = computed<boolean>(() => {
    if (!selectedTeam.value) return false
    const me = selectedTeam.value.members.find((m) => m.userId === currentUserId.value)
    return me?.role === 'OWNER' || me?.role === 'ADMIN'
  })

  // 当前用户 id(从 userStore 拿,用于在成员表里识别"我")
  // 不能直接 import useUserStore 形成循环依赖? 试一下,应该没问题。
  const currentUserId = computed<string>(() => {
    // 用 dynamic import 避免初始化顺序问题
    return String((userStore?.info ?? {}).id ?? '')
  })

  // ====== Tab ======
  const activeTab = ref<'members' | 'projects'>('members')

  // ====== 项目 ======
  const projects = ref<TeamProjectItem[]>([])
  const loadingProjects = ref(false)

  // ====== 添加成员 ======
  const addMemberUsername = ref('')
  const addMemberRole = ref<'ADMIN' | 'MEMBER'>('MEMBER')
  const addingMember = ref(false)

  // ====== 邀请链接 ======
  const showInviteDialog = ref(false)
  const inviteLink = ref('')
  const generatingInvite = ref(false)

  // ====== 创建项目 ======
  const showProjectDialog = ref(false)
  const projectForm = ref({ name: '', rootPath: '' })
  const creatingProject = ref(false)

  // 懒加载 userStore 避免循环
  let userStore: any = null
  async function ensureUserStore() {
    if (!userStore) {
      const mod = await import('@/store/modules/user')
      userStore = mod.useUserStore()
    }
    return userStore
  }

  onMounted(async () => {
    await ensureUserStore()
    await loadTeams()
  })

  async function loadTeams() {
    loadingTeams.value = true
    try {
      teams.value = await listMyTeams()
      if (teams.value.length > 0 && !selectedTeamId.value) {
        await selectTeam(teams.value[0].id)
      }
    } catch (e: any) {
      ElMessage.error(e?.message || '加载团队失败')
    } finally {
      loadingTeams.value = false
    }
  }

  async function selectTeam(teamId: string) {
    selectedTeamId.value = teamId
    selectedTeam.value = null
    loadingDetail.value = true
    try {
      selectedTeam.value = await getTeam(teamId)
      // 同时加载项目
      await loadProjects(teamId)
    } catch (e: any) {
      ElMessage.error(e?.message || '加载团队详情失败')
    } finally {
      loadingDetail.value = false
    }
  }

  async function loadProjects(teamId: string) {
    loadingProjects.value = true
    try {
      projects.value = await listTeamProjects(teamId)
    } catch {
      projects.value = []
    } finally {
      loadingProjects.value = false
    }
  }

  function roleTagType(role: string) {
    if (role === 'OWNER') return 'danger' as const
    if (role === 'ADMIN') return 'warning' as const
    return 'info' as const
  }

  function formatDate(s: string): string {
    try {
      return new Date(s).toLocaleString('zh-CN', { hour12: false })
    } catch {
      return s
    }
  }

  // ====== 添加成员 ======
  // 注意:后端 POST /api/admin/teams/[id]/members 接收的是 userId(cuid),
  // 前端只让管理员输入 username,这里需要先把 username 解析成 userId。
  // 临时方案:用一个简单的查找接口。后端没有 username→id 的直接接口,
  // 用 GET /api/v1/users?username=xxx 拿到列表取第一个(模糊匹配)。
  async function resolveUserIdByUsername(username: string): Promise<string | null> {
    if (!username.trim()) return null
    try {
      const httpClient = (await import('@/utils/http')).default as any
      const res = await httpClient.get({
        url: '/api/v1/users',
        params: { username: username.trim(), page: 1, pageSize: 5 },
        keepFullResponse: true,
        showErrorMessage: false
      })
      const records = res?.data?.records ?? []
      // 精确匹配优先
      const exact = records.find((u: any) => u.username === username.trim())
      return exact?.id ?? records[0]?.id ?? null
    } catch {
      return null
    }
  }

  async function handleAddMember() {
    if (!selectedTeamId.value) return
    const username = addMemberUsername.value.trim()
    if (!username) {
      ElMessage.warning('请输入用户登录账号')
      return
    }
    addingMember.value = true
    try {
      const userId = await resolveUserIdByUsername(username)
      if (!userId) {
        ElMessage.error(`找不到用户「${username}」`)
        return
      }
      await addTeamMember(selectedTeamId.value, userId, addMemberRole.value)
      ElMessage.success('已添加成员')
      addMemberUsername.value = ''
      // 刷新成员列表
      await selectTeam(selectedTeamId.value)
    } catch (e: any) {
      const msg = e?.message || e?.response?.data?.error || '添加失败'
      ElMessage.error(msg)
    } finally {
      addingMember.value = false
    }
  }

  async function handleChangeRole(member: any, newRole: 'ADMIN' | 'MEMBER') {
    if (!selectedTeamId.value) return
    try {
      await updateMemberRole(selectedTeamId.value, member.userId, newRole)
      ElMessage.success('已更新角色')
      await selectTeam(selectedTeamId.value)
    } catch (e: any) {
      ElMessage.error(e?.message || '更新失败')
    }
  }

  async function handleRemoveMember(member: any) {
    if (!selectedTeamId.value) return
    try {
      await ElMessageBox.confirm(
        `确定从团队移除「${member.username}」吗?`,
        '移除成员',
        { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
    try {
      await removeTeamMember(selectedTeamId.value, member.userId)
      ElMessage.success('已移除')
      await selectTeam(selectedTeamId.value)
    } catch (e: any) {
      ElMessage.error(e?.message || '移除失败')
    }
  }

  // ====== 邀请链接 ======
  async function generateInvite() {
    if (!selectedTeamId.value) return
    generatingInvite.value = true
    try {
      inviteLink.value = await createInviteLink(selectedTeamId.value)
    } catch (e: any) {
      ElMessage.error(e?.message || '生成失败')
    } finally {
      generatingInvite.value = false
    }
  }

  function copyInviteLink() {
    if (!inviteLink.value) return
    navigator.clipboard.writeText(inviteLink.value)
      .then(() => ElMessage.success('已复制'))
      .catch(() => ElMessage.warning('复制失败,请手动复制'))
  }

  // ====== 创建项目 ======
  async function handleCreateProject() {
    if (!selectedTeamId.value) return
    const name = projectForm.value.name.trim()
    const rootPath = projectForm.value.rootPath.trim()
    if (!name) {
      ElMessage.warning('请输入项目名称')
      return
    }
    if (!rootPath) {
      ElMessage.warning('请输入根目录')
      return
    }
    creatingProject.value = true
    try {
      await createTeamProject(selectedTeamId.value, name, rootPath)
      ElMessage.success('项目已创建')
      showProjectDialog.value = false
      projectForm.value = { name: '', rootPath: '' }
      await loadProjects(selectedTeamId.value)
    } catch (e: any) {
      const msg = e?.message || e?.response?.data?.error || '创建失败'
      ElMessage.error(msg)
    } finally {
      creatingProject.value = false
    }
  }
</script>

<style scoped>
  .team-page {
    padding: 0;
  }
  .team-layout {
    display: flex;
    width: 100%;
    height: 100%;
    background: var(--art-main-bg-color, #fff);
  }
  .team-list-pane {
    flex: 0 0 260px;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--el-border-color-lighter);
    background: var(--art-bg-color, #fafafa);
  }
  .pane-header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    font-weight: 600;
  }
  .pane-body {
    flex: 1 1 auto;
    overflow: auto;
  }
  .team-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    cursor: pointer;
    border-bottom: 1px solid var(--el-border-color-extra-light);
    transition: background 0.15s ease;
  }
  .team-item:hover {
    background: var(--el-fill-color-light);
  }
  .team-item.active {
    background: var(--el-color-primary-light-9);
    border-left: 3px solid var(--el-color-primary);
    padding-left: 13px;
  }
  .team-item-name {
    font-size: 14px;
    font-weight: 500;
  }
  .team-item-role {
    flex: 0 0 auto;
  }

  .team-detail-pane {
    flex: 1 1 auto;
    overflow: auto;
    padding: 20px 24px;
  }
  .detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .detail-title {
    margin: 0 0 4px;
    font-size: 20px;
  }
  .detail-meta {
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }
  .detail-meta span {
    margin-right: 6px;
  }

  .tab-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .owner-badge {
    margin-left: 6px;
    color: var(--el-color-danger);
    font-size: 12px;
  }
  .invite-hint {
    color: var(--el-text-color-secondary);
    margin: 0 0 12px;
    font-size: 13px;
  }
  .form-tip {
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.5;
    margin-top: 4px;
  }
</style>
