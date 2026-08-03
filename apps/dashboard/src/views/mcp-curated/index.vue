<!--
  views/mcp-curated/index.vue

  MCP 精选库 (platform 治理层) 管理页

  - 左侧: 作用域过滤 (global/team/user) + 状态筛选
  - 右侧: 卡片视图 / 表格视图 切换
  - Drawer: 详情 / 编辑(新建) / Agent 绑定管理

  安全契约: configEnc 在任何响应中都不出现 (后端 stripConfig)。
  权限: 仅 platform_admin / 持有 mcp:* 权限码可写; 普通用户只读。
-->
<template>
  <div class="mcp-page">
    <div class="page-header">
      <h2>MCP 精选库</h2>
      <div class="header-actions">
        <el-input
          v-model="keyword"
          placeholder="搜索名称"
          style="width: 220px"
          clearable
          :prefix-icon="Search"
        />
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="card"><el-icon><Grid /></el-icon></el-radio-button>
          <el-radio-button value="table"><el-icon><List /></el-icon></el-radio-button>
        </el-radio-group>
        <el-button @click="reload" :icon="Refresh">刷新</el-button>
        <el-button v-if="canEdit" type="primary" @click="onCreate" :icon="Plus">新增</el-button>
      </div>
    </div>

    <!-- 权限不足提示: 让用户明确是账号权限问题而非 bug -->
    <el-alert
      v-if="!canEdit"
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
    >
      当前账号无 MCP 管理权限(新增/编辑/删除/绑定按钮已隐藏)。
      请使用平台管理员账号(root/admin)登录后操作。
    </el-alert>

    <el-row :gutter="16" class="page-body">
      <!-- 左侧作用域过滤 -->
      <el-col :span="4">
        <el-card shadow="never" class="cat-card">
          <template #header><span>作用域</span></template>
          <div
            v-for="s in scopeTabs"
            :key="s.value"
            class="cat-item"
            :class="{ active: scopeFilter === s.value }"
            @click="toggleScope(s.value)"
          >
            <span class="cat-name">
              <el-icon class="cat-icon"><component :is="s.icon" /></el-icon>
              {{ s.label }}
            </span>
            <el-tag size="small" round>{{ scopeCount(s.value) }}</el-tag>
          </div>
        </el-card>

        <el-card shadow="never" class="cat-card" style="margin-top: 12px">
          <template #header><span>筛选</span></template>
          <el-checkbox :model-value="includeDisabled" @change="onToggleDisabled">
            含已停用
          </el-checkbox>
        </el-card>

        <el-card shadow="never" class="cat-card" style="margin-top: 12px">
          <template #header><span>统计</span></template>
          <div class="stat-row">
            <span>启用</span>
            <el-tag type="success" size="small">{{ stats.enabled }}</el-tag>
          </div>
          <div class="stat-row">
            <span>停用</span>
            <el-tag type="info" size="small">{{ stats.disabled }}</el-tag>
          </div>
          <div class="stat-row">
            <span>带凭证</span>
            <el-tag type="warning" size="small">{{ stats.withCred }}</el-tag>
          </div>
        </el-card>
      </el-col>

      <!-- 右侧列表 -->
      <el-col :span="20">
        <!-- 卡片视图 -->
        <div v-if="viewMode === 'card'" v-loading="loading" class="card-grid">
          <el-card
            v-for="s in pagedServers"
            :key="s.id"
            shadow="hover"
            class="mcp-card"
            :class="{ disabled: !s.enabled }"
            @click="onView(s)"
          >
            <div class="card-head">
              <el-icon class="card-icon"><component :is="transportIcon(s.transport)" /></el-icon>
              <div class="card-titles">
                <div class="card-title">
                  {{ s.name }}
                  <el-tag v-if="!s.enabled" type="info" size="small">停用</el-tag>
                </div>
                <div class="card-sub">{{ transportLabel(s.transport) }}</div>
              </div>
              <el-tag size="small" effect="plain" :type="scopeTagType(s.scope)">
                {{ scopeLabel(s.scope) }}
              </el-tag>
            </div>
            <div class="card-addr mono">
              {{ s.transport === 'stdio' ? s.command : s.endpoint || '—' }}
            </div>
            <div class="card-footer">
              <span class="card-meta">{{ s.id }}</span>
            </div>
          </el-card>
          <el-empty v-if="!loading && filtered.length === 0" description="暂无 MCP 服务器" />
        </div>

        <!-- 表格视图 -->
        <el-table v-else :data="pagedServers" v-loading="loading" @row-click="(row: McpServer) => onView(row)">
          <el-table-column prop="name" label="名称" min-width="160">
            <template #default="{ row }">
              <span>{{ row.name }}</span>
              <el-tag v-if="!row.enabled" type="info" size="small" style="margin-left: 6px">停用</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="transport" label="协议" width="90">
            <template #default="{ row }">{{ transportLabel(row.transport) }}</template>
          </el-table-column>
          <el-table-column label="地址 / 命令" min-width="240">
            <template #default="{ row }">
              <code class="mono ellipsis">{{
                row.transport === 'stdio' ? row.command : row.endpoint || '—'
              }}</code>
            </template>
          </el-table-column>
          <el-table-column prop="scope" label="作用域" width="100">
            <template #default="{ row }">
              <el-tag size="small" effect="plain" :type="scopeTagType(row.scope)">
                {{ scopeLabel(row.scope) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
                {{ row.enabled ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="canEdit" label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <el-button link size="small" @click.stop="onEdit(row as McpServer)">编辑</el-button>
              <el-button link size="small" @click.stop="onBind(row as McpServer)">绑定</el-button>
              <el-button link size="small" @click.stop="onToggle(row as McpServer)">
                {{ (row as McpServer).enabled ? '停用' : '启用' }}
              </el-button>
              <el-button link size="small" type="danger" @click.stop="onDelete(row as McpServer)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          v-if="filtered.length > pageSize"
          v-model:current-page="currentPage"
          :page-size="pageSize"
          :total="filtered.length"
          layout="prev, pager, next, total"
          style="margin-top: 16px; justify-content: flex-end; display: flex"
        />
      </el-col>
    </el-row>

    <!-- 详情 / 编辑 / 绑定 Drawer -->
    <el-drawer
      v-model="drawerOpen"
      :title="drawerTitle"
      size="56%"
      :close-on-click-modal="drawerMode === 'view'"
      destroy-on-close
    >
      <McpBindings
        v-if="drawerMode === 'bind' && current"
        :server="current"
        :can-edit="canEdit"
        @saved="onBindingsSaved"
        @cancel="drawerOpen = false"
      />
      <McpEditor
        v-else-if="drawerMode === 'edit'"
        :entry="current"
        :readonly="!canEdit"
        @saved="onSaved"
        @cancel="drawerOpen = false"
      />
      <McpDetail
        v-else-if="drawerMode === 'view' && current"
        :entry="current"
        :readonly="!canEdit"
        @edit="() => current && startEdit(current)"
      />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, onMounted, watch } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import {
    Grid,
    List,
    Refresh,
    Plus,
    Search,
    Connection,
    Promotion,
    Link,
    Place,
    User,
    OfficeBuilding
  } from '@element-plus/icons-vue'
  import {
    listMcpServers,
    updateMcpServer,
    deleteMcpServer,
    type McpServer,
    type McpTransport,
    type McpScope
  } from '@/api/mcp'
  import { useUserStore } from '@/store/modules/user'
  import McpEditor from './modules/McpEditor.vue'
  import McpDetail from './modules/McpDetail.vue'
  import McpBindings from './modules/McpBindings.vue'

  const userStore = useUserStore()
  // 可写: 与后端 assertPlatformAdmin 对齐,platform:access 是后端实际放行权限;
  // 其次校验细粒度 mcp:* 写权限码;最后角色兜底(与 skill-curated 一致)。
  const canEdit = computed(() => {
    if (userStore.hasPermission('platform:access')) return true
    if (userStore.hasAnyPermission('mcp:create', 'mcp:edit', 'mcp:delete', 'mcp:bind')) {
      return true
    }
    const codes = (userStore.roles ?? []).map((r) => r.code)
    return codes.includes('platform_admin') || codes.includes('team_owner') || codes.includes('OWNER')
  })

  const servers = ref<McpServer[]>([])
  const loading = ref(false)
  const viewMode = ref<'card' | 'table'>('table')
  const scopeFilter = ref<McpScope | ''>('')
  const includeDisabled = ref(true)
  const keyword = ref('')
  const pageSize = 24
  const currentPage = ref(1)

  // Drawer 状态
  const drawerOpen = ref(false)
  const drawerMode = ref<'view' | 'edit' | 'bind'>('view')
  const drawerTitle = ref('')
  const current = ref<McpServer | null>(null)

  const scopeTabs = [
    { value: 'global' as const, label: '全局', icon: Place },
    { value: 'team' as const, label: '团队', icon: OfficeBuilding },
    { value: 'user' as const, label: '个人', icon: User }
  ]

  // 客户端过滤: 作用域 + 关键词 + 启用状态
  const filtered = computed(() => {
    let list = servers.value
    if (scopeFilter.value) list = list.filter((s) => s.scope === scopeFilter.value)
    if (!includeDisabled.value) list = list.filter((s) => s.enabled)
    const kw = keyword.value.trim().toLowerCase()
    if (kw) list = list.filter((s) => s.name.toLowerCase().includes(kw))
    return list
  })

  // 客户端分页: filtered 的当前页切片 (后端 /api/admin/mcp 一次返回全部)
  const pagedServers = computed(() => {
    const start = (currentPage.value - 1) * pageSize
    return filtered.value.slice(start, start + pageSize)
  })

  // 过滤条件变化时回到首页,避免停在越界页
  watch([keyword, scopeFilter, includeDisabled], () => {
    currentPage.value = 1
  })

  const stats = computed(() => {
    let enabled = 0
    let disabled = 0
    let withCred = 0
    for (const s of servers.value) {
      if (s.enabled) enabled++
      else disabled++
      // configEnc 不回传,带凭证与否需另议;这里统计 scope 可携带凭证的项
      if (s.scope !== 'global') withCred++
    }
    return { enabled, disabled, withCred }
  })

  function scopeCount(scope: McpScope): number {
    return servers.value.filter((s) => s.scope === scope).length
  }

  function toggleScope(s: McpScope) {
    scopeFilter.value = scopeFilter.value === s ? '' : s
  }

  function onToggleDisabled(v: unknown) {
    includeDisabled.value = Boolean(v)
  }

  // ---- labels & icons ----
  function transportLabel(t: McpTransport): string {
    return { stdio: 'stdio', sse: 'sse', http: 'http' }[t] ?? t
  }
  function transportIcon(t: McpTransport) {
    return { stdio: Connection, sse: Promotion, http: Link }[t] ?? Connection
  }
  function scopeLabel(s: McpScope): string {
    return { global: '全局', team: '团队', user: '个人' }[s] ?? s
  }
  function scopeTagType(s: McpScope) {
    return s === 'global' ? 'warning' : s === 'team' ? 'primary' : 'info'
  }

  // ---- data ----
  async function reload() {
    loading.value = true
    try {
      servers.value = await listMcpServers()
    } catch (e) {
      ElMessage.error('加载失败: ' + (e as Error).message)
    } finally {
      loading.value = false
    }
  }

  // ---- drawer actions ----
  function openDrawer(mode: 'view' | 'edit' | 'bind', title: string, entry: McpServer | null) {
    drawerMode.value = mode
    drawerTitle.value = title
    current.value = entry
    drawerOpen.value = true
  }

  function onView(s: McpServer) {
    openDrawer('view', 'MCP 详情', s)
  }
  function startEdit(s: McpServer) {
    openDrawer('edit', '编辑 MCP', s)
  }
  function onEdit(s: McpServer) {
    openDrawer('edit', '编辑 MCP', s)
  }
  function onCreate() {
    openDrawer('edit', '新增 MCP 服务器', null)
  }
  function onBind(s: McpServer) {
    openDrawer('bind', `Agent 绑定 · ${s.name}`, s)
  }

  async function onToggle(s: McpServer) {
    try {
      await updateMcpServer(s.id, { enabled: !s.enabled })
      ElMessage.success(s.enabled ? '已停用' : '已启用')
      reload()
    } catch (e) {
      ElMessage.error('操作失败: ' + (e as Error).message)
    }
  }

  async function onDelete(s: McpServer) {
    try {
      await ElMessageBox.confirm(
        `确认删除 MCP 服务器「${s.name}」?将级联清理其全部 Agent 绑定,不可恢复。`,
        '确认删除',
        { type: 'warning' }
      )
      await deleteMcpServer(s.id)
      ElMessage.success('已删除')
      reload()
    } catch (e) {
      if (e !== 'cancel') ElMessage.error('删除失败: ' + (e as Error).message)
    }
  }

  function onSaved() {
    drawerOpen.value = false
    reload()
  }

  function onBindingsSaved() {
    drawerOpen.value = false
    ElMessage.success('绑定已更新')
  }

  onMounted(reload)
</script>

<style scoped>
  .mcp-page {
    padding: 20px;
  }
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .page-header h2 {
    margin: 0;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cat-card :deep(.el-card__body) {
    padding: 8px;
  }
  .cat-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 14px;
  }
  .cat-item:hover {
    background: var(--el-fill-color-light);
  }
  .cat-item.active {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
  }
  .cat-name {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .cat-icon {
    font-size: 14px;
  }
  .stat-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    font-size: 13px;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
  }
  .mcp-card {
    cursor: pointer;
    transition: transform 0.15s;
  }
  .mcp-card:hover {
    transform: translateY(-2px);
  }
  .mcp-card.disabled {
    opacity: 0.55;
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .card-icon {
    font-size: 22px;
    color: var(--el-color-primary);
  }
  .card-titles {
    flex: 1;
    min-width: 0;
  }
  .card-title {
    font-weight: 600;
    font-size: 15px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .card-sub {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  .card-addr {
    font-size: 12px;
    color: var(--el-text-color-regular);
    background: var(--el-fill-color-light);
    padding: 6px 8px;
    border-radius: 4px;
    word-break: break-all;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .card-footer {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--el-border-color-lighter);
  }
  .card-meta {
    font-size: 11px;
    color: var(--el-text-color-secondary);
    font-family: monospace;
  }

  .mono {
    font-family: monospace;
  }
  .ellipsis {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
  }
</style>
