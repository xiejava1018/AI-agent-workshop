import request from '@/utils/http'

/**
 * 登录
 * POST /api/auth/user-login
 */
export async function fetchLogin(params: Api.Auth.LoginParams): Promise<Api.Auth.LoginResponse> {
  const res = await request.post<any>({
    url: '/api/auth/user-login',
    data: params,
    showErrorMessage: false
  })

  return res as Api.Auth.LoginResponse
}

/**
 * 获取当前用户信息
 * GET /api/auth/me
 */
export function fetchGetUserInfo() {
  return request.get<Api.Auth.UserInfo>({
    url: '/api/auth/me',
    showErrorMessage: false
  })
}

/**
 * 刷新访问令牌
 * POST /api/auth/refresh
 * HttpOnly cookie (pw_rt) 自动携带，无需显式传 token
 */
export async function fetchRefreshToken(): Promise<{ ok: boolean }> {
  const res = await request.post<any>({
    url: '/api/auth/refresh',
    showErrorMessage: false
  })

  return res as { ok: boolean }
}

/**
 * 退出登录
 * POST /api/auth/user-logout
 */
export async function fetchLogout(): Promise<{ ok: boolean }> {
  const res = await request.post<any>({
    url: '/api/auth/user-logout',
    showErrorMessage: false
  })

  return res as { ok: boolean }
}

/**
 * 修改密码（首次登录强制改密）
 * POST /api/auth/change-password
 */
export async function fetchChangePassword(newPassword: string): Promise<void> {
  await request.post<void>({
    url: '/api/auth/change-password',
    data: { newPassword },
    showSuccessMessage: false
  })
}
