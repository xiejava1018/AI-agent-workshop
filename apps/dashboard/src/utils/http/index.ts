import axios, { AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { ApiStatus } from './status'
import { HttpError, handleError, showError, showSuccess } from './error'

/** 请求配置常量 */
const REQUEST_TIMEOUT = 15000
const LOGOUT_DELAY = 500
const MAX_RETRIES = 2
const RETRY_DELAY = 1000
const UNAUTHORIZED_DEBOUNCE_TIME = 3000

/** 401防抖状态 */
let isUnauthorizedErrorShown = false
let unauthorizedTimer: NodeJS.Timeout | null = null

/** Token刷新状态 */
let isRefreshing = false
let refreshSubscribers: Array<(token: string) => void> = []

function subscribeTokenRefresh(callback: (token: string) => void) {
  refreshSubscribers.push(callback)
}

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token))
  refreshSubscribers = []
}

/** 扩展 AxiosRequestConfig */
export interface ExtendedAxiosRequestConfig extends AxiosRequestConfig {
  showErrorMessage?: boolean
  showSuccessMessage?: boolean
  successMessage?: string
  keepFullResponse?: boolean
  // 允许调用方显式声明是否需要携带 cookie（默认 true）
  withCredentials?: boolean
  // 401 时不触发自动登出（用于非关键后台接口，如通知/系统信息）
  skipAuthHandler?: boolean
}

export interface HttpClient {
  get<T>(config: ExtendedAxiosRequestConfig): Promise<T>
  post<T>(config: ExtendedAxiosRequestConfig): Promise<T>
  put<T>(config: ExtendedAxiosRequestConfig): Promise<T>
  del<T>(config: ExtendedAxiosRequestConfig): Promise<T>
  request<T>(config: ExtendedAxiosRequestConfig): Promise<T>
}

/** Axios实例 */
const axiosInstance = axios.create({
  timeout: REQUEST_TIMEOUT,
  // 关键：不设置 baseURL（同源相对路径）。浏览器地址是 http://localhost:5174，
  // 请求发向 /api/...，由 Vite proxy 转发到 Next.js (30141)。这样：
  //   1. 请求是同源的，不触发 CORS 预检；
  //   2. Set-Cookie 是第一方 Cookie（域为 localhost），浏览器正常接收。
  // 若把 baseURL 写成 http://127.0.0.1:30141，则变成跨域请求且 Cookie 属于
  // 第三方，会被浏览器拦截 / 拒收，表现为"网络错误"。
  baseURL: '',
  // AI-agent-workshop uses HttpOnly Cookie auth (pw_at / pw_rt), so axios
  // must send cookies with every request. The VITE_WITH_CREDENTIALS env
  // var is no longer consulted.
  withCredentials: true,
  validateStatus: (status) => status >= 200 && status < 300,
  transformResponse: [
    (data, headers) => {
      const contentType = String(headers['content-type'] || '')
      if (contentType.includes('application/json')) {
        try {
          return JSON.parse(data)
        } catch {
          return data
        }
      }
      return data
    }
  ]
})

/** 请求拦截器 */
axiosInstance.interceptors.request.use(
  (request: InternalAxiosRequestConfig) => {
    // AI-agent-workshop does NOT use Authorization Bearer tokens. Cookies are
    // attached automatically by the browser via withCredentials: true above.
    // Do not inject an Authorization header here.
    if (request.data && !(request.data instanceof FormData) && !request.headers['Content-Type']) {
      request.headers.set('Content-Type', 'application/json')
      request.data = JSON.stringify(request.data)
    }

    return request
  },
  (error) => {
    showError(createHttpError('请求配置错误', ApiStatus.error))
    return Promise.reject(error)
  }
)

