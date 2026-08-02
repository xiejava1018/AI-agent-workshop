<template>
  <div class="role-page art-full-height" id="table-full-screen">
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
          <ElButton @click="showDialog('add')">添加角色</ElButton>
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

      <!-- 角色弹窗 -->
      <ElDialog
        v-model="dialogVisible"
        :title="dialogType === 'add' ? '新增角色' : '编辑角色'"
        width="500px"
        :close-on-click-modal="false"
        destroy-on-close
      >
        <ElForm ref="formRef" :model="form" :rules="rules" label-width="100px" @submit.prevent>
          <ElFormItem label="角色编码" prop="code">
            <ElInput
              v-model="form.code"
              :disabled="dialogType === 'edit'"
              placeholder="请输入角色编码（英文字母或下划线）"
            />
          </ElFormItem>
          <ElFormItem label="角色名称" prop="name">
            <ElInput v-model="form.name" placeholder="请输入角色名称" />
          </ElFormItem>
          <ElFormItem label="描述" prop="desc">
            <ElInput v-model="form.desc" type="textarea" :rows="3" placeholder="请输入角色描述" />
          </ElFormItem>
          <ElFormItem label="启用">
            <ElSwitch v-model="form.status" />
          </ElFormItem>
        </ElForm>
        <template #footer>
          <div class="dialog-footer">
            <ElButton @click="dialogVisible = false">取消</ElButton>
            <ElButton type="primary" @click="handleSubmit(formRef)" :loading="submitLoading"
              >提交</ElButton
            >
          </div>
        </template>
      </ElDialog>

      <RoleAuth
        v-model:visible="permissionDrawer"
        :role-id="currentRoleId"
        @saved="handlePermissionSaved"
      />
    </ElCard>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, h, resolveComponent, nextTick } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import type { FormInstance, FormRules } from 'element-plus'
  import { getRoleList, addRole, updateRole, deleteRole } from '@/api/system/api'
  import RoleAuth from './auth.vue'
  import { useTable } from '@/composables/useTable'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import { SearchFormItem } from '@/types'

  // 搜索表单配置项
  const searchItems: SearchFormItem[] = [
    {
      label: '角色名称',
      key: 'name',
      type: 'input',
      clearable: true,
      placeholder: '请输入角色名称'
    },
    {
      label: '状态',
      key: 'status',
      type: 'select',
      clearable: true,
      placeholder: '请选择状态',
      options: [
        { label: '启用', value: 1 },
        { label: '禁用', value: 2 }
      ]
    }
  ]

  // 表单数据
  const form = reactive({
    id: '' as string,
    code: '' as string,
    name: '' as string,
    desc: '' as string,
    status: true as boolean
  })
  const dialogType = ref('add')
  const dialogVisible = ref(false)
  const submitLoading = ref(false)
  const currentRoleId = ref<number | undefined>(undefined)
  const formRef = ref<FormInstance>()
  const permissionDrawer = ref(false)

  // 表单验证规则
  const rules = reactive<FormRules>({
    code: [
      { required: true, message: '请输入角色编码', trigger: 'blur' },
      {
        pattern: /^[a-z][a-z0-9_]*$/,
        message: '角色编码以小写字母开头，仅含小写字母、数字、下划线',
        trigger: 'blur'
      },
      { min: 2, max: 50, message: '长度在 2 到 50 个字符', trigger: 'blur' }
    ],
    name: [
      { required: true, message: '请输入角色名称', trigger: 'blur' },
      { min: 2, max: 20, message: '长度在 2 到 20 个字符', trigger: 'blur' }
    ],
    desc: [{ required: true, message: '请输入角色描述', trigger: 'blur' }]
  })

  // 操作按钮：不超过3个时直接展示按钮（权限/编辑/删除）

  // useTable 适配
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
  } = useTable<any>({
    core: {
      apiFn: getRoleList,
      apiParams: {
        page: 1,
        pageSize: 10,
        name: '',
        status: undefined
      },
      columnsFactory: () => [
        {
          prop: 'code',
          label: '角色编码',
          align: 'center',
          formatter: (row: any) => row.code || '--'
        },
        {
          prop: 'name',
          label: '角色名称',
          align: 'center'
        },
        {
          prop: 'desc',
          label: '描述',
          align: 'center',
          showOverflowTooltip: true,
          formatter: (row: any) => row.desc || '--'
        },
        {
          prop: 'enabled',
          label: '状态',
          align: 'center',
          formatter: (row: any) =>
            h(
              resolveComponent('ElTag'),
              { type: row.enabled !== false ? 'primary' : 'warning' },
              { default: () => (row.enabled !== false ? '启用' : '禁用') }
            )
        },
        {
          prop: 'operation',
          label: '操作',
          align: 'center',
          width: 200,
          fixed: 'right',
          formatter: (row: any) =>
            h('div', { class: 'operation-column-container' }, [
              h(ArtButtonTable, {
                type: 'view',
                style: 'margin-right: 8px;',
                onClick: () => showPermissionDrawer(row)
              }),
              h(ArtButtonTable, {
                type: 'edit',
                style: 'margin-right: 8px;',
                onClick: () => showDialog('edit', row)
              }),
              h(ArtButtonTable, {
                type: 'delete',
                onClick: () => deleteRoleAction(row.id)
              })
            ])
        }
      ]
    },
    hooks: {
      onError: (error) => ElMessage.error(error.message)
    }
  })

  // 注意：操作按钮已直接渲染为三个按钮，无需“更多”下拉

  // 弹窗相关
  const showDialog = (type: string, row?: any) => {
    dialogType.value = type
    dialogVisible.value = true
    nextTick(() => {
      formRef.value?.resetFields()
      if (type === 'edit' && row) {
        form.id = row.id ? String(row.id) : ''
        form.code = row.code || ''
        form.name = row.name || ''
        form.desc = row.desc || ''
        // 后端 GET 返回 enabled boolean。表格渲染 / 编辑表单都用 status 表达 1/2。
        // 这里直接保留 boolean 即可（ElSwitch 期望 boolean）。
        form.status = row.enabled !== false
      } else {
        form.id = ''
        form.code = ''
        form.name = ''
        form.desc = ''
        form.status = true
      }
    })
  }

  // 权限抽屉
  const showPermissionDrawer = (row: any) => {
    currentRoleId.value = row.id
    permissionDrawer.value = true
  }

  const handlePermissionSaved = () => {
    ElMessage.success('权限设置已保存')
    refresh()
  }

  // 删除角色
  const deleteRoleAction = (id: string | number) => {
    ElMessageBox.confirm('确定删除该角色吗？删除后无法恢复！', '删除确认', {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
      .then(async () => {
        try {
          // 后端 SysRole.id 是 cuid 字符串。直接透传避免 Number(cuid) → NaN → 404。
          const response = await deleteRole(String(id))
          if (response && (response.id || response.code === 200)) {
            ElMessage.success('删除成功')
            refresh()
          } else {
            ElMessage.error('删除失败')
          }
        } catch (err: any) {
          console.error('删除角色出错:', err)
          const serverMessage =
            err?.message ||
            err?.response?.data?.error ||
            err?.response?.data?.message
          ElMessage.error(serverMessage || '删除失败，请稍后再试')
        }
      })
      .catch(() => {})
  }

  // 提交表单
  const handleSubmit = async (formEl: FormInstance | undefined) => {
    if (!formEl) return
    await formEl.validate(async (valid) => {
      if (valid) {
        submitLoading.value = true
        try {
          // 后端契约（SysRole）：code / name / desc / enabled / sort
          //   - 新增时需要带 code(后端唯一键);
          //   - 编辑时**严禁**带 code(后端 PUT 路由会拒绝并 400 'code is immutable',
          //     这就是用户报“修改角色名称和描述报错”的根因)。编辑仅传 name/desc/enabled。
          const roleData =
            dialogType.value === 'add'
              ? {
                  code: form.code,
                  name: form.name,
                  desc: form.desc,
                  enabled: form.status === true
                }
              : {
                  name: form.name,
                  desc: form.desc,
                  enabled: form.status === true
                }
          const response =
            dialogType.value === 'add'
              ? await addRole(roleData)
              : await updateRole(form.id, roleData)
          // httpClient 默认解包 res.data —— 拿到的 response 是后端 envelope.data
          //   新增：{ id, code }
          //   修改：{ id }
          // 只要拿到 id 就视为成功；新增时后端 code & name 唯一性重复会返回 409，
          // 这种错误会在 catch 里从 error.message 抽取后端 message。
          if (response && (response.id || response.code)) {
            ElMessage.success(dialogType.value === 'add' ? '新增成功' : '修改成功')
            dialogVisible.value = false
            refresh()
          } else {
            ElMessage.error('操作失败')
          }
        } catch (err: any) {
          // 后端 400/409 等错误响应会被 httpClient 拦截器包装成 HttpError；
          // error.message 已含后端返回的具体原因（如 "code & name required" /
          // "role code 'xxx' already exists"），直接透传给用户更可读。
          console.error('提交表单出错:', err)
          const serverMessage =
            err?.message ||
            err?.response?.data?.error ||
            err?.response?.data?.message
          ElMessage.error(serverMessage || '操作失败，请稍后再试')
        } finally {
          submitLoading.value = false
        }
      }
    })
  }
</script>

<style lang="scss" scoped>
  .role-page {
    // 添加表格容器样式
    .table-container {
      flex: 1;
      min-height: 0; // 重要：允许容器收缩
      padding: 16px; // 根据需求调整内边距
    }

    .search-container {
      display: flex;
      justify-content: space-between;
      margin-bottom: 16px;

      .el-input {
        width: 240px;
        margin-right: 16px;
      }
    }

    .svg-icon {
      width: 1.8em;
      height: 1.8em;
      vertical-align: -8px;
      fill: currentcolor;
    }

    .operation-column-container {
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }
</style>
