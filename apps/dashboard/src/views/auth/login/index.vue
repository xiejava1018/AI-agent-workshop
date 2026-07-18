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
  // 参考 AI-miniSOC src/frontend/src/views/auth/login/index.vue
  // 适配:本项目用 HttpOnly cookie 鉴权(无 access_token/refresh_token 字段,无验证码)
  import { computed, reactive, ref } from 'vue'
  import { useRouter, useRoute } from 'vue-router'
  import { storeToRefs } from 'pinia'
  import { ElNotification, ElMessage } from 'element-plus'
  import { RoutesAlias } from '@/router/routesAlias'
  import { useUserStore } from '@/store/modules/user'
  import { useDictStore } from '@/store/modules/dict'
  import { themeAnimation } from '@/utils/ui/animation'
  import { fetchLogin, fetchGetUserInfo } from '@/api/auth'
  import { useHeaderBar } from '@/composables/useHeaderBar'
  import { useSettingStore } from '@/store/modules/setting'
  import { useSystemStore } from '@/store/modules/system'
  import type { FormInstance, FormRules } from 'element-plus'
  import LoginLeftView from '@/components/core/views/login/LoginLeftView.vue'

  defineOptions({ name: 'Login' })

  const settingStore = useSettingStore()
  const { isDark } = storeToRefs(settingStore)
  const { shouldShowThemeToggle } = useHeaderBar()

  const userStore = useUserStore()
  const dictStore = useDictStore()
  const router = useRouter()
  const route = useRoute()
  const systemStore = useSystemStore()

  const systemName = systemStore.appName || 'AI Agent Workshop'
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
      // 适配 cookie 鉴权:不传 access_token;HttpOnly cookie 由 Set-Cookie 自动带
      await fetchLogin({
        username: formData.username,
        password: formData.password
      })

      userStore.setLoginStatus(true)

      // 登录响应只含 {id, username, mustChangePassword},完整信息(含 permissions/roles)从 /me 拉
      const userInfo = await fetchGetUserInfo().catch((error) => {
        console.error('[Login] fetch user info error:', error)
        return undefined
      })
      if (userInfo) {
        userStore.setUserInfo(userInfo)
      }

      showLoginSuccessNotice()

      // 预加载字典数据
      dictStore.loadAll().catch((e: unknown) => console.warn('[Login] 加载字典失败:', e))

      const redirect = route.query.redirect as string | undefined
      router.push(redirect || '/dashboard').then(() => {
        console.log('[Login] 跳转成功')
      }).catch((err) => {
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
      userStore.info?.full_name || userStore.info?.username || formData.username || ''
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