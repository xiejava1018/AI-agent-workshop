<template>
  <div class="login-container">
    <el-card class="login-card">
      <h2>AI Agent 工作台</h2>
      <el-form ref="formRef" :model="form" :rules="rules">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="用户名" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="密码" show-password />
        </el-form-item>
        <el-form-item v-if="mustChangePassword">
          <el-input v-model="form.newPassword" type="password" placeholder="新密码" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="handleLogin" style="width: 100%">
            {{ mustChangePassword ? '设置密码' : '登录' }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { login, changePassword } from '@/api/auth'
import { ElMessage } from 'element-plus'

const router = useRouter()
const formRef = ref()
const loading = ref(false)
const mustChangePassword = ref(false)
const form = reactive({
  username: '',
  password: '',
  newPassword: '',
})

const rules = {
  username: [{ required: true, message: '请输入用户名' }],
  password: [{ required: true, message: '请输入密码' }],
}

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    if (mustChangePassword.value) {
      await changePassword(form.password, form.newPassword)
    }
    await login(form.username, form.password)
    router.push('/workspace')
  } catch (err: any) {
    if (err?.response?.data?.mustChangePassword) {
      mustChangePassword.value = true
    } else {
      ElMessage.error(err?.response?.data?.error || '登录失败')
    }
  } finally {
    loading.value = false
  }
}
</script>

<style lang="scss" scoped>
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-card {
  width: 400px;
  padding: 20px;

  h2 {
    text-align: center;
    margin-bottom: 24px;
    color: #333;
  }
}
</style>
