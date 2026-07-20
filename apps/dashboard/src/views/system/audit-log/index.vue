<!-- 审计日志页面 -->
<template>
  <div class="audit-log-page art-full-height" id="table-full-screen">
    <!-- 搜索栏 -->
    <ArtSearchBar
      v-model="searchParams"
      :items="searchItems"
      @reset="resetSearchParams"
      @search="getDataByPage"
    />

    <ElCard shadow="never" class="art-table-card">
      <!-- 表格头部 -->
      <ArtTableHeader v-model:columns="columnChecks" @refresh="refresh">
        <template #left>
          <ElButton @click="handleExport" :loading="exportLoading">导出CSV</ElButton>
        </template>
      </ArtTableHeader>

      <!-- 表格 -->
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

      <!-- 详情弹窗 -->
      <ElDialog
        v-model="detailVisible"
        title="审计日志详情"
        width="780px"
        :close-on-click-modal="false"
        destroy-on-close
      >
        <div v-if="detail" class="detail-content">
          <ElDescriptions :column="2" border>
            <ElDescriptionsItem label="ID">{{ detail.id }}</ElDescriptionsItem>
            <ElDescriptionsItem label="操作用户">{{ detail.user_id || '-' }}</ElDescriptionsItem>
            <ElDescriptionsItem label="操作类型">
              <ElTag :type="getActionTagType(detail.action)" size="small">
                {{ detail.action }}
              </ElTag>
            </ElDescriptionsItem>
            <ElDescriptionsItem label="资源类型">{{ detail.resource_type || '-' }}</ElDescriptionsItem>
            <ElDescriptionsItem label="资源ID">{{ detail.resource_id ?? '-' }}</ElDescriptionsItem>
            <ElDescriptionsItem label="创建时间" :span="2">{{ formatDateTime(detail.created_at) }}</ElDescriptionsItem>
            <ElDescriptionsItem label="元数据(metadata)" :span="2">
              <pre v-if="detail.metadata" class="json-pre">{{ formatMetadata(detail.metadata) }}</pre>
              <span v-else class="muted">-</span>
            </ElDescriptionsItem>
          </ElDescriptions>
        </div>
      </ElDialog>
    </ElCard>
  </div>
</template>

