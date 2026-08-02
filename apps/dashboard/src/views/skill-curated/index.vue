<!--
  views/skill-curated/index.vue

  技能精选库 (platform 治理层) 管理页

  - 左侧: 分类过滤 + 操作按钮
  - 右侧: 卡片视图 / 表格视图 切换
  - Drawer: 编辑/新建 entry 详情

  设计: openspec/changes/skill-curated-library/design.md §4 (UI)
  对齐: tf-soc-agent/frontend-vue SkillMarketplace.vue 的 view-toggle + drawer 模式
-->
<template>
  <div class="curated-page">
    <div class="page-header">
      <h2>技能精选库</h2>
      <div class="header-actions">
        <el-input
          v-model="filters.q"
          placeholder="搜索名称/slug/描述"
          style="width: 240px"
          clearable
          @keydown.enter="reload"
          @clear="reload"
        />
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="card"
            ><el-icon><Grid /></el-icon
          ></el-radio-button>
          <el-radio-button value="table"
            ><el-icon><List /></el-icon
          ></el-radio-button>
        </el-radio-group>
        <el-button @click="reload" :icon="Refresh">刷新</el-button>
        <el-button v-if="canEdit" @click="onSeed" :loading="seeding" :icon="MagicStick">
          从内置目录导入
        </el-button>
        <el-button v-if="canEdit" type="primary" @click="onCreate" :icon="Plus">新增</el-button>
      </div>
    </div>

    <el-row :gutter="16" class="page-body">
      <!-- 左侧分类 -->
      <el-col :span="4">
        <el-card shadow="never" class="cat-card">
          <template #header><span>分类</span></template>
          <div
            v-for="c in categories"
            :key="c.category"
            class="cat-item"
            :class="{ active: filters.category === c.category }"
            @click="toggleCategory(c.category)"
          >
            <span class="cat-name">{{ categoryLabel(c.category) }}</span>
            <el-tag size="small" round>{{ c.count }}</el-tag>
          </div>
          <div class="cat-item" :class="{ active: !filters.category }" @click="clearCategory">
            <span class="cat-name">全部</span>
          </div>
        </el-card>

        <el-card v-if="canEdit" shadow="never" class="cat-card" style="margin-top: 12px">
          <template #header><span>筛选</span></template>
          <el-checkbox v-model="filters.featured" @change="reload">仅精选</el-checkbox>
          <br />
          <el-checkbox :model-value="filters.enabled === false" @change="onToggleDisabledFilter">
            含已停用
          </el-checkbox>
        </el-card>
      </el-col>

      <!-- 右侧列表 -->
      <el-col :span="20">
        <!-- 卡片视图 -->
        <div v-if="viewMode === 'card'" v-loading="loading" class="card-grid">
          <el-card
            v-for="e in entries"
            :key="e.id"
            shadow="hover"
            class="skill-card"
            :class="{ disabled: !e.enabled }"
            @click="onView(e)"
          >
            <div class="card-head">
              <el-icon class="card-icon"><component :is="iconComponent(e.icon)" /></el-icon>
              <div class="card-titles">
                <div class="card-title">
                  {{ e.name }}
                  <el-tag v-if="e.featured" type="warning" size="small">精选</el-tag>
                  <el-tag v-if="!e.enabled" type="info" size="small">停用</el-tag>
                </div>
                <div class="card-slug">{{ e.slug }}</div>
              </div>
            </div>
            <div class="card-desc">{{ e.summary || e.description || '—' }}</div>
            <div class="card-tags">
              <el-tag v-for="t in e.tags" :key="t" size="small" effect="plain">{{ t }}</el-tag>
            </div>
            <div class="card-footer">
              <span class="card-meta">{{ categoryLabel(e.category) }}</span>
              <span class="card-meta">v{{ e.version }}</span>
              <span class="card-meta">安装 {{ e.installCount }}</span>
            </div>
          </el-card>
          <el-empty v-if="!loading && entries.length === 0" description="暂无精选技能" />
        </div>

        <!-- 表格视图 -->
        <el-table
          v-else
          :data="entries"
          v-loading="loading"
          @row-click="(row: CuratedSkillMeta) => onView(row)"
        >
          <el-table-column prop="name" label="名称" min-width="160">
            <template #default="{ row }">
              <span>{{ row.name }}</span>
              <el-tag v-if="row.featured" type="warning" size="small" style="margin-left: 6px"
                >精选</el-tag
              >
            </template>
          </el-table-column>
          <el-table-column prop="slug" label="Slug" width="180" />
          <el-table-column prop="category" label="分类" width="120">
            <template #default="{ row }">{{ categoryLabel(row.category) }}</template>
          </el-table-column>
          <el-table-column prop="tags" label="标签" min-width="160">
            <template #default="{ row }">
              <el-tag
                v-for="t in row.tags"
                :key="t"
                size="small"
                effect="plain"
                style="margin-right: 4px"
                >{{ t }}</el-tag
              >
            </template>
          </el-table-column>
          <el-table-column prop="version" label="版本" width="90" />
          <el-table-column prop="installCount" label="安装" width="80" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
                {{ row.enabled ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="canEdit" label="操作" width="160" fixed="right">
            <template #default="{ row }">
              <el-button link size="small" @click.stop="onEdit(row as CuratedSkillMeta)"
                >编辑</el-button
              >
              <el-button link size="small" @click.stop="onToggle(row as CuratedSkillMeta)">
                {{ (row as CuratedSkillMeta).enabled ? '停用' : '启用' }}
              </el-button>
              <el-button
                link
                size="small"
                type="danger"
                @click.stop="onDelete(row as CuratedSkillMeta)"
                >删除</el-button
              >
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          v-if="total > pageSize"
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next, total"
          style="margin-top: 16px; justify-content: flex-end; display: flex"
          @current-change="reload"
        />
      </el-col>
    </el-row>

    <!-- 详情/编辑 Drawer -->
    <el-drawer
      v-model="drawerOpen"
      :title="drawerTitle"
      size="60%"
      :close-on-click-modal="!editing"
      destroy-on-close
    >
      <CuratedEditor
        v-if="editing"
        :entry="editingEntry"
        :readonly="!canEdit"
        @saved="onSaved"
        @cancel="drawerOpen = false"
      />
      <CuratedDetail
        v-else-if="viewingEntry"
        :entry="viewingEntry"
        @edit="() => viewingEntry && startEdit(viewingEntry)"
      />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, computed, onMounted } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import {
    Grid,
    List,
    Refresh,
    Plus,
    MagicStick,
    Star,
    Cpu,
    Document,
    Tools
  } from '@element-plus/icons-vue'
  import {
    listCuratedSkills,
    listCuratedCategories,
    seedFromBuiltin,
    deleteCuratedSkill,
    updateCuratedSkill,
    type CuratedSkillMeta,
    type ListCuratedFilters,
    type CategoryCount
  } from '@/api/curated-skills'
  import { useUserStore } from '@/store/modules/user'
  import CuratedEditor from './modules/CuratedEditor.vue'
  import CuratedDetail from './modules/CuratedDetail.vue'

  const userStore = useUserStore()
  // platform_admin / team_owner 可编辑;普通 MEMBER 只读
  const canEdit = computed(() => {
    const codes = (userStore.roles ?? []).map((r) => r.code)
    return (
      codes.includes('platform_admin') || codes.includes('team_owner') || codes.includes('OWNER')
    )
  })

  const entries = ref<CuratedSkillMeta[]>([])
  const categories = ref<CategoryCount[]>([])
  const loading = ref(false)
  const seeding = ref(false)
  const total = ref(0)
  const page = ref(1)
  const pageSize = 24
  const viewMode = ref<'card' | 'table'>('card')

  const filters = reactive<ListCuratedFilters>({
    category: undefined,
    featured: undefined,
    enabled: true,
    q: ''
  })

  const drawerOpen = ref(false)
  const drawerTitle = ref('')
  const editing = ref(false)
  const editingEntry = ref<CuratedSkillMeta | null>(null)
  const viewingEntry = ref<CuratedSkillMeta | null>(null)

  const CATEGORY_LABELS: Record<string, string> = {
    general: '通用',
    development: '开发',
    security: '安全',
    ops: '运维',
    data: '数据',
    writing: '写作'
  }
  function categoryLabel(c: string): string {
    return CATEGORY_LABELS[c] ?? c
  }

  function iconComponent(icon: string) {
    const map: Record<string, unknown> = {
      star: Star,
      cpu: Cpu,
      code: Document,
      tool: Tools
    }
    return map[icon] ?? Star
  }

  async function reload() {
    loading.value = true
    try {
      const offset = (page.value - 1) * pageSize
      const [listRes, catRes] = await Promise.all([
        listCuratedSkills({ ...filters, limit: pageSize, offset }),
        listCuratedCategories()
      ])
      entries.value = listRes.entries
      total.value = listRes.total
      categories.value = catRes.categories
    } catch (e) {
      ElMessage.error('加载失败: ' + (e as Error).message)
    } finally {
      loading.value = false
    }
  }

  function toggleCategory(c: string) {
    filters.category = filters.category === c ? undefined : c
    page.value = 1
    reload()
  }

  function onToggleDisabledFilter(v: unknown) {
    filters.enabled = v ? false : true
    reload()
  }

  function clearCategory() {
    filters.category = undefined
    page.value = 1
    reload()
  }

  function onView(e: CuratedSkillMeta) {
    viewingEntry.value = e
    editing.value = false
    editingEntry.value = null
    drawerTitle.value = '技能详情'
    drawerOpen.value = true
  }

  function startEdit(e: CuratedSkillMeta) {
    editingEntry.value = e
    editing.value = true
    drawerTitle.value = '编辑技能'
  }

  function onEdit(e: CuratedSkillMeta) {
    editingEntry.value = e
    editing.value = true
    viewingEntry.value = null
    drawerTitle.value = '编辑技能'
    drawerOpen.value = true
  }

  function onCreate() {
    editingEntry.value = null
    editing.value = true
    viewingEntry.value = null
    drawerTitle.value = '新增精选技能'
    drawerOpen.value = true
  }

  async function onToggle(e: CuratedSkillMeta) {
    try {
      await updateCuratedSkill(e.id, { enabled: !e.enabled })
      ElMessage.success(e.enabled ? '已停用' : '已启用')
      reload()
    } catch (err) {
      ElMessage.error('操作失败: ' + (err as Error).message)
    }
  }

  async function onDelete(e: CuratedSkillMeta) {
    try {
      await ElMessageBox.confirm(`确认删除精选技能「${e.name}」?(软删,可恢复)`, '确认', {
        type: 'warning'
      })
      await deleteCuratedSkill(e.id)
      ElMessage.success('已删除')
      reload()
    } catch (err) {
      if (err !== 'cancel') {
        ElMessage.error('删除失败: ' + (err as Error).message)
      }
    }
  }

  async function onSeed() {
    try {
      await ElMessageBox.confirm(
        '将扫描内置技能目录 (<dashboard>/skills, ~/.pi/agent/skills, ~/.claude/skills),\n按 sourceFilePath 幂等导入。是否继续?',
        '从内置目录导入',
        { type: 'info' }
      )
      seeding.value = true
      const r = await seedFromBuiltin()
      ElMessage.success(
        `导入完成: 新增 ${r.created}, 更新 ${r.updated}, 跳过 ${r.skipped}, 共 ${r.total}`
      )
      reload()
    } catch (err) {
      if (err !== 'cancel') {
        ElMessage.error('导入失败: ' + (err as Error).message)
      }
    } finally {
      seeding.value = false
    }
  }

  function onSaved() {
    drawerOpen.value = false
    reload()
  }

  onMounted(reload)
</script>

<style scoped>
  .curated-page {
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
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }
  .skill-card {
    cursor: pointer;
    transition: transform 0.15s;
  }
  .skill-card:hover {
    transform: translateY(-2px);
  }
  .skill-card.disabled {
    opacity: 0.55;
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .card-icon {
    font-size: 24px;
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
  .card-slug {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  .card-desc {
    font-size: 13px;
    color: var(--el-text-color-regular);
    margin: 8px 0;
    min-height: 36px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-height: 24px;
  }
  .card-footer {
    display: flex;
    gap: 12px;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--el-border-color-lighter);
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
</style>
