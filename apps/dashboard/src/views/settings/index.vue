<template>
  <div class="settings-page">
    <h2>我的设置</h2>

    <el-tabs>
      <!-- 个人资料 -->
      <el-tab-pane label="个人资料">
        <el-card>
          <el-form :model="profile" label-width="120px">
            <el-form-item label="用户名">
              <el-input v-model="profile.username" disabled />
            </el-form-item>
            <el-form-item label="邮箱">
              <el-input v-model="profile.email" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveProfile">保存</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- API Key 管理 -->
      <el-tab-pane label="API Key">
        <el-card header="我的 API Key">
          <div v-for="key in apiKeys" :key="key.id" class="api-key-item">
            <span class="provider">{{ key.provider }}</span>
            <span class="masked">{{ key.secretEnc ? '••••••••' : '未设置' }}</span>
            <el-button link type="primary" @click="showAddKey(key.provider)">设置</el-button>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- 默认模型 -->
      <el-tab-pane label="默认模型">
        <el-card>
          <el-form-item label="默认模型">
            <el-select v-model="settings.defaultModel" style="width: 300px">
              <el-option label="Claude Opus 4" value="anthropic/claude-opus-4-8" />
              <el-option label="Claude Sonnet 4" value="anthropic/claude-sonnet-4-6" />
              <el-option label="Claude Haiku 4" value="anthropic/claude-haiku-4-5" />
            </el-select>
          </el-form-item>
          <el-form-item label="故障回退">
            <el-switch v-model="settings.fallbackEnabled" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveSettings">保存</el-button>
          </el-form-item>
        </el-card>
      </el-tab-pane>

      <!-- 我的配额 -->
      <el-tab-pane label="我的配额">
        <el-card>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="今日 Token">{{ quota.tokenUsed }} / {{ quota.tokenLimit === 0 ? '不限' : quota.tokenLimit }}</el-descriptions-item>
            <el-descriptions-item label="最大并发会话">{{ quota.concurrentSessions }} / {{ quota.maxConcurrentSessions }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getProfile, updateProfile, getApiKeys, setApiKey, getSettings, updateSettings, getQuota } from '@/api/settings'

defineOptions({ name: 'Settings' })

const profile = ref<{ username: string; email: string }>({ username: '', email: '' })
const apiKeys = ref<Array<{ id: string; provider: string; secretEnc?: string }>>([])
const settings = ref<{ defaultModel: string; fallbackEnabled: boolean }>({ defaultModel: '', fallbackEnabled: false })
const quota = ref<{ tokenUsed: number; tokenLimit: number; concurrentSessions: number; maxConcurrentSessions: number }>({
  tokenUsed: 0,
  tokenLimit: 0,
  concurrentSessions: 0,
  maxConcurrentSessions: 5,
})

onMounted(async () => {
  const [profileData, apiKeysData, settingsData, quotaData] = await Promise.all([
    getProfile(),
    getApiKeys(),
    getSettings(),
    getQuota(),
  ])
  profile.value = profileData
  apiKeys.value = apiKeysData
  settings.value = settingsData as any
  quota.value = quotaData
})

async function saveProfile() {
  try {
    await updateProfile({ email: profile.value.email })
    ElMessage.success('保存成功')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  }
}

function showAddKey(provider: string) {
  const key = prompt(`请输入 ${provider} 的 API Key（将加密存储）：`)
  if (key) {
    setApiKey({ provider, secret: key })
      .then(() => {
        ElMessage.success('Key 已保存')
        return getApiKeys()
      })
      .then((d) => {
        apiKeys.value = d
      })
      .catch((e: any) => {
        ElMessage.error(e?.message || '保存失败')
      })
  }
}

async function saveSettings() {
  try {
    await updateSettings(settings.value)
    ElMessage.success('保存成功')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  }
}
</script>

<style scoped>
.settings-page {
  padding: 20px;
  max-width: 800px;
}
.settings-page h2 {
  margin-bottom: 20px;
}
.api-key-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}
.api-key-item .provider {
  font-weight: 600;
  min-width: 120px;
}
.api-key-item .masked {
  color: #999;
}
</style>