<script setup lang="ts">
  import { ref, h, resolveComponent } from 'vue'
  import { ElMessage } from 'element-plus'
  import {
    getAuditLogList,
    getAuditLogDetail,
    exportAuditLogs,
    type AuditLogItem,
  } from '@/api/audit-log'
  import { useTable } from '@/composables/useTable'
  import type { SearchFormItem } from '@/types'

  defineOptions({ name: 'AuditLog' })

  // 操作类型下拉(对齐后端 AuditAction token)
  const actionOptions = [
    { label: '登录', value: 'auth.login' },
    { label: '登录失败', value: 'auth.login_failed' },
    { label: '登出', value: 'auth.logout' },
    { label: '创建会话', value: 'session.create' },
    { label: '访问拒绝', value: 'session.access_denied' },
    { label: '共享会话', value: 'session.share_create' },
    { label: '取消共享', value: 'session.share_delete' },
    { label: '导出会话', value: 'session.export' },
    { label: '创建用户', value: 'user.create' },
    { label: '编辑用户', value: 'user.update' },
    { label: '删除用户', value: 'user.delete' },
    { label: '启用/停用', value: 'user.disable' },
    { label: '修改密码', value: 'user.password_change' },
    { label: '重置密码', value: 'user.reset_password' },
    { label: '分配角色', value: 'user.assign_role' },
    { label: '创建角色', value: 'role.create' },
    { label: '编辑角色', value: 'role.update' },
    { label: '删除角色', value: 'role.delete' },
    { label: '角色授权', value: 'role.assign_permission' },
    { label: '创建菜单', value: 'menu.create' },
    { label: '编辑菜单', value: 'menu.update' },
    { label: '删除菜单', value: 'menu.delete' },
  ]

  // 搜索表单配置
  const searchItems: SearchFormItem[] = [
    {
      label: '操作用户',
      key: 'user_id',
      type: 'input',
      clearable: true,
      placeholder: '请输入用户 ID',
    },
    {
      label: '操作类型',
      key: 'action',
      type: 'select',
      clearable: true,
      placeholder: '请选择',
      options: actionOptions,
    },
    {
      label: '资源类型',
      key: 'resource_type',
      type: 'input',
      clearable: true,
      placeholder: '如 user / role / session',
    },
    {
      label: '开始日期',
      key: 'start_date',
      type: 'date',
      clearable: true,
      placeholder: '开始日期',
    },
    {
      label: '结束日期',
      key: 'end_date',
      type: 'date',
      clearable: true,
      placeholder: '结束日期',
    },
  ]

  // 详情弹窗
  const detailVisible = ref(false)
  const detail = ref<AuditLogItem | null>(null)
  const exportLoading = ref(false)

  // 操作类型 Tag 颜色
  const getActionTagType = (action: string) => {
    if (!action) return 'info' as const
    if (action.startsWith('auth.login_failed') || action.includes('access_denied') || action.includes('delete') || action.includes('disable')) {
      return 'danger' as const
    }
    if (action.endsWith('.create') || action.endsWith('.login')) {
      return 'success' as const
    }
    if (action.endsWith('.update') || action.endsWith('.change') || action.endsWith('.assign')) {
      return 'warning' as const
    }
    return 'info' as const
  }

  // metadata 字符串格式化为 JSON
  const formatMetadata = (val: unknown) => {
    if (!val) return ''
    try {
      if (typeof val === 'string') return JSON.stringify(JSON.parse(val), null, 2)
      return JSON.stringify(val, null, 2)
    } catch {
      return String(val)
    }
  }

  // 时间格式化(友好显示)
  const formatDateTime = (val: any): string => {
    if (!val) return '-'
    try {
      const d = new Date(val)
      if (isNaN(d.getTime())) return String(val)
      return d.toLocaleString('zh-CN', { hour12: false })
    } catch {
      return String(val)
    }
  }

  // useTable
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
    refreshAll: refresh,
  } = useTable<any>({
    core: {
      apiFn: getAuditLogList,
      apiParams: {
        page: 1,
        page_size: 20,
        user_id: '',
        action: '',
        resource_type: '',
        start_date: '',
        end_date: '',
      },
      paginationKey: {
        current: 'page',
        size: 'page_size',
      },
      columnsFactory: () => [
        {
          prop: 'id',
          label: 'ID',
          align: 'center',
          width: 120,
          showOverflowTooltip: true,
        },
        {
          prop: 'user_id',
          label: '操作用户',
          align: 'center',
          width: 140,
          formatter: (row: any) => row.user_id || '-',
        },
        {
          prop: 'action',
          label: '操作类型',
          align: 'center',
          width: 150,
          formatter: (row: any) =>
            h(
              resolveComponent('ElTag'),
              { type: getActionTagType(row.action) as any, size: 'small' },
              { default: () => row.action },
            ),
        },
        {
          prop: 'resource_type',
          label: '资源类型',
          align: 'center',
          width: 120,
          formatter: (row: any) => row.resource_type || '-',
        },
        {
          prop: 'resource_id',
          label: '资源ID',
          align: 'center',
          minWidth: 140,
          showOverflowTooltip: true,
          formatter: (row: any) => row.resource_id || '-',
        },
        {
          prop: 'created_at',
          label: '创建时间',
          align: 'center',
          width: 180,
          formatter: (row: any) => formatDateTime(row.created_at),
        },
        {
          prop: 'operation',
          label: '操作',
          align: 'center',
          width: 100,
          fixed: 'right',
          formatter: (row: any) =>
            h(
              'el-button',
              {
                type: 'primary',
                link: true,
                onClick: () => showDetail(row.id),
              },
              { default: () => '查看' },
            ),
        },
      ],
    },
    hooks: {
      onError: (error) => ElMessage.error(error.message),
    },
  })

  // 查看详情
  const showDetail = async (id: string) => {
    try {
      const row = await getAuditLogDetail(id)
      detail.value = row
      detailVisible.value = true
    } catch (e: any) {
      ElMessage.error(e?.message || '获取详情失败')
    }
  }

  // 导出 CSV
  const handleExport = async () => {
    exportLoading.value = true
    try {
      const params: Record<string, any> = {
        user_id: (searchParams as any).user_id,
        action: (searchParams as any).action,
        resource_type: (searchParams as any).resource_type,
        from: (searchParams as any).start_date,
        to: (searchParams as any).end_date,
      }
      Object.keys(params).forEach((k) => {
        if (params[k] === '' || params[k] === undefined || params[k] === null) {
          delete params[k]
        }
      })

      const { blob, filename } = await exportAuditLogs(params)

      // 触发浏览器下载
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      ElMessage.success('导出成功')
    } catch (e: any) {
      ElMessage.error(e?.message || '导出失败')
    } finally {
      exportLoading.value = false
    }
  }
</script>

<style lang="scss" scoped>
  .audit-log-page {
    .json-pre {
      max-height: 240px;
      overflow: auto;
      padding: 8px 12px;
      margin: 0;
      background-color: var(--el-fill-color-light);
      border-radius: 4px;
      font-size: 12px;
      font-family: 'Courier New', Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .muted {
      color: var(--el-text-color-placeholder);
    }
  }
</style>
