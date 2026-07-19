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
        <ChatWindow v-if="currentSessionId" :key="currentSessionId" :session-id="currentSessionId">
          <template #input="{ sendMessage, abort, isStreaming: streaming }">
            <ChatInput
              :session-id="currentSessionId"
              :is-streaming="streaming"
              @send="(text, attachments) => void sendMessage(text, attachments)"
              @abort="abort"
            />
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
  import ModelsConfig from './components/ModelsConfig.vue'
  import SkillsConfig from './components/SkillsConfig.vue'
  import PluginsConfig from './components/PluginsConfig.vue'
  import FileExplorer from './components/FileExplorer.vue'

  import type { ConfigPanelKey, WorkbenchTab } from './types'
  import { useSessionList } from './composables/useSessionList'

  // ============================================================================
  // 状态
  // ============================================================================

  const currentSessionId = ref<string | null>(null)
  const activePanel = ref<ConfigPanelKey>('none')
  const tabs = ref<WorkbenchTab[]>([])
  const showToolbar = ref(true)

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

  // 挂载时:1) 拉会话列表 2) 尝试恢复 lastSessionId(后端查得到才恢复)
  // 注意:SessionSidebar 自己也调用 useSessionList(),这是独立实例;我们这里的
  // sessionList 仅用于"读 sessions 列表查 lastSessionId 是否还存在",不写入
  // 侧栏共享状态(避免双实例互相覆盖)。
  onMounted(async () => {
    await sessionList.load(true)
    const last = readLastSessionId()
    if (last && sessionList.sessions.value.find((s) => s.id === last)) {
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

  function handleSelect(sessionId: string): void {
    currentSessionId.value = sessionId
    // 加入 Tab(若尚未存在)
    if (!tabs.value.find((t) => t.sessionId === sessionId)) {
      tabs.value.push({
        id: sessionId,
        sessionId,
        title: `会话 ${sessionId.slice(0, 8)}`,
        active: true
      })
    } else {
      tabs.value = tabs.value.map((t) => ({ ...t, active: t.sessionId === sessionId }))
    }
  }

  function handleRename(sessionId: string, newTitle: string): void {
    tabs.value = tabs.value.map((t) => (t.sessionId === sessionId ? { ...t, title: newTitle } : t))
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
</script>

<style scoped>
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