/** 响应拦截器 */
axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => {
    // Next.js API 直接返回 { data } 或 { error }，HTTP 状态码即业务状态。
    // 2xx 时直接放行；401 由 error 分支处理。
    return response
  },
  async (error) => {
    const originalRequest = error.config as ExtendedAxiosRequestConfig & { _retry?: boolean }
    const status = error.response?.status
    const skipAuth = originalRequest?.skipAuthHandler === true

    // 401 自动刷新 token 重放
    if (status === ApiStatus.unauthorized && !skipAuth && !originalRequest._retry) {
      if (!isRefreshing) {
        isRefreshing = true
        try {
          const { refreshToken } = await import('@/api/auth')
          const res = await refreshToken()
          const newToken = (res as any)?.data?.access_token
          if (newToken) {
            localStorage.setItem('access_token', newToken)
            onTokenRefreshed(newToken)
          }
        } catch {
          // refresh 失败，交给后续 handleUnauthorizedError 处理
        } finally {
          isRefreshing = false
        }
      }

      // 排队等待 token 刷新完成
      return new Promise((resolve) => {
        subscribeTokenRefresh((token) => {
          originalRequest._retry = true
          ;(originalRequest.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`
          resolve(axiosInstance(originalRequest))
        })
      })
    }

    if (status === ApiStatus.unauthorized && !skipAuth) handleUnauthorizedError()
    return Promise.reject(handleError(error))
  }
)

/** 统一创建HttpError */
function createHttpError(message: string, code: number) {
  return new HttpError(message, code)
}

/** 处理401错误（带防抖） */
function handleUnauthorizedError(message?: string): never {
  const error = createHttpError(message || '登录状态已失效，请重新登录', ApiStatus.unauthorized)

  if (!isUnauthorizedErrorShown) {
    isUnauthorizedErrorShown = true
    logOut()

    unauthorizedTimer = setTimeout(resetUnauthorizedError, UNAUTHORIZED_DEBOUNCE_TIME)

    showError(error, true)
    throw error
  }

  throw error
}

/** 重置401防抖状态 */
function resetUnauthorizedError() {
  isUnauthorizedErrorShown = false
  if (unauthorizedTimer) clearTimeout(unauthorizedTimer)
  unauthorizedTimer = null
}

/** 退出登录函数 */
function logOut() {
  setTimeout(async () => {
    const { useUserStore } = await import('@/store/modules/user')
    useUserStore().logOut()
  }, LOGOUT_DELAY)
}

/** 是否需要重试 */
function shouldRetry(statusCode: number) {
  return [
    ApiStatus.requestTimeout,
    ApiStatus.internalServerError,
    ApiStatus.badGateway,
    ApiStatus.serviceUnavailable,
    ApiStatus.gatewayTimeout
  ].includes(statusCode)
}

/** 请求重试逻辑 */
async function retryRequest<T>(
  config: ExtendedAxiosRequestConfig,
  retries: number = MAX_RETRIES
): Promise<T> {
  try {
    return await makeRequest<T>(config)
  } catch (error) {
    if (retries > 0 && error instanceof HttpError && shouldRetry(error.code)) {
      await delay(RETRY_DELAY)
      return retryRequest<T>(config, retries - 1)
    }
    throw error
  }
}

/** 延迟函数 */
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 请求函数 */
async function makeRequest<T = any>(config: ExtendedAxiosRequestConfig): Promise<T> {
  const method = config.method?.toUpperCase()
  // 清理 GET 请求中的空参数：剔除 undefined/null/空字符串（含纯空白）
  if (method === 'GET' && config.params && typeof config.params === 'object') {
    const cleaned: Record<string, any> = {}
    const params = config.params as Record<string, any>
    Object.keys(params).forEach((key) => {
      const val = params[key]
      const isEmptyString = typeof val === 'string' && val.trim() === ''
      const isNil = val === undefined || val === null
      // 保留 0 和 false，去除 空串/空白串/undefined/null
      if (!isNil && !isEmptyString) {
        cleaned[key] = val
      }
    })
    config.params = cleaned
  }
  if (method && ['POST', 'PUT'].includes(method) && config.params && !config.data) {
    config.data = config.params
    config.params = undefined
  }

  try {
    const res = await axiosInstance.request<T>(config)

    if (config.showSuccessMessage) {
      const message = config.successMessage ?? '操作成功'
      if (message) showSuccess(message)
    }

    if (config.keepFullResponse) {
      return res.data as unknown as T
    }

    return res.data as T
  } catch (error) {
    if (error instanceof HttpError && error.code !== ApiStatus.unauthorized) {
      const showMsg = config.showErrorMessage !== false
      showError(error, showMsg)
    }
    return Promise.reject(error)
  }
}

const request: HttpClient = {
  get<T>(config: ExtendedAxiosRequestConfig): Promise<T> {
    return retryRequest<T>({ ...config, method: 'GET' })
  },
  post<T>(config: ExtendedAxiosRequestConfig): Promise<T> {
    return retryRequest<T>({ ...config, method: 'POST' })
  },
  put<T>(config: ExtendedAxiosRequestConfig): Promise<T> {
    return retryRequest<T>({ ...config, method: 'PUT' })
  },
  del<T>(config: ExtendedAxiosRequestConfig): Promise<T> {
    return retryRequest<T>({ ...config, method: 'DELETE' })
  },
  request<T>(config: ExtendedAxiosRequestConfig): Promise<T> {
    return retryRequest<T>({ ...config })
  }
}

export const api = request

export default request
