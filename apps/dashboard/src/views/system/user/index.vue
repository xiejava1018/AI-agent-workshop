<template>
  <div class="user-page art-full-height">
    <!-- 搜索栏 -->
    <ArtSearchBar
      v-model="searchState"
      :items="searchItems"
      @reset="resetSearch"
      @search="searchData"
    />

    <ElCard shadow="never" class="art-table-card">
      <!-- 表格头部 -->
      <ArtTableHeader
        :columnList="columnOptions"
        v-model:columns="columnChecks"
        @refresh="handleRefresh"
      >
        <template #left>
          <ElButton @click="showDialog('add')" v-ripple>添加用户</ElButton>
        </template>
      </ArtTableHeader>

      <!-- 表格 -->
      <ArtTable
        :data="tableData"
        :columns="columns"
        :pagination="paginationState"
        :loading="isLoading"
        table-layout="fixed"
        :table-config="{ rowKey: 'id' }"
        :layout="{ marginTop: 10 }"
        @pagination:size-change="onPageSizeChange"
        @pagination:current-change="onCurrentPageChange"
      />
    </ElCard>

    <ElDialog
      v-model="dialogVisible"
      :title="dialogType === 'add' ? '添加用户' : '编辑用户'"
      width="600px"
      align-center
      :close-on-click-modal="false"
    >
      <ElForm ref="formRef" :model="formData" :rules="computedRules" label-width="85px">
        <ElRow :gutter="20">
          <ElCol :span="12">
            <ElFormItem label="登录账号" prop="username">
              <ElInput
                v-model="formData.username"
                :disabled="dialogType === 'edit'"
                placeholder="请输入登录账号（字母或数字）"
              />
            </ElFormItem>
          </ElCol>
          <ElCol :span="12">
            <ElFormItem label="用户名称" prop="full_name">
              <ElInput v-model="formData.full_name" placeholder="请输入用户名称（界面显示名）" />
            </ElFormItem>
          </ElCol>
        </ElRow>

        <ElRow :gutter="20">
          <ElCol :span="12">
            <ElFormItem label="邮箱" prop="email">
              <ElInput v-model="formData.email" placeholder="请输入邮箱" />
            </ElFormItem>
          </ElCol>
          <ElCol :span="12">
            <ElFormItem label="手机号" prop="phone">
              <ElInput v-model="formData.phone" placeholder="请输入手机号" />
            </ElFormItem>
          </ElCol>
        </ElRow>

        <ElRow :gutter="20">
          <ElCol :span="12">
            <ElFormItem label="密码" prop="password">
              <ElInput
                v-model="formData.password"
                type="password"
                show-password
                :placeholder="dialogType === 'add' ? '请输入密码' : '不填则不修改密码'"
              />
            </ElFormItem>
          </ElCol>
          <ElCol :span="12">
            <ElFormItem label="性别" prop="gender">
              <ElSelect v-model="formData.gender" placeholder="请选择性别" style="width: 100%">
                <ElOption label="请选择" value="" disabled></ElOption>
                <ElOption label="男" :value="1" />
                <ElOption label="女" :value="2" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
        </ElRow>

        <ElRow :gutter="20">
          <ElCol :span="12">
            <ElFormItem label="角色" prop="role_id">
              <ElSelect v-model="formData.role_id" placeholder="请选择角色" style="width: 100%">
                <ElOption label="请选择" value="" disabled></ElOption>
                <ElOption
                  v-for="item in roleList"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id"
                  :disabled="item.is_active === false"
                />
              </ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol :span="12">
            <ElFormItem label="启用">
              <ElSwitch v-model="formData.status" :active-value="1" :inactive-value="2" />
            </ElFormItem>
          </ElCol>
        </ElRow>

        <!-- 团队选择(仅新增模式):创建用户后自动加入该团队成为 MEMBER。
             解决“管理员创建用户后用户不在任何团队 → /api/agent/new 报 no project
             selected”的缺口。编辑模式不显示(改团队成员走团队管理页)。 -->
        <ElRow :gutter="20" v-if="dialogType === 'add'">
          <ElCol :span="12">
            <ElFormItem label="加入团队">
              <ElSelect
                v-model="formData.teamId"
                placeholder="可选,选择后自动加入该团队"
                clearable
                style="width: 100%"
              >
                <ElOption
                  v-for="t in teamOptions"
                  :key="t.id"
                  :label="t.name"
                  :value="t.id"
                />
              </ElSelect>
            </ElFormItem>
          </ElCol>
        </ElRow>
      </ElForm>

      <template #footer>
        <div class="dialog-footer">
          <ElButton @click="dialogVisible = false">取 消</ElButton>
          <ElButton type="primary" @click="handleSubmit">确 定</ElButton>
        </div>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, nextTick, computed, h, resolveComponent, onMounted } from 'vue'
  import {
    getUserList,
    addUser,
    updateUser,
    deleteUser as apiDeleteUser,
    getRoleList,
    assignUserRoles,
    setUserPassword
  } from '@/api/system/api'
  import { listTeamsForPicker, type AdminTeamListItem, type MyTeamItem } from '@/api/team'
  import { FormInstance } from 'element-plus'
  import { ElMessageBox, ElMessage } from 'element-plus'
  import { useTable } from '@/composables/useTable'
  import { useUserStore } from '@/store/modules/user'
  import { SearchFormItem } from '@/types'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'

  // 状态变量
  const dialogType = ref('add')
  const dialogVisible = ref(false)
  // useTable 适配
  const tableApi = useTable<any>({
    core: {
      apiFn: getUserList,
      apiParams: {
        page: 1,
        pageSize: 10,
        username: '',
        full_name: '',
        email: '',
        phone: '',
        role_id: undefined
      },
      columnsFactory: () => [
        {
          prop: 'username',
          label: '登录账号',
          align: 'center',
          formatter: (row: any) => row.username || '--'
        },
        {
          prop: 'full_name',
          label: '用户名称',
          align: 'center',
          formatter: (row: any) => row.full_name || '--'
        },
        {
          prop: 'email',
          label: '邮箱',
          align: 'center',
          formatter: (row: any) => row.email || '--'
        },
        {
          prop: 'phone',
          label: '手机号',
          align: 'center',
          formatter: (row: any) => row.phone || '--'
        },
        {
          prop: 'gender',
          label: '性别',
          align: 'center',
          formatter: (row: any) => {
            if (row.gender === 1)
              return h(
                resolveComponent('ElTag'),
                { type: 'success', effect: 'light' },
                { default: () => '男' }
              )
            if (row.gender === 2)
              return h(
                resolveComponent('ElTag'),
                { type: 'danger', effect: 'light' },
                { default: () => '女' }
              )
            return '--'
          }
        },
        {
          prop: 'roleNames',
          label: '角色',
          align: 'center',
          // 后端 GET /users 返回 roleNames: string[]（角色显示名列表，1 个或多
          // 个）。前端表格直接读字符串字段渲染即可，无需走 v-model 对象。
          // 历史字段 `role_name`(单数字符串)与 `role_id`(单数字符串)也被
          // 兼容识别,避免老数据突变显示空。
          formatter: (row: any) => {
            if (Array.isArray(row?.roleNames) && row.roleNames.length > 0) {
              return row.roleNames.join(', ')
            }
            if (typeof row?.role_name === 'string' && row.role_name) {
              return row.role_name
            }
            return '--'
          }
        },
        {
          prop: 'status',
          label: '状态',
          align: 'center',
          formatter: (row: any) =>
            h(
              resolveComponent('ElTag'),
              { type: getTagType(row.status) },
              { default: () => buildTagText(row.status) }
            )
        },
        {
          prop: 'operation',
          label: '操作',
          align: 'center',
          width: 120,
          fixed: 'right',
          formatter: (row: any) =>
            h('div', { class: 'operation-column-container' }, [
              h(ArtButtonTable, {
                type: 'edit',
                style: 'margin-right: 8px;',
                onClick: () => showDialog('edit', row)
              }),
              h(ArtButtonTable, {
                type: 'delete',
                onClick: () => handleDeleteUser(row)
              })
            ])
        }
      ]
    },
    hooks: {
      onError: (error) => ElMessage.error(error.message)
    }
  })

  const {
    data: tableData,
    loading: isLoading,
    columns,
    columnChecks,
    pagination: paginationState,
    searchParams: searchState,
    getData: searchData,
    resetSearchParams: resetSearch,
    handleSizeChange: onPageSizeChange,
    handleCurrentChange: onCurrentPageChange,
    refreshAll
  } = tableApi as any

  // 角色列表的响应式数据
  const roleList = ref<any[]>([])

  const userStore = useUserStore()

  // 团队下拉选项:platform_admin 看到所有团队,其他用户看到“我加入的团队”。
  // 仅在新增用户对话框中用(选择后创建时自动把新用户加入该团队)。
  const teamOptions = ref<Array<(AdminTeamListItem & MyTeamItem) | any>>([])

  async function loadTeamOptions() {
    try {
      const isPlatformAdmin = userStore.hasPermission('platform:access')
      teamOptions.value = await listTeamsForPicker(isPlatformAdmin)
    } catch (err) {
      console.warn('[user] load team options failed', err)
      teamOptions.value = []
    }
  }

  // role.id -> role.code 的映射,提交时用于把单选 role_id
  // 转换为后端 roleCodes[]。同时该映射也用在表格“角色”这一列。
  const roleIdToCode = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const r of roleList.value as any[]) {
      if (r && r.id != null) {
        // GET /roles 返回的字段可能为 id（role.id）/ code(角色 code），两者都可能存在
        // 这里不仅存 code，还把可能的 name 存入兼容 —— 后端 role binding 只能识别 code。
        const code = r.code ?? r.roleCode ?? r.name
        if (code) map[String(r.id)] = String(code)
      }
    }
    return map
  })

  // role.code -> role.id 的反向映射,编辑表单回显时把后端返回的 roleCodes[]
  // 转换为 ElSelect 需要的 role.id(ElOption :value="item.id"),保证 ElSelect
  // 能匹配到对应选项并显示中文名称。未加载同步用户管理后端 role 列表时
  // 偶发打开编辑弹窗会出现“code 文本显示在选择框里”的现象,这就是根因。
  const codeToId = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const r of roleList.value as any[]) {
      if (r && r.id != null && r.code) {
        map[String(r.code)] = String(r.id)
      }
    }
    return map
  })

  // 用户表单数据
  const formData = reactive({
    id: '',
    username: '',
    email: '',
    full_name: '',
    password: '',
    phone: '',
    gender: undefined as number | undefined,
    status: 1 as number, // 1 = 启用, 2 = 禁用(前端 UI 约定)
    role_id: undefined as string | undefined,
    // 仅新增模式用:创建后自动加入该团队(对应后端 POST /api/v1/users 的
    // teamId 参数)。编辑模式留空 —— 改团队成员走团队管理页。
    teamId: undefined as string | undefined
  })

  // 搜索表单配置项
  const searchItems: SearchFormItem[] = [
    {
      label: '登录账号',
      key: 'username',
      type: 'input',
      span: 6,
      clearable: true,
      placeholder: '请输入登录账号'
    },
    {
      label: '用户名称',
      key: 'full_name',
      type: 'input',
      span: 6,
      clearable: true,
      placeholder: '请输入用户名称'
    },
    {
      label: '邮箱',
      key: 'email',
      type: 'input',
      span: 6,
      clearable: true,
      placeholder: '请输入邮箱'
    },
    {
      label: '手机号',
      key: 'phone',
      type: 'input',
      span: 6,
      clearable: true,
      placeholder: '请输入手机号'
    },
    {
      label: '角色',
      key: 'role_id',
      type: 'select',
      span: 6,
      clearable: true,
      placeholder: '请选择角色',
      options: () =>
        roleList.value.map((item) => ({
          label: item.name,
          value: item.id
        }))
    }
  ]

  // 列配置选项
  const columnOptions = [
    { label: '登录账号', prop: 'username' },
    { label: '用户名称', prop: 'full_name' },
    { label: '邮箱', prop: 'email' },
    { label: '手机号', prop: 'phone' },
    { label: '性别', prop: 'gender' },
    { label: '角色', prop: 'roleNames' },
    { label: '状态', prop: 'status' },
    { label: '操作', prop: 'operation' }
  ]

  // 已由 useTable 管理

  // 表单实例引用
  const formRef = ref<FormInstance>()

  // 刷新表格数据
  const handleRefresh = () => {
    refreshAll()
  }

  // 用户列表数据已由 useTable 管理

  // 加载角色列表数据
  const loadRoleList = async () => {
    try {
      const res = await getRoleList({ page: 1, pageSize: 200 })
      const r: any = res as any
      // 后端 RoleListResponse 字段是 items（不是 records）
      const list = Array.isArray(r?.data?.items)
        ? r.data.items
        : Array.isArray(r?.data?.records)
          ? r.data.records
          : Array.isArray(r?.data)
            ? r.data
            : Array.isArray(r)
              ? r
              : []
      roleList.value = list
    } catch (err) {
      console.error('获取角色列表出错:', err)
      ElMessage.error('获取角色列表失败')
    }
  }

  // 分页、搜索、重置逻辑已由 useTable 管理

  // 显示对话框
  const showDialog = async (type: string, row?: any) => {
    // 打开编辑弹窗前确保 roleList 已加载 —— Editing 需要把后端返回的
    // roleCodes（code）反查为 role.id（ElOption :value 的实际值）。如果
    // roleList 还没加载就打开弹窗,code → id 映射会是空,ElSelect 拿到
    // 原始 code 字符串后会在输入框里显示“代文本”错看起来像喊角色名。
    if (type === 'edit' && roleList.value.length === 0) {
      await loadRoleList()
    }

    dialogVisible.value = true
    dialogType.value = type


    if (type === 'edit' && row) {
      formData.id = row.id
      formData.username = row.username || ''
      formData.email = row.email || ''
      formData.full_name = row.full_name || ''
      formData.phone = row.phone || ''
      formData.gender = row.gender === 0 ? 1 : row.gender
      // 后端返回的 status 是 1/2 由 disabled 计算（见后端 GET），但如果
      // 老数据未带 status 字段,fallback 到 disabled 计算。
      formData.status =
        row.status ??
        (row.disabled === true ? 2 : 1)
      // 后端返回 roleCodes: string[]（角色 code 列表），ElSelect 中 <ElOption
      // :value="item.id" 以 role.id 为值。该项的 label 本应在选中后显示
      // item.name，如果 ElSelect v-model 错误保留为 code 字符串（比如
      // 'member'），Element Plus 会创建一个"看到的"值为 'member' 的临时
      // option，输入框里就会显示"member"而不是中文名。
      // 这里把 roleCodes[0]（code）反查为 role.id 后再赋值，保证选中项
      // 的 label 正确显示中文名称。ShowDialog 开头已保证 roleList 已加载。
      let resolvedRoleId: string | undefined
      if (row.role_id) {
        resolvedRoleId = String(row.role_id)
      } else if (Array.isArray(row.roleCodes) && row.roleCodes.length > 0) {
        const mappedId = codeToId.value[String(row.roleCodes[0])]
        resolvedRoleId = mappedId ?? undefined
      }
      formData.role_id = resolvedRoleId
      formData.password = ''
    } else {
      formData.id = ''
      formData.username = ''
      formData.email = ''
      formData.full_name = ''
      formData.password = ''
      formData.phone = ''
      formData.gender = undefined
      formData.status = 1
      formData.role_id = undefined
      formData.teamId = undefined

      // 确保下一个渲染周期状态为启用
      nextTick(() => {
        formData.status = 1
      })
    }

    // 强制重新计算验证规则
    nextTick(() => {
      if (formRef.value) {
        formRef.value.clearValidate()
      }
    })
  }

  // 处理删除用户
  const handleDeleteUser = (row: any) => {
    ElMessageBox.confirm('确定要删除该用户吗？', '删除用户', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'error'
    })
      .then(async () => {
        try {
          // 确保用户ID正确传递：后端 User.id 是 cuid 字符串,不要 Number()
          // 转成 NaN 造成 /api/v1/users/NaN → 404。
          const userId = row?.id
          if (!userId) {
            ElMessage.error('用户ID无效')
            return
          }

          const res = await apiDeleteUser(userId)
          if (res && res.code === 200) {
            ElMessage.success('删除用户成功')
            refreshAll()
          } else {
            ElMessage.error(res?.message || '删除用户失败')
          }
        } catch (err) {
          console.error('删除用户出错:', err)
          ElMessage.error('删除用户失败，请稍后重试')
        }
      })
      .catch(() => {
        // 用户取消删除，不做处理
      })
  }

  const getTagType = (status: number) => {
    if (status === 1) return 'success'
    if (status === 2) return 'danger'
    return 'info'
  }

  const buildTagText = (status: number) => {
    if (status === 1) return '启用'
    if (status === 2) return '禁用'
    return '未知'
  }

  // 定义基本验证规则
  const baseRules = {
    username: [
      { required: true, message: '请输入登录账号', trigger: 'blur' },
      { min: 3, max: 20, message: '长度在 3 到 20 个字符', trigger: 'blur' }
    ],
    full_name: [
      { required: true, message: '请输入用户名称', trigger: 'blur' },
      { min: 2, max: 50, message: '长度在 2 到 50 个字符', trigger: 'blur' }
    ],
    email: [
      { required: false, trigger: 'blur' },
      {
        validator: (_rule: any, value: any, callback: any) => {
          if (value === undefined || value === null || value === '') {
            callback()
            return
          }
          const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))
          ok ? callback() : callback(new Error('请输入正确的邮箱格式'))
        },
        trigger: 'blur',
      },
    ],
    phone: [
      { required: false, message: '请输入手机号', trigger: 'blur' },
      { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号格式', trigger: 'blur' }
    ],
    gender: [{ required: true, message: '请选择性别', trigger: 'change' }],
    status: [{ required: true, message: '请选择状态', trigger: 'change' }],
    role_id: [{ required: true, message: '请选择角色', trigger: 'change' }]
  }

  // 根据对话框类型动态计算验证规则
  const computedRules = computed(() => {
    // 添加模式下的规则
    if (dialogType.value === 'add') {
      return {
        ...baseRules,
        password: [
          { required: true, message: '请输入密码', trigger: 'blur' },
          { min: 6, max: 20, message: '长度在 6 到 20 个字符', trigger: 'blur' }
        ]
      }
    }
    // 编辑模式下的规则
    else {
      return {
        ...baseRules,
        password: [
          { required: false },
          {
            validator: (_rule: any, value: any, callback: any) => {
              if (!value || value === '') {
                callback()
              } else if (value.length < 6 || value.length > 20) {
                callback(new Error('长度在 6 到 20 个字符'))
              } else {
                callback()
              }
            },
            trigger: 'blur'
          }
        ]
      }
    }
  })

  // 提交表单
  const handleSubmit = async () => {
    if (!formRef.value) return

    await formRef.value.validate(async (valid) => {
      if (valid) {
        try {
          // 仅向后端提交数据库里已有的字段；前端 UI 字段映射如下：
          //   status   → disabled (1=启用=false, 2=禁用=true)
          //   role_id  → roleCodes[] (后端全局角色绑定接口以 code 为准)
          const submitData: Record<string, any> = {
            username: formData.username,
            email: formData.email?.trim() ? formData.email.trim() : null,
            full_name: formData.full_name?.trim() ? formData.full_name.trim() : null,
            phone: formData.phone?.trim() ? formData.phone.trim() : null,
            gender: formData.gender ?? null,
            disabled: formData.status === 2,
          }

          // 密码字段:创建场景下后端 POST /users 已支持传入明文 password
          // (≥ 8 字符 → bcrypt 哈希 → mustChangePassword=false)。编辑场景下
          // 后端 PUT /users/{id} 不接 password,必须调用独立的
          // PUT /users/{id}/password 接口才能生效。后端调用顺序:
          //   1. 创建/更新用户主记录(不含 password)
          //   2. 如果填了 password,独立调用 setUserPassword
          //   3. 角色绑定(assignUserRoles)
          const passwordToSet =
            typeof formData.password === 'string' && formData.password.trim()
              ? formData.password.trim()
              : ''
          if (dialogType.value === 'add' && passwordToSet) {
            ;(submitData as any).password = passwordToSet
          }

          // 创建模式额外传 teamId:后端 POST /api/v1/users 收到后会自动把新用户
          // 加入该团队(默认 MEMBER)。避免用户被创建后不在任何团队,导致
          // /api/agent/new 报 no project selected。
          if (dialogType.value === 'add' && formData.teamId) {
            ;(submitData as any).teamId = formData.teamId
          }

          // 角色选择:UI 是单选，但后端 roleCodes[] 是多选。
          const roleIdStr = formData.role_id ? String(formData.role_id) : ''
          const selectedRoleCodes: string[] = roleIdStr
            ? [roleIdToCode.value[roleIdStr]].filter(
                (c): c is string => typeof c === 'string'
              )
            : []

          let res: any
          let createdUserId: string | undefined
          if (dialogType.value === 'add') {
            if (selectedRoleCodes.length > 0) {
              ;(submitData as any).roleCodes = selectedRoleCodes
            }
            res = await addUser(submitData as any)
            // 提取新创建用户的 id,后面调 setUserPassword / assignUserRoles 用
            if (res && res.code === 200 && res.data) {
              createdUserId = res.data.id
            }
          } else {
            // 修复点:避免 Number(cuid) 被转为 NaN 造成 /api/v1/users/NaN → 404。
            // 后端 User.id 是 cuid 字符串,后端参数 id 是 string。
            res = await updateUser(formData.id, submitData as any)
            // 角色绑定:编辑模式里支持在人员管理页同步变更全局角色。
            // PUT /api/v1/users/{id}/roles 为差量替换。即使未选择角色也调用,以
            // 避免成"修改某项字段后,发现 GUI 未点角色却意外保留旧角色"的歧义。
            if (res && res.code === 200) {
              try {
                const roleRes = await assignUserRoles(
                  formData.id,
                  selectedRoleCodes
                )
                if (roleRes && roleRes.code && roleRes.code !== 200) {
                  console.warn('[user] role assignment non-200:', roleRes)
                }
              } catch (roleErr) {
                console.error('[user] role assignment failed:', roleErr)
              }
            }
          }

          // 密码调用:独立接口(创建/编辑场景下都需要)。如果失败,提示但不阻断
          // 主记录创建/更新 —— 但会明显提示用户密码未生效。
          if (res && res.code === 200 && passwordToSet) {
            const targetUserId = createdUserId ?? formData.id
            if (targetUserId) {
              try {
                const pwRes = await setUserPassword(targetUserId, passwordToSet)
                if (!pwRes || pwRes.code !== 200) {
                  ElMessage.warning(
                    pwRes?.message || '用户信息已保存,但密码设置失败,请重试'
                  )
                }
              } catch (pwErr: any) {
                console.error('[user] set password failed:', pwErr)
                const msg =
                  pwErr?.message || pwErr?.response?.data?.error || '密码设置失败'
                ElMessage.warning(`用户信息已保存,但密码设置失败: ${msg}`)
              }
            }
          }

          if (res && res.code === 200) {
            ElMessage.success(dialogType.value === 'add' ? '添加成功' : '更新成功')
            dialogVisible.value = false
            refreshAll()
          } else {
            ElMessage.error(
              res?.message ||
                (dialogType.value === 'add' ? '添加失败' : '更新失败')
            )
          }
        } catch (err) {
          console.error('提交表单出错:', err)
          ElMessage.error(dialogType.value === 'add' ? '添加失败' : '更新失败')
        }
      }
    })
  }

  // 初始化加载角色数据 + 团队下拉
  onMounted(async () => {
    await loadRoleList()
    await loadTeamOptions()
  })
</script>

<style lang="scss" scoped>
  .user-page {
    .table-container {
      flex: 1;
      min-height: 0;
      padding: 16px;
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

    .operation-column-container {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .user {
      .avatar {
        width: 40px;
        height: 40px;
        border-radius: 6px;
      }

      > div {
        margin-left: 10px;

        .user-name {
          font-weight: 500;
          color: var(--art-text-gray-800);
        }
      }
    }
  }

  .status-hint {
    margin-left: 8px;
    font-size: 12px;
    color: #909399;
  }
</style>
