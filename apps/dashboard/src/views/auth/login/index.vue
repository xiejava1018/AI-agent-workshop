<template>
  <div class="login">
    <LoginLeftView></LoginLeftView>

    <div class="right-wrap">
      <div class="top-right-wrap">
        <div v-if="shouldShowThemeToggle" class="btn theme-btn" @click="themeAnimation">
          <i class="iconfont-sys">
            {{ isDark ? '&#xe6b5;' : '&#xe725;' }}
          </i>
        </div>
      </div>
      <div class="header">
        <ArtLogo class="icon" />
        <h1>{{ systemName }}</h1>
      </div>
      <div class="login-wrap">
        <div class="form">
          <h3 class="title">{{ '欢迎回来' }}</h3>
          <p class="sub-title">{{ '输入您的账号和密码登录' }}</p>
          <ElForm
            ref="formRef"
            :model="formData"
            :rules="rules"
            @keyup.enter="handleSubmit"
            style="margin-top: 25px"
          >
            <ElFormItem prop="username">
              <ElInput v-model.trim="formData.username" :placeholder="usernamePlaceholder" />
            </ElFormItem>
            <ElFormItem prop="password">
              <ElInput
                :placeholder="passwordPlaceholder"
                v-model.trim="formData.password"
                type="password"
                radius="8px"
                autocomplete="off"
                show-password
              />
            </ElFormItem>

            <div class="forget-password">
              <ElCheckbox v-model="formData.rememberPassword">{{ '记住密码' }}</ElCheckbox>
              <RouterLink :to="RoutesAlias.ForgetPassword">{{ '忘记密码' }}</RouterLink>
            </div>

            <div style="margin-top: 30px">
              <ElButton
                class="login-btn"
                type="primary"
                @click="handleSubmit"
                :loading="loading"
                v-ripple
              >
                {{ '登录' }}
              </ElButton>
            </div>
          </ElForm>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, reactive, ref } from 'vue'
  import { useRouter, useRoute } from 'vue-router'
  import { storeToRefs } from 'pinia'
  import { RoutesAlias } from '@/router/routesAlias'
  import { ElNotification, ElMessage } from 'element-plus'
  import { useUserStore } from '@/store/modules/user'
  import { useDictStore } from '@/store/modules/dict'
  import { themeAnimation } from '@/utils/theme/animation'
  import { fetchLogin, fetchGetUserInfo } from '@/api/auth'
  import { useHeaderBar } from '@/composables/useHeaderBar'
  import { useSettingStore } from '@/store/modules/setting'
  import { useSystemStore } from '@/store/modules/system'
  import type { FormInstance, FormRules } from 'element-plus'

  defineOptions({ name: 'Login' })

  const settingStore = useSettingStore()
  const { isDark } = storeToRefs(settingStore)
  const { shouldShowThemeToggle } = useHeaderBar()

  const userStore = useUserStore()
  const dictStore = useDictStore()
  const router = useRouter()
  const route = useRoute()
  const systemStore = useSystemStore()

  const systemName = systemStore.appName
  const formRef = ref<FormInstance>()

  const formData = reactive({
    username: '',
    password: '',
    rememberPassword: true
  })

  const usernamePlaceholder = computed(() => '请输入账号')
  const passwordPlaceholder = computed(() => '请输入密码')

  const rules = computed<FormRules>(() => ({
    username: [{ required: true, message: usernamePlaceholder.value, trigger: 'blur' }],
    password: [{ required: true, message: passwordPlaceholder.value, trigger: 'blur' }]
  }))

  const loading = ref(false)

  const handleSubmit = async () => {
    if (!formRef.value) return
    if (loading.value) return

    const valid = await formRef.value.validate().catch(() => false)
    if (!valid) return

    loading.value = true
    try {
      const loginParams: Api.Auth.LoginParams = {
        username: formData.username,
        password: formData.password
      }

      const loginRes = await fetchLogin(loginParams)

      // AI-agent-workshop login response: { id, username, mustChangePassword }
      if (!loginRes.id) {
        throw new Error('登录失败，请稍后重试')
      }

      userStore.setLoginStatus(true)

      // 获取完整用户信息（role, teams 等）
      const userInfo = await fetchGetUserInfo().catch((error) => {
        console.error('[Login] fetch user info error:', error)
        return {
          id: loginRes.id,
          username: loginRes.username,
          mustChangePassword: loginRes.mustChangePassword
        }
      })
      userStore.setUserInfo(userInfo)

      showLoginSuccessNotice()

      // 预加载字典数据
      dictStore.loadAll().catch((e) => console.warn('[Login] 加载字典失败:', e))

      // 如果用户必须改密，跳转到改密页
      if (loginRes.mustChangePassword) {
        router.push({ name: 'ForgetPassword', query: { force: '1' } })
        return
      }

      const redirect = route.query.redirect as string | undefined
      router.push(redirect || '/dashboard').catch((err) => {
        console.error('[Login] 跳转失败:', err)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      ElMessage.error(message || '登录失败，请稍后重试')
    } finally {
      loading.value = false
    }
  }

  const showLoginSuccessNotice = () => {
    const displayName =
      userStore.getUserInfo?.username || formData.username || ''
    setTimeout(() => {
      ElNotification({
        title: '登录成功',
        type: 'success',
        duration: 2500,
        zIndex: 10000,
        message: displayName ? `欢迎回来, ${displayName}!` : '登录成功'
      })
    }, 150)
  }
</script>

<style lang="scss" scoped>
  @use './index';
</style>
