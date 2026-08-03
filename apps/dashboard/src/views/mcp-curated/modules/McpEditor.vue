<!--
  views/mcp-curated/modules/McpEditor.vue

  MCP 服务器 编辑/新建表单。
  - entry === null → 新建模式
  - entry !== null → 编辑模式

  设计要点:
  - transport 动态切换字段: stdio→command; sse/http→endpoint
  - scope 动态切换: team→teamId; user→userId
  - 凭证(configEnc)为可选高级字段,客户端 AES-256-GCM 加密;
    编辑模式因后端不回传 configEnc,采用"重设凭证"模式(留空=不修改)
  - 安全规则: global 作用域禁用凭证输入(后端铁律)
-->
<template>
  <div class="mcp-editor">
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="110px"
      label-position="right"
      :disabled="readonly"
    >
      <el-form-item label="名称" prop="name">
        <el-input v-model="form.name" placeholder="如 filesystem-server" />
      </el-form-item>

      <el-form-item label="作用域" prop="scope">
        <el-radio-group v-model="form.scope">
          <el-radio-button value="global">全局</el-radio-button>
          <el-radio-button value="team">团队</el-radio-button>
          <el-radio-button value="user">个人</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item v-if="form.scope === 'team'" label="团队 ID" prop="teamId">
        <el-input v-model="form.teamId" placeholder="team_xxx" />
      </el-form-item>
      <el-form-item v-if="form.scope === 'user'" label="用户 ID" prop="userId">
        <el-input v-model="form.userId" placeholder="user_xxx" />
      </el-form-item>

      <el-form-item label="传输协议" prop="transport">
        <el-radio-group v-model="form.transport">
          <el-radio-button value="stdio">stdio · 本地进程</el-radio-button>
          <el-radio-button value="sse">sse · 远程</el-radio-button>
          <el-radio-button value="http">http · 远程</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item v-if="form.transport === 'stdio'" label="启动命令" prop="command">
        <el-input
          v-model="form.command"
          type="textarea"
          :rows="2"
          placeholder="如 npx -y @modelcontextprotocol/server-filesystem /tmp"
        />
      </el-form-item>
      <el-form-item v-else label="服务地址" prop="endpoint">
        <el-input v-model="form.endpoint" placeholder="如 https://mcp.example.com/sse" />
      </el-form-item>

      <!-- 凭证配置(可选,加密) -->
      <el-divider content-position="left">凭证配置(可选)</el-divider>

      <el-alert
        v-if="!encryptionReady"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
      >
        凭证加密未配置(缺少 VITE_APP_ENCRYPTION_KEY,需与后端 APP_ENCRYPTION_KEY 同值),
        无法保存凭证。其余字段仍可正常保存。
      </el-alert>
      <el-alert
        v-else-if="form.scope === 'global'"
        type="error"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
      >
        安全规则: 全局作用域的 MCP 严禁携带凭证(后端会拒绝并记审计)。
        如需凭证请选择 团队 或 个人 作用域。
      </el-alert>

      <el-form-item v-if="isEdit" label="重设凭证">
        <el-switch v-model="resetCredential" :disabled="!canSetCredential" />
        <span class="form-hint">凭证加密存储,无法回显;如需修改请开启后重新填写。</span>
      </el-form-item>

      <el-form-item v-if="credentialFieldVisible" label="配置内容">
        <el-input
          v-model="credentialPlain"
          type="textarea"
          :rows="4"
          placeholder='JSON 配置,如 {"env":{"API_KEY":"xxx"},"args":["--port","3000"]}'
        />
        <span class="form-hint">将以 AES-256-GCM 加密后作为 configEnc 提交,后端永不回传明文。</span>
      </el-form-item>

      <el-form-item label="启用">
        <el-switch v-model="form.enabled" />
      </el-form-item>
    </el-form>

    <div class="editor-actions" v-if="!readonly">
      <el-button @click="$emit('cancel')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, reactive, computed, watchEffect } from 'vue'
  import type { FormInstance, FormRules } from 'element-plus'
  import { ElMessage } from 'element-plus'
  import {
    createMcpServer,
    updateMcpServer,
    encryptConfig,
    isCredentialEncryptionConfigured,
    type McpServer,
    type McpServerInput,
    type McpTransport,
    type McpScope
  } from '@/api/mcp'

  const props = defineProps<{ entry: McpServer | null; readonly?: boolean }>()
  const emit = defineEmits<{
    (e: 'saved'): void
    (e: 'cancel'): void
  }>()

  const isEdit = computed(() => !!props.entry)
  const formRef = ref<FormInstance>()
  const saving = ref(false)
  const encryptionReady = computed(() => isCredentialEncryptionConfigured())

  const form = reactive({
    name: '',
    scope: 'global' as McpScope,
    teamId: '',
    userId: '',
    transport: 'stdio' as McpTransport,
    command: '',
    endpoint: '',
    enabled: true
  })
  const resetCredential = ref(false)
  const credentialPlain = ref('')

  // 凭证字段是否可设置: 加密已配置 且 作用域非 global
  const canSetCredential = computed(() => encryptionReady.value && form.scope !== 'global')
  // 凭证字段是否可见: 新建直接显示; 编辑需开启"重设凭证"
  const credentialFieldVisible = computed(() => {
    if (!canSetCredential.value) return false
    return isEdit.value ? resetCredential.value : true
  })

  watchEffect(() => {
    if (props.entry) {
      form.name = props.entry.name
      form.scope = props.entry.scope
      form.teamId = props.entry.teamId ?? ''
      form.userId = props.entry.userId ?? ''
      form.transport = props.entry.transport
      form.command = props.entry.command
      form.endpoint = props.entry.endpoint
      form.enabled = props.entry.enabled
    }
  })

  const rules: FormRules = {
    name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
    scope: [{ required: true, message: '请选择作用域', trigger: 'change' }],
    transport: [{ required: true, message: '请选择传输协议', trigger: 'change' }],
    teamId: [{ required: true, message: '团队作用域需填写 teamId', trigger: 'blur' }],
    userId: [{ required: true, message: '个人作用域需填写 userId', trigger: 'blur' }]
  }

  async function onSave() {
    if (!formRef.value) return
    await formRef.value.validate()
    saving.value = true
    try {
      const payload: McpServerInput = {
        name: form.name.trim(),
        scope: form.scope,
        transport: form.transport,
        command: form.transport === 'stdio' ? form.command : '',
        endpoint: form.transport === 'stdio' ? '' : form.endpoint,
        teamId: form.scope === 'team' ? form.teamId.trim() : null,
        userId: form.scope === 'user' ? form.userId.trim() : null,
        enabled: form.enabled
      }

      // 凭证加密(仅当字段可见且有内容;编辑开启重设但留空=清空)
      if (credentialFieldVisible.value && credentialPlain.value.trim()) {
        payload.configEnc = await encryptConfig(credentialPlain.value)
      } else if (isEdit.value && resetCredential.value && !credentialPlain.value.trim()) {
        payload.configEnc = ''
      }

      if (isEdit.value && props.entry) {
        await updateMcpServer(props.entry.id, payload)
        ElMessage.success('已更新')
      } else {
        await createMcpServer(payload)
        ElMessage.success('已创建')
      }
      emit('saved')
    } catch (e) {
      ElMessage.error('保存失败: ' + (e as Error).message)
    } finally {
      saving.value = false
    }
  }
</script>

<style scoped>
  .mcp-editor {
    padding: 0 20px;
  }
  .form-hint {
    display: block;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    margin-top: 4px;
  }
  .editor-actions {
    margin-top: 24px;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }
</style>
