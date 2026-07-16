import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { router } from '@/router'
import { useSettingStore } from './setting'
import { useWorktabStore } from './worktab'
import { AppRouteRecord } from '@/types/router'
import { resetRouterState } from '@/router/guards/beforeEach'
import { useMenuStore } from './menu'
import { StorageConfig } from '@/utils/storage/storage-config'

/**
 * 用户状态管理
 * AI-agent-workshop uses HttpOnly cookie auth (pw_at / pw_rt), so we do not
 * store access tokens in the client. This store only keeps the login flag and
 * the cached user info.
 */
export const useUserStore = defineStore(
  'userStore',
  () => {
    // 登录状态
    const isLogin = ref(false)
    // 锁屏状态
    const isLock = ref(false)
    // 锁屏密码
    const lockPassword = ref('')
    // 用户信息
    const info = ref<Partial<Api.Auth.UserInfo>>({})
    // 搜索历史记录
    const searchHistory = ref<AppRouteRecord[]>([])

    // 计算属性：获取用户信息
    const getUserInfo = computed(() => info.value)
    // 计算属性：获取设置状态
    const getSettingState = computed(() => useSettingStore().$state)
    // 计算属性：获取工作台状态
    const getWorktabState = computed(() => useWorktabStore().$state)

    /**
     * @deprecated AI-agent-workshop 使用 HttpOnly Cookie 认证（pw_at / pw_rt），
     * 客户端不持有访问令牌。保留此 getter 仅为兼容模板自带代码对
     * `userStore.accessToken` 的引用；它始终返回空字符串，因此任何
     * `Authorization: Bearer <token>` 注入都会退化为无认证头（由浏览器
     * 通过 withCredentials 自动携带 Cookie 完成认证）。新代码请勿使用。
     */
    const accessToken = computed(() => '')

    /**
     * 设置用户信息
     * @param newInfo 新的用户信息
     */
    const setUserInfo = (newInfo: Api.Auth.UserInfo) => {
      const defaultAvatar = '/src/assets/img/user/avatar.webp'

      info.value = {
        ...newInfo,
        avatar: newInfo.avatar || defaultAvatar
      }
    }

    /**
     * 设置登录状态
     * @param status 登录状态
     */
    const setLoginStatus = (status: boolean) => {
      isLogin.value = status
    }

    /**
     * 设置搜索历史
     * @param list 搜索历史列表
     */
    const setSearchHistory = (list: AppRouteRecord[]) => {
      searchHistory.value = list
    }

    /**
     * 设置锁屏状态
     * @param status 锁屏状态
     */
    const setLockStatus = (status: boolean) => {
      isLock.value = status
    }

    /**
     * 设置锁屏密码
     * @param password 锁屏密码
     */
    const setLockPassword = (password: string) => {
      lockPassword.value = password
    }

    /**
     * 退出登录
     * 通知后端清除 HttpOnly cookies，然后清空本地状态并跳转到登录页
     */
    const logOut = async () => {
      try {
        const { fetchLogout } = await import('@/api/auth')
        await fetchLogout()
      } catch {
        // Best-effort: even if the backend call fails, clear the local state
      }

      const currentUserId = info.value.userId
      if (currentUserId) {
        localStorage.setItem(StorageConfig.LAST_USER_ID_KEY, String(currentUserId))
      }

      info.value = {}
      isLogin.value = false
      isLock.value = false
      lockPassword.value = ''
      sessionStorage.removeItem('iframeRoutes')
      useMenuStore().setHomePath('')
      resetRouterState(500)

      const currentRoute = router.currentRoute.value
      const redirect = currentRoute.path !== '/login' ? currentRoute.fullPath : undefined
      router.push({
        name: 'Login',
        query: redirect ? { redirect } : undefined
      })
    }

    /**
     * 检查并清理工作台标签页
     * 如果不是同一用户登录，清空工作台标签页
     * 应在登录成功后调用
     */
    const checkAndClearWorktabs = () => {
      const lastUserId = localStorage.getItem(StorageConfig.LAST_USER_ID_KEY)
      const currentUserId = info.value.userId

      if (!currentUserId) return
      if (!lastUserId) return

      if (String(currentUserId) !== lastUserId) {
        const worktabStore = useWorktabStore()
        worktabStore.opened = []
        worktabStore.keepAliveExclude = []
      }

      localStorage.removeItem(StorageConfig.LAST_USER_ID_KEY)
    }

    return {
      isLogin,
      isLock,
      lockPassword,
      info,
      searchHistory,
      getUserInfo,
      getSettingState,
      getWorktabState,
      accessToken,
      setUserInfo,
      setLoginStatus,
      setSearchHistory,
      setLockStatus,
      setLockPassword,
      logOut,
      checkAndClearWorktabs
    }
  },
  {
    persist: {
      key: 'user',
      storage: localStorage
    }
  }
)
