<!--
  平台管理 → 团队管理(platform_admin 视角)

  与 /views/team/index.vue(team_owner 视角)区别:
    - 这里管所有团队(GET /api/admin/teams,platform_admin only)
    - 可以创建团队(POST /api/admin/teams)
    - 可以删除团队
    - 可以修改配额
    - 成员/项目管理走同一套 API

  页面: 一个团队列表表格 + 选中团队的详情抽屉(成员 + 项目)。
-->
<template>
  <div class="admin-team-page art-full-height" id="table-full-screen">
    <ArtSearchBar
      v-model="searchParams"
      :items="searchItems"
      @reset="resetSearchParams"
      @search="getDataByPage"
    />

    <ElCard shadow="never" class="art-table-card">
      <ArtTableHeader v-model:columns="columnChecks" @refresh="refresh">
        <template #left>
          <ElButton @click="showCreateDialog" v-if="canCreate">创建团队</ElButton>
        </template>
      </ArtTableHeader>

      <ArtTable
        :loading="loading"
        :data="data"
        :columns="columns"
        :pagination="pagination"
        table-layout="fixed"
        :table-config="{ rowKey: 'id' }"
        :layout="{ marginTop: 10 }"
        @pagination:size-change="handleSizeChange"
        @pagination:current-change="handleCurrentChange"
      />
    </ElCard>

    <!-- 团队详情抽屉 -->
    <ElDrawer
      v-model="detailDrawer"
      :title="detailTeam?.name ? `团队详情：${detailTeam.name}` : '团队详情'"
      size="70%"
      :destroy-on-close="true"
    >
      <div v-loading="loadingDetail">
        <template v-if="detailTeam">
          <ElDescriptions :column="3" border size="small" class="detail-desc">
            <ElDescriptionsItem label="团队名">{{ detailTeam.name }}</ElDescriptionsItem>
            <ElDescriptionsItem label="所有者">{{ ownerUsername }}</ElDescriptionsItem>
            <ElDescriptionsItem label="成员数">{{ detailTeam.members.length }}</ElDescriptionsItem>
            <ElDescriptionsItem label="Token 配额">
              {{ detailTeam.tokenDailyLimit === 0 ? '不限' : `${detailTeam.tokenDailyLimit}/日` }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="并发会话上限">
              {{ detailTeam.maxConcurrentSessions === 0 ? '用全局默认' : detailTeam.maxConcurrentSessions }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="创建时间">{{ formatDate(detailTeam.createdAt) }}</ElDescriptionsItem>
          </ElDescriptions>

          <ElTabs v-model="detailTab" class="detail-tabs">
            <ElTabPane label="成员" name="members">
              <div class="tab-toolbar">
                <ElInput
                  v-model="addMemberUsername"
                  placeholder="输入登录账号"
                  style="width: 220px;"
                  clearable
                />
                <ElSelect v-model="addMemberRole" style="width: 120px;">
                  <ElOption label="成员" value="MEMBER" />
                  <ElOption label="管理员" value="ADMIN" />
                </ElSelect>
                <ElButton type="primary" size="small" @click="handleAddMember" :loading="addingMember">
                  添加
                </ElButton>
              </div>
              <ElTable :data="detailTeam.members" stripe size="small">
                <ElTableColumn prop="username" label="登录账号" min-width="140" />
                <ElTableColumn label="角色" width="160">
                  <template #default="{ row }">
                    <ElTag size="small" :type="roleTagType(row.role)">
                      {{ roleLabel(row.role) }}
                    </ElTag>
                    <span v-if="row.isOwner" class="owner-badge">所有者</span>
                  </template>
                </ElTableColumn>
                <ElTableColumn label="状态" width="100">
                  <template #default="{ row }">
                    <ElTag size="small" :type="row.disabled ? 'danger' : 'success'">
                      {{ row.disabled ? '禁用' : '正常' }}
                    </ElTag>
                  </template>
                </ElTableColumn>
                <ElTableColumn label="操作" width="200">
                  <template #default="{ row }">
                    <ElSelect
                      v-if="!row.isOwner"
                      :model-value="row.role"
                      size="small"
                      style="width: 100px;"
                      @change="(v) => handleChangeRole(row, v)"
                    >
                      <ElOption label="管理员" value="ADMIN" />
                      <ElOption label="成员" value="MEMBER" />
                    </ElSelect>
                    <ElButton
                      v-if="!row.isOwner"
                      link
                      type="danger"
                      size="small"
                      @click="handleRemoveMember(row)"
                    >
                      移除
                    </ElButton>
                  </template>
                </ElTableColumn>
              </ElTable>
            </ElTabPane>

            <ElTabPane label="项目" name="projects">
              <div class="tab-toolbar">
                <ElButton type="primary" size="small" @click="showProjectDialog = true">
                  创建项目
                </ElButton>
              </div>
              <ElTable :data="detailProjects" stripe size="small" v-loading="loadingProjects">
                <ElTableColumn prop="name" label="项目名" min-width="160" />
                <ElTableColumn prop="rootPath" label="根目录" min-width="280" show-overflow-tooltip />
                <ElTableColumn label="创建时间" width="180">
                  <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
                </ElTableColumn>
              </ElTable>
            </ElTabPane>
          </ElTabs>
        </template>
      </div>
    </ElDrawer>

    <!-- 创建团队对话框 -->
    <ElDialog v-model="createDialog" title="创建团队" width="500px">
      <ElForm :model="createForm" label-width="100px">
        <ElFormItem label="团队名称" required>
          <ElInput v-model="createForm.name" placeholder="如:研发一组" />
        </ElFormItem>
        <ElFormItem label="所有者" required>
          <ElInput
            v-model="createForm.ownerUsername"
            placeholder="输入已存在用户的登录账号"
          />
          <div class="form-tip">该用户会成为团队的 OWNER,需已存在。</div>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="createDialog = false">取消</ElButton>
        <ElButton type="primary" @click="handleCreateTeam" :loading="creating">创建</ElButton>
      </template>
    </ElDialog>

    <!-- 创建项目对话框 -->
    <ElDialog v-model="showProjectDialog" title="创建项目" width="500px">
      <ElForm :model="projectForm" label-width="90px">
        <ElFormItem label="项目名称" required>
          <ElInput v-model="projectForm.name" placeholder="如:电商网站" />
        </ElFormItem>
        <ElFormItem label="根目录" required>
          <ElInput v-model="projectForm.rootPath" placeholder="绝对路径,必须已存在" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="showProjectDialog = false">取消</ElButton>
        <ElButton type="primary" @click="handleCreateProject" :loading="creatingProject">
          创建
        </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, h, computed, nextTick } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import { useTable } from '@/composables/useTable'
  import type { SearchFormItem } from '@/types'
  import { useUserStore } from '@/store/modules/user'
  import {
    adminListTeams,
    adminGetTeam,
    adminCreateTeam,
    adminDeleteTeam,
    addTeamMember,
    updateMemberRole,
    removeTeamMember,
    listTeamProjects,
    createTeamProject,
    roleLabel,
    type TeamDetail,
    type TeamProjectItem
  } from '@/api/team'

  defineOptions({ name: 'AdminTeamManagement' })

  const userStore = useUserStore()
  const canCreate = computed(() => userStore.hasPermission('platform:access'))

  const searchItems: SearchFormItem[] = [
    {
      label: '团队名',
      key: 'name',
      type: 'input',
      clearable: true,
      placeholder: '按名称筛选(前端过滤)'
    }
  ]

  const allTeams = ref<any[]>([])

  const {
    columns,
    columnChecks,
    data,
    loading,
    pagination,
    searchParams,
    getData: getDataByPage,
    resetSearchParams,
    handleSizeChange,
    handleCurrentChange,
    refreshAll: refresh
  } = useTable({
    core: {
      apiFn: async (_params?: { name?: string }) => {
        const teams = await adminListTeams()
        allTeams.value = teams
        return { records: teams, total: teams.length }
      },
      apiParams: { name: '' },
      columnsFactory: () => [
        { prop: 'name', label: '团队名', align: 'center', minWidth: 160 },
        {
          prop: 'ownerUsername',
          label: '所有者',
          align: 'center',
          width: 140,
          formatter: (row: any) => row.ownerUsername || '--'
        },
        { prop: 'memberCount', label: '成员数', align: 'center', width: 90 },
        {
          prop: 'tokenDailyLimit',
          label: 'Token 配额',
          align: 'center',
          width: 120,
          formatter: (row: any) => (row.tokenDailyLimit === 0 ? '不限' : `${row.tokenDailyLimit}/日`)
        },
        {
          prop: 'createdAt',
          label: '创建时间',
          align: 'center',
          width: 180,
          formatter: (row: any) => formatDate(row.createdAt)
        },
        {
          prop: 'operation',
          label: '操作',
          align: 'center',
          width: 180,
          fixed: 'right',
          formatter: (row: any) =>
            h('div', { class: 'operation-column-container' }, [
              h(ArtButtonTable, {
                type: 'view',
                style: 'margin-right: 8px;',
                onClick: () => showDetail(row)
              }),
              h(ArtButtonTable, {
                type: 'delete',
                onClick: () => handleDeleteTeam(row)
              })
            ])
        }
      ]
    },
    transform: {
      // 前端按搜索关键字过滤(后端 list 不支持 name 过滤)
      dataTransformer: (rows: any[]): any[] => {
        const kw = ((searchParams as any)?.name as string)?.trim()?.toLowerCase?.()
        if (!kw) return rows
        return rows.filter((r) => r.name?.toLowerCase().includes(kw))
      }
    },
    hooks: {
      onError: (error) => ElMessage.error(error.message)
    }
  })

  // ====== 详情抽屉 ======
  const detailDrawer = ref(false)
  const detailTeam = ref<TeamDetail | null>(null)
  const loadingDetail = ref(false)
  const detailTab = ref<'members' | 'projects'>('members')

  // 详情里 owner username(列表项有,详情没有,从 allTeams 查)
  const ownerUsername = computed(() => {
    if (!detailTeam.value) return ''
    const item = allTeams.value.find((t) => t.id === detailTeam.value!.id)
    return item?.ownerUsername ?? ''
  })

  // ====== 项目(详情里) ======
  const detailProjects = ref<TeamProjectItem[]>([])
  const loadingProjects = ref(false)
  const showProjectDialog = ref(false)
  const projectForm = reactive({ name: '', rootPath: '' })
  const creatingProject = ref(false)

  // ====== 添加成员 ======
  const addMemberUsername = ref('')
  const addMemberRole = ref<'ADMIN' | 'MEMBER'>('MEMBER')
  const addingMember = ref(false)

  // ====== 创建团队 ======
  const createDialog = ref(false)
  const createForm = reactive({ name: '', ownerUsername: '' })
  const creating = ref(false)

  function formatDate(s: string): string {
    try {
      return new Date(s).toLocaleString('zh-CN', { hour12: false })
    } catch {
      return s
    }
  }
  function roleTagType(role: string) {
    if (role === 'OWNER') return 'danger' as const
    if (role === 'ADMIN') return 'warning' as const
    return 'info' as const
  }

  async function showDetail(row: any) {
    detailDrawer.value = true
    detailTeam.value = null
    loadingDetail.value = true
    try {
      detailTeam.value = await adminGetTeam(row.id)
      await loadProjects(row.id)
    } catch (e: any) {
      ElMessage.error(e?.message || '加载详情失败')
    } finally {
      loadingDetail.value = false
    }
  }

  async function loadProjects(teamId: string) {
    loadingProjects.value = true
    try {
      detailProjects.value = await listTeamProjects(teamId)
    } catch {
      detailProjects.value = []
    } finally {
      loadingProjects.value = false
    }
  }

  // ====== 创建团队 ======
  function showCreateDialog() {
    createForm.name = ''
    createForm.ownerUsername = ''
    createDialog.value = true
  }

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
      const exact = records.find((u: any) => u.username === username.trim())
      return exact?.id ?? records[0]?.id ?? null
    } catch {
      return null
    }
  }

  async function handleCreateTeam() {
    const name = createForm.name.trim()
    const ownerUsernameVal = createForm.ownerUsername.trim()
    if (!name) {
      ElMessage.warning('请输入团队名称')
      return
    }
    if (!ownerUsernameVal) {
      ElMessage.warning('请输入所有者账号')
      return
    }
    creating.value = true
    try {
      const ownerId = await resolveUserIdByUsername(ownerUsernameVal)
      if (!ownerId) {
        ElMessage.error(`找不到用户「${ownerUsernameVal}」`)
        return
      }
      await adminCreateTeam(name, ownerId)
      ElMessage.success('团队已创建')
      createDialog.value = false
      refresh()
    } catch (e: any) {
      const msg = e?.message || e?.response?.data?.error || '创建失败'
      ElMessage.error(msg)
    } finally {
      creating.value = false
    }
  }

  async function handleDeleteTeam(row: any) {
    try {
      await ElMessageBox.confirm(
        `确定删除团队「${row.name}」吗?所有成员会从该团队移除,但用户账号保留。`,
        '删除团队',
        { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
    try {
      await adminDeleteTeam(row.id)
      ElMessage.success('已删除')
      refresh()
    } catch (e: any) {
      ElMessage.error(e?.message || '删除失败')
    }
  }

  // ====== 成员管理 ======
  async function handleAddMember() {
    if (!detailTeam.value) return
    const username = addMemberUsername.value.trim()
    if (!username) {
      ElMessage.warning('请输入登录账号')
      return
    }
    addingMember.value = true
    try {
      const userId = await resolveUserIdByUsername(username)
      if (!userId) {
        ElMessage.error(`找不到用户「${username}」`)
        return
      }
      await addTeamMember(detailTeam.value.id, userId, addMemberRole.value)
      ElMessage.success('已添加')
      addMemberUsername.value = ''
      // 刷新详情
      detailTeam.value = await adminGetTeam(detailTeam.value.id)
    } catch (e: any) {
      ElMessage.error(e?.message || '添加失败')
    } finally {
      addingMember.value = false
    }
  }

  async function handleChangeRole(member: any, newRole: 'ADMIN' | 'MEMBER') {
    if (!detailTeam.value) return
    try {
      await updateMemberRole(detailTeam.value.id, member.userId, newRole)
      ElMessage.success('已更新')
      detailTeam.value = await adminGetTeam(detailTeam.value.id)
    } catch (e: any) {
      ElMessage.error(e?.message || '更新失败')
    }
  }

  async function handleRemoveMember(member: any) {
    if (!detailTeam.value) return
    try {
      await ElMessageBox.confirm(
        `确定移除「${member.username}」?`,
        '移除成员',
        { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
    try {
      await removeTeamMember(detailTeam.value.id, member.userId)
      ElMessage.success('已移除')
      detailTeam.value = await adminGetTeam(detailTeam.value.id)
    } catch (e: any) {
      ElMessage.error(e?.message || '移除失败')
    }
  }

  // ====== 创建项目 ======
  async function handleCreateProject() {
    if (!detailTeam.value) return
    const name = projectForm.name.trim()
    const rootPath = projectForm.rootPath.trim()
    if (!name) {
      ElMessage.warning('请输入项目名')
      return
    }
    if (!rootPath) {
      ElMessage.warning('请输入根目录')
      return
    }
    creatingProject.value = true
    try {
      await createTeamProject(detailTeam.value.id, name, rootPath)
      ElMessage.success('已创建')
      showProjectDialog.value = false
      projectForm.name = ''
      projectForm.rootPath = ''
      await loadProjects(detailTeam.value.id)
    } catch (e: any) {
      ElMessage.error(e?.message || '创建失败')
    } finally {
      creatingProject.value = false
    }
  }
</script>

<style scoped>
  .detail-desc {
    margin-bottom: 16px;
  }
  .detail-tabs {
    margin-top: 8px;
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
  .form-tip {
    color: var(--el-text-color-secondary);
    font-size: 12px;
    margin-top: 4px;
  }
  .operation-column-container {
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
