<!--
  Agent 工作台主壳(三栏布局)

  集成:
  - 左侧: SessionSidebar(会话列表 + 搜索 + 重命名/置顶/删除)
  - 中间: TabBar(多会话 Tab 切换) + ChatWindow(消息流 + 输入框)
  - 右侧: ConfigPanel 抽屉(ModelsConfig / SkillsConfig / PluginsConfig)
         或 FileExplorer(文件浏览,available === true 才显示)

  等价 apps/web/components/AppShell.tsx(1073 行)的 Vue 端。
-->
<template>
  <div class="agent-workbench art-full-height">
    <!-- 项目切换顶栏:任何会话创建都依赖 user.lastProjectId,这里是必选入口。
         没项目时 ProjectPicker 会显示空态引导,避免用户点「新建会话」才报错。 -->
    <div class="wb-project-bar">
      <ProjectPicker @change="handleProjectChange" />
      <div class="wb-project-bar-spacer" />
    </div>

    <div class="workbench-card">
      <!-- 左侧: 会话列表 -->
      <aside class="wb-session-list">
        <SessionSidebar
          :current-session-id="currentSessionId"
          @select="handleSelect"
          @rename="handleRename"
          @pin="handlePin"
          @delete="handleDelete"
        />
      </aside>

      <!-- 中间: Tab 栏 + 聊天窗口 -->
      <main class="wb-chat-area">
        <TabBar
          v-if="tabs.length > 0"
          :tabs="tabs"
          :active-tab-id="currentSessionId ?? ''"
          @select="handleSelect"
          @close="handleTabClose"
        />

        <!-- 未选会话:空态;已选:挂 ChatWindow,key 强制重建避免消息残留 -->
        <ChatWindow
          v-if="currentSessionId"
          :key="currentSessionId"
          :session-id="currentSessionId"
          @edit="onEditMessage"
          @auto-rename="handleAutoRename"
        >
          <template
            #input="{ sendMessage, abort, isStreaming: streaming, queueItems, cancelQueue }"
          >
            <ChatInput
              ref="chatInputRef"
              :session-id="currentSessionId"
              :is-streaming="streaming"
              :sound-enabled="soundEnabled"
              :compact-enabled="true"
              :is-compacting="isCompacting"
              :compact-error="compactError"
              @send="(text, attachments) => void sendMessage(text, attachments)"
              @abort="abort"
              @compact="handleCompact"
              @abort-compact="handleAbortCompaction"
              @update:sound-enabled="(v: boolean) => { soundEnabled = v }"
            >
              <template #queue>
                <StreamingQueueBar
                  :items="queueItems"
                  :is-streaming="streaming"
                  @recall="(id) => void cancelQueue(id)"
                />
              </template>
            </ChatInput>
          </template>
        </ChatWindow>
        <div v-else class="wb-empty">
          <el-empty description="选择左侧会话以开始聊天,或点击「新建」" />
        </div>
      </main>

      <!-- 右侧: 抽屉(配置面板或文件浏览器) -->
      <aside v-if="activePanel !== 'none'" class="wb-config-drawer">
        <div class="wb-drawer-header">
          <span>{{ panelLabel }}</span>
          <el-button text size="small" @click="activePanel = 'none'">关闭</el-button>
        </div>
        <ModelsConfig
          v-if="activePanel === 'models'"
          :session-id="currentSessionId ?? undefined"
          @close="activePanel = 'none'"
        />
        <SkillsConfig
          v-else-if="activePanel === 'skills'"
          :session-id="currentSessionId ?? undefined"
          @close="activePanel = 'none'"
        />
        <PluginsConfig
          v-else-if="activePanel === 'plugins'"
          :session-id="currentSessionId ?? undefined"
          @close="activePanel = 'none'"
        />
        <FileExplorer
          v-else-if="activePanel === 'files'"
          :session-id="currentSessionId ?? ''"
          @file-open="handleFileOpen"
          @file-changed="handleFileChanged"
        />
      </aside>
    </div>

    <!-- 顶栏(简化):只放切换按钮 -->
    <div v-if="showToolbar" class="wb-toolbar">
      <el-button-group>
        <el-button
          :type="activePanel === 'files' ? 'primary' : 'default'"
          @click="togglePanel('files')"
        >
          <el-icon><Folder /></el-icon>文件
        </el-button>
        <el-button
          :type="activePanel === 'models' ? 'primary' : 'default'"
          @click="togglePanel('models')"
        >
          模型
        </el-button>
        <el-button
          :type="activePanel === 'skills' ? 'primary' : 'default'"
          @click="togglePanel('skills')"
        >
          技能
        </el-button>
        <el-button
          :type="activePanel === 'plugins' ? 'primary' : 'default'"
          @click="togglePanel('plugins')"
        >
          插件
        </el-button>
      </el-button-group>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, onMounted, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import { Folder } from '@element-plus/icons-vue'

  import SessionSidebar from './components/SessionSidebar.vue'
  import TabBar from './components/TabBar.vue'
  import ChatWindow from './components/ChatWindow.vue'
  import ChatInput from './components/ChatInput.vue'
  import StreamingQueueBar from './components/StreamingQueueBar.vue'
  import ModelsConfig from './components/ModelsConfig.vue'
  import SkillsConfig from './components/SkillsConfig.vue'
  import PluginsConfig from './components/PluginsConfig.vue'
  import FileExplorer from './components/FileExplorer.vue'
  import ProjectPicker from './components/ProjectPicker.vue'
  import type { ProjectItem } from '@/api/projects'

  import type { ConfigPanelKey, WorkbenchTab } from './types'
  import { useSessionList } from './composables/useSessionList'
  import { useAudio } from './composables/useAudio'
  import { resolveTabTitle as resolveTabTitlePure } from './composables/useTabTitles'

  // ============================================================================
  // 状态
  // ============================================================================

  const currentSessionId = ref<string | null>(null)
  const activePanel = ref<ConfigPanelKey>('none')
  const tabs = ref<WorkbenchTab[]>([])
  const showToolbar = ref(true)

  // ChatInput 实例引用:用于「编辑」按钮把消息内容回填到输入框。
  // ChatInput 通过 ChatWindow 的 slot 注入,这里用 ref 捕获其 defineExpose 的 fill()。
  const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null)

  /** MessageView「编辑」按钮回调:把被编辑的用户消息内容灌回输入框(对齐 apps/web)。 */
  function onEditMessage(_entryId: string | undefined, content: string): void {
    chatInputRef.value?.fill(content)
  }

  // ============================================================================
  // 完成提示音 + 上下文压缩(由 AppShell 统一维护,跨会话保留)
  // ============================================================================

  /** Sound 是用户偏好,不是 session 状态 —— 在 AppShell 里维护一次。 */
  const { soundEnabled } = useAudio()

  /** Compact 由 AppShell 统一状态驱动。后端 API (/api/sessions/:id/compact)
   * 尚未在 dashboard 端实现,现在仅占位接”事件 —— 未来只需将这些函数换为
   * 具体 fetch 调用即可,组件不变。 */
  const isCompacting = ref(false)
  const compactError = ref<string | null>(null)

  function handleCompact(): void {
    if (!currentSessionId.value) return
    if (isCompacting.value) return
    isCompacting.value = true
    compactError.value = null
    // TODO: 调后端 compact API;现在用一个 setTimeout 模拟成功
    void window.setTimeout(() => {
      isCompacting.value = false
      if (Math.random() < 0.05) {
        compactError.value = '压缩失败(仅占位错误,后端未接入)'
      }
    }, 1500)
  }

  function handleAbortCompaction(): void {
    isCompacting.value = false
    // TODO: 调后端 abort compact
  }

  // Bug 3 修复:刷新后恢复。会话列表由 useSessionList 管理(load 自动从后端拉);
  // currentSessionId 持久化到 localStorage,刷新时若后端还有这个 session 就恢复选中。
  const sessionList = useSessionList()

  const LAST_SESSION_KEY = 'wb:lastSessionId'

  function readLastSessionId(): string | null {
    try {
      return localStorage.getItem(LAST_SESSION_KEY)
    } catch {
      return null
    }
  }

  function writeLastSessionId(id: string | null): void {
    try {
      if (id) localStorage.setItem(LAST_SESSION_KEY, id)
      else localStorage.removeItem(LAST_SESSION_KEY)
    } catch {
      /* 隐私模式 / quota 异常时静默 */
    }
  }

  // 写回 currentSessionId 到 localStorage(任何变化)
  watch(currentSessionId, (id) => {
    writeLastSessionId(id)
  })

  /**
   * 跟随后端 title 同步到 tab。
   * 触发点:
   *   - 初次 load() 后,到 backend 拿回 title(默认 “新会话”),此时乐观会话从
   *     “会话 xxxxxx” 刷新为 “新会话”。
   *   - auto-rename 后,后端 renameSession 同步 title 到列表,这里被 watch 捕获。
   *   - 用户在侧栏手动重命名(renameSession 后也会到列表)。
   */
  watch(
    () => sessionList.sessions.value,
    (list) => {
      for (const tab of tabs.value) {
        const session = list.find((s) => s.id === tab.sessionId)
        if (!session) continue
        const next = session.title?.trim()
        if (next && next !== tab.title && next !== '新会话') {
          tab.title = next
        } else if (next === '新会话' && tab.title !== '新会话') {
          tab.title = '新会话'
        }
      }
    },
    { deep: true }
  )

  // 挂载时:1) 拉会话列表(独立实例,仅读;SessionSidebar 自己的实例负责侧栏共享状态)
  // 2) 尝试恢复 lastSessionId
  //
  // 为什么不在 sessions.value 里 find(lastId) 才恢复?
  //   乐观 push 的会话(从未发过消息)在后端 listSessions 中不存在,严格 find
  //   会跳过这些会话。但用户认为"刷新前选了它,刷新后还应该选中它"。所以
  //   改为:只要 localStorage 有 lastSessionId,就直接 handleSelect —— 后端查不到
  //   也无妨,useAgentSession 的 fetchHistory 会返回空数组,UI 显示空态。
  onMounted(async () => {
    await sessionList.load(true)
    const last = readLastSessionId()
    if (last) {
      handleSelect(last)
    }
  })

  const panelLabel = computed(() => {
    switch (activePanel.value) {
      case 'files':
        return '文件浏览器'
      case 'models':
        return '模型配置'
      case 'skills':
        return '技能配置'
      case 'plugins':
        return '插件配置'
      default:
        return ''
    }
  })

  // ============================================================================
  // 会话操作
  // ============================================================================

  /**
   * 生成 tab 的友好显示名。委托给 composables/useTabTitles 的纯函数 —
   * 可单测,避免在 AppShell 中重复逻辑。
   * (1) 后端已重命名 → 用 backend title
   * (2) 后端返回“默认新会话”→ 用“新会话”
   * (3) 后端未拉到(乐观会话)→ 用 “会话 {id 前缀}” 兑底
   */
  function resolveTabTitle(sessionId: string): string {
    return resolveTabTitlePure(sessionId, sessionList.sessions.value)
  }

  function handleSelect(sessionId: string): void {
    currentSessionId.value = sessionId
    // 加入 Tab(若尚未存在)
    if (!tabs.value.find((t) => t.sessionId === sessionId)) {
      tabs.value.push({
        id: sessionId,
        sessionId,
        title: resolveTabTitle(sessionId),
        active: true
      })
    } else {
      tabs.value = tabs.value.map((t) =>
        t.sessionId === sessionId ? { ...t, active: true } : t
      )
      // 已存在的 tab:可能后端 title 同步过来了,顺便刷新一下
      syncTabTitleFromList(sessionId)
    }
  }

  function handleRename(sessionId: string, newTitle: string): void {
    tabs.value = tabs.value.map((t) => (t.sessionId === sessionId ? { ...t, title: newTitle } : t))
  }

  /**
   * 从 sessionList 读后端 title 并同步到 tab。常用于:
   *   - 会话列表 load 后,刚开的 tab 从“会话 xxxxxx”转成“提问内容”
   *   - auto-rename 后后端写回 title,tab 跟着变
   */
  function syncTabTitleFromList(sessionId: string): void {
    const tab = tabs.value.find((t) => t.sessionId === sessionId)
    if (!tab) return
    const next = resolveTabTitle(sessionId)
    if (tab.title !== next) {
      tabs.value = tabs.value.map((t) => (t.sessionId === sessionId ? { ...t, title: next } : t))
    }
  }

  /**
   * ChatWindow 检测到第一条 user 消息后 emit 的 auto-rename:
   *   1) 乐观同步 tab.title(让用户立刻看到友好名字,不用等 round-trip)
   *   2) 后台调 renameSession 写后端
   *   3) 同步 sessionList.sessions 里的 title,让侧栏同步
   *   4) watch 也会额外跟随后端返回,作为二重保障
   */
  async function handleAutoRename(
    sessionId: string,
    suggestedTitle: string
  ): Promise<void> {
    const trimmed = suggestedTitle.trim()
    if (!trimmed) return
    // 1) tab 乐观更新
    handleRename(sessionId, trimmed)
    // 2) 同步 sessionList 本地(title),让侧栏立即反映
    const idx = sessionList.sessions.value.findIndex((s) => s.id === sessionId)
    if (idx >= 0) {
      sessionList.sessions.value = sessionList.sessions.value.map((s) =>
        s.id === sessionId ? { ...s, title: trimmed } : s
      )
    }
    // 3) 后端 rename
    try {
      await sessionList.rename(sessionId, trimmed)
    } catch (e) {
      console.warn('[AppShell] auto-rename 失败', e)
    }
  }

  function handlePin(sessionId: string, pinned: boolean): void {
    // 顶栏/侧栏的 pinned 状态由 SessionSidebar 自己维护。
    // 保留 emits 接口让 SessionSidebar 的事件能向上冒泡。
    void sessionId
    void pinned
  }

  function handleDelete(sessionId: string): void {
    tabs.value = tabs.value.filter((t) => t.sessionId !== sessionId)
    if (currentSessionId.value === sessionId) {
      currentSessionId.value = tabs.value[0]?.sessionId ?? null
    }
  }

  function handleTabClose(tabId: string): void {
    const tab = tabs.value.find((t) => t.id === tabId)
    if (!tab) return
    tabs.value = tabs.value.filter((t) => t.id !== tabId)
    if (currentSessionId.value === tab.sessionId) {
      currentSessionId.value = tabs.value[0]?.sessionId ?? null
    }
  }

  // ============================================================================
  // 抽屉面板
  // ============================================================================

  function togglePanel(panel: ConfigPanelKey): void {
    activePanel.value = activePanel.value === panel ? 'none' : panel
  }

  // ============================================================================
  // 文件操作(占位 — FileViewer 完整集成留给后续 Task #56)
  // ============================================================================

  function handleFileOpen(path: string): void {
    ElMessage.info(`打开文件: ${path}`)
  }

  function handleFileChanged(path: string): void {
    ElMessage.info(`文件已变更: ${path}`)
  }

  // ============================================================================
  // 项目切换
  // ============================================================================

  /**
   * ProjectPicker 切换项目后回调。
   *
   * 会话是项目上下文绑定的(后端 agent/new 用 user.lastProjectId 解析 cwd),
   * 切项目后旧的 tab/session 已经不属于当前项目,需:
   *   1. 清空当前 tab + currentSessionId(避免用户误以为旧会话还在新项目下)
   *   2. 重新拉取会话列表(sessionList.load()) —— 后端会返回新项目下的会话
   */
  async function handleProjectChange(_project: ProjectItem): Promise<void> {
    tabs.value = []
    currentSessionId.value = null
    writeLastSessionId(null)
    await sessionList.load(true)
  }
</script>

<style scoped>
  /* 让顶栏(project bar) + workbench-card 上下堆叠。
     workbench.css 里 .agent-workbench 默认是 row flex,这里覆盖为 column
     以容纳项目切换顶栏。 */
  .agent-workbench {
    flex-direction: column;
  }
  .wb-project-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    padding: var(--wb-pad-sm, 6px) var(--wb-pad-md, 12px);
    border-bottom: 1px solid var(--wb-border, #e4e7ed);
    background: var(--wb-bg-elevated, #fff);
  }
  .wb-project-bar-spacer {
    flex: 1 1 auto;
  }
  .wb-empty {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }
  .wb-drawer-header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--wb-pad-md);
    border-bottom: 1px solid var(--wb-border);
    background: var(--wb-bg-elevated);
    font-weight: 500;
  }
  .wb-toolbar {
    position: absolute;
    top: var(--wb-pad-md);
    right: var(--wb-pad-md);
    z-index: 5;
  }
</style>
