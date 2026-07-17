<template>
  <div class="orchestration">
    <!-- 顶部输入区 -->
    <el-card class="task-input-card">
      <el-form :model="taskForm" label-width="80px">
        <el-form-item label="任务描述">
          <el-input v-model="taskForm.description" type="textarea" :rows="3" placeholder="描述要完成的复杂任务..." />
        </el-form-item>
        <el-form-item label="执行模式">
          <el-radio-group v-model="taskForm.mode">
            <el-radio value="sync">同步</el-radio>
            <el-radio value="parallel">并行 (≤8)</el-radio>
            <el-radio value="async">异步</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="选择Agent">
          <el-select v-model="taskForm.agentIds" multiple placeholder="选择执行Agent">
            <el-option v-for="agent in availableAgents" :key="agent.id" :label="agent.name" :value="agent.id" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="startOrchestration" :loading="isRunning">
            开始编排
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 编排树 -->
    <el-card class="orchestration-tree" header="编排执行树">
      <el-tree
        :data="treeData"
        :props="{ label: 'name', children: 'children' }"
        node-key="id"
        default-expand-all
      >
        <template #default="{ node, data }">
          <span class="tree-node">
            <el-tag :type="getStatusType(data.status)" size="small">{{ data.status }}</el-tag>
            <span>{{ node.label }}</span>
            <span v-if="data.mode" class="node-mode">({{ data.mode }})</span>
          </span>
        </template>
      </el-tree>
    </el-card>

    <!-- 执行日志 -->
    <el-card class="execution-log" header="执行日志">
      <el-scrollbar max-height="300px">
        <div v-for="(log, i) in logs" :key="i" class="log-entry" :class="log.level">
          <span class="log-time">{{ log.timestamp }}</span>
          <span class="log-agent">[{{ log.agent }}]</span>
          <span class="log-msg">{{ log.message }}</span>
        </div>
        <el-empty v-if="logs.length === 0" description="暂无日志" />
      </el-scrollbar>
    </el-card>

    <!-- 结果 -->
    <el-card v-if="result" class="result-card" header="执行结果">
      <pre>{{ JSON.stringify(result, null, 2) }}</pre>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { listAvailableAgents, startDelegation } from '@/api/agent';

const availableAgents = ref<Array<{ id: string; name: string; description?: string }>>([]);
const isRunning = ref(false);
const logs = ref<Array<{ timestamp: string; agent: string; level: string; message: string }>>([]);
const treeData = ref<any[]>([]);
const result = ref<any>(null);

const taskForm = reactive({
  description: '',
  mode: 'parallel' as 'sync' | 'parallel' | 'async',
  agentIds: [] as string[],
});

onMounted(async () => {
  const res = await listAvailableAgents();
  availableAgents.value = res.data ?? [];
});

function getStatusType(status: string): 'info' | 'success' | 'warning' | 'danger' {
  const map: Record<string, 'info' | 'success' | 'warning' | 'danger'> = { pending: 'info', running: 'warning', done: 'success', error: 'danger' };
  return map[status] || 'info';
}

async function startOrchestration() {
  if (!taskForm.description || taskForm.agentIds.length === 0) {
    ElMessage.warning('请填写任务描述并选择Agent');
    return;
  }

  isRunning.value = true;
  logs.value = [];
  treeData.value = [];
  result.value = null;

  try {
    const res = await startDelegation({
      task: taskForm.description,
      mode: taskForm.mode,
      agentIds: taskForm.agentIds,
    });
    const taskId = res.data?.taskId;
    ElMessage.success(`编排任务已启动: ${taskId}`);
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || err?.message || '启动失败');
  } finally {
    isRunning.value = false;
  }
}
</script>

<style scoped>
.orchestration { padding: 16px; display: flex; flex-direction: column; gap: 16px; height: calc(100vh - 60px); overflow-y: auto; }
.tree-node { display: flex; align-items: center; gap: 8px; }
.node-mode { color: #999; font-size: 12px; }
.log-entry { font-family: monospace; font-size: 12px; padding: 2px 8px; }
.log-entry.info { color: #666; }
.log-entry.success { color: #67c23a; }
.log-entry.error { color: #f56c6c; }
.log-time { color: #999; margin-right: 8px; }
.log-agent { color: #409eff; margin-right: 8px; }
</style>
