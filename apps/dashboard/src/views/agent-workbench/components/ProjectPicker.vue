<script setup lang="ts">
  /**
   * ProjectPicker.vue —— workbench 顶栏的项目切换下拉。
   *
   * 解决用户场景:xjh(普通用户)登录后,在 Agent 工作台点「新建会话」报
   * "no project selected"。根因:user.lastProjectId 未绑定或需要切换。
   *
   * 行为:
   *   1. 挂载时调 listProjects() 拿到当前用户可见的全部项目;
   *      同时从 useUserStore().info.lastProjectId 拿当前已绑定项。
   *   2. 用 ElDropdown 渲染下拉,点击切换 → bindProject(id) → 同步
   *      userStore.info.lastProjectId → emit('change', project) 让 AppShell
   *      重新加载会话列表(会话是按 projectId 上下文绑定的)。
   *   3. 没项目时显示 ElEmpty 引导,并提示「请联系团队 OWNER 把你加入团队
   *      或创建项目」。
   *
   * 后端契约:
   *   - GET /api/projects          → { projects: ProjectItem[] }
   *   - POST /api/projects/[id]/bind → { ok: true, lastProjectId }
   *   - GET /api/auth/me           → { ..., lastProjectId }
   */
  import { computed, onMounted, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import { Folder, ArrowDown } from '@element-plus/icons-vue'
  import { useUserStore } from '@/store/modules/user'
  import {
    listProjects,
    bindProject,
    type ProjectItem
  } from '@/api/projects'

  const emit = defineEmits<{
    /** 项目切换后通知父组件,父组件可重新加载会话列表等 */
    change: [project: ProjectItem]
  }>()

  const userStore = useUserStore()

  const projects = ref<ProjectItem[]>([])
  const loading = ref(false)
  const switching = ref(false)

  /** 当前已绑定项目 id,从 userStore 读(避免本地状态与 store 不同步) */
  const currentProjectId = computed<string | null>(() => {
    const v = (userStore.info ?? {}) as { lastProjectId?: string | null }
    return v.lastProjectId ?? null
  })

  /** 当前项目对象(从列表里查),用于显示 name + rootPath */
  const currentProject = computed<ProjectItem | null>(() => {
    if (!currentProjectId.value) return null
    return projects.value.find((p) => p.id === currentProjectId.value) ?? null
  })

  /** 当前显示名:有项目就显项目名,否则提示「未选择项目」 */
  const displayName = computed<string>(() => {
    return currentProject.value?.name ?? '未选择项目'
  })

  /** 是否"已绑定但项目不存在"(罕见:用户被移出团队后 lastProjectId 还在) */
  const isStale = computed<boolean>(() => {
    return !!currentProjectId.value && !currentProject.value
  })

  onMounted(async () => {
    await loadProjects()
  })

  async function loadProjects(): Promise<void> {
    loading.value = true
    try {
      projects.value = await listProjects()
    } catch (e) {
      console.error('[ProjectPicker] 加载项目列表失败', e)
      // 不弹 ElMessage,避免 workbench 一加载就报错打扰用户;
      // 下拉点开时再显示空态。
      projects.value = []
    } finally {
      loading.value = false
    }
  }

  async function handleSwitch(project: ProjectItem): Promise<void> {
    if (switching.value) return
    if (project.id === currentProjectId.value) return
    switching.value = true
    try {
      await bindProject(project.id)
      // 乐观同步 userStore,让 UI 立即反映,不等下次 /api/auth/me
      userStore.info.lastProjectId = project.id
      ElMessage.success(`已切换到项目「${project.name}」`)
      emit('change', project)
    } catch (e: any) {
      console.error('[ProjectPicker] 切换项目失败', e)
      const msg = e?.message || e?.response?.data?.error || '切换项目失败'
      ElMessage.error(msg)
    } finally {
      switching.value = false
    }
  }
</script>

<template>
  <ElDropdown
    trigger="click"
    placement="bottom-start"
    :disabled="switching"
    @command="(cmd) => handleSwitch(cmd as ProjectItem)"
  >
    <div
      class="project-picker-trigger"
      :class="{ 'is-stale': isStale, 'is-empty': !currentProjectId }"
      :title="currentProject ? `${currentProject.name} · ${currentProject.rootPath}` : '未选择项目'"
    >
      <ElIcon class="pp-icon"><Folder /></ElIcon>
      <span class="pp-label">{{ displayName }}</span>
      <ElIcon class="pp-caret"><ArrowDown /></ElIcon>
    </div>

    <template #dropdown>
      <ElDropdownMenu class="project-picker-menu">
        <div v-if="loading" class="pp-loading">加载中…</div>

        <template v-else-if="projects.length === 0">
          <div class="pp-empty">
            <div class="pp-empty-title">暂无可用项目</div>
            <div class="pp-empty-hint">
              请联系团队 OWNER 把你加入团队,或由 OWNER/ADMIN 创建项目后你再切换。
            </div>
          </div>
        </template>

        <template v-else>
          <ElDropdownItem
            v-for="p in projects"
            :key="p.id"
            :command="p"
            :class="{ 'is-active': p.id === currentProjectId }"
          >
            <div class="pp-item">
              <div class="pp-item-name">{{ p.name }}</div>
              <div class="pp-item-path" :title="p.rootPath">{{ p.rootPath }}</div>
            </div>
          </ElDropdownItem>
        </template>
      </ElDropdownMenu>
    </template>
  </ElDropdown>
</template>

<style scoped>
  .project-picker-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--wb-border, #dcdfe6);
    border-radius: 6px;
    background: var(--wb-bg-elevated, #fff);
    color: var(--wb-text, #303133);
    cursor: pointer;
    user-select: none;
    transition: border-color 0.15s ease;
    max-width: 280px;
  }
  .project-picker-trigger:hover {
    border-color: var(--el-color-primary);
  }
  .project-picker-trigger.is-empty {
    color: var(--el-color-danger);
    border-color: var(--el-color-danger-light-5);
  }
  .project-picker-trigger.is-stale {
    color: var(--el-color-warning);
  }
  .pp-icon {
    flex: 0 0 auto;
    font-size: 14px;
  }
  .pp-label {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 500;
  }
  .pp-caret {
    flex: 0 0 auto;
    font-size: 12px;
    opacity: 0.6;
  }

  .project-picker-menu {
    min-width: 280px;
    max-width: 420px;
  }
  .pp-loading,
  .pp-empty {
    padding: 12px 16px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }
  .pp-empty-title {
    margin-bottom: 4px;
    color: var(--el-text-color-primary);
    font-weight: 500;
  }
  .pp-empty-hint {
    color: var(--el-text-color-secondary);
    line-height: 1.5;
  }
  .pp-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 0;
  }
  .pp-item-name {
    font-size: 13px;
    font-weight: 500;
  }
  .pp-item-path {
    font-size: 11px;
    color: var(--el-text-color-secondary);
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :deep(.el-dropdown-menu__item.is-active) {
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }
</style>
