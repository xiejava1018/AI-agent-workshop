import request from '@/utils/http'

const httpClient = request as import('@/utils/http').HttpClient

export function listUsers() {
  return httpClient.get<any[]>({ url: '/api/admin/users', params: {} })
}

export function disableUser(id: string, action: 'disable' | 'enable') {
  return httpClient.request<any>({ url: `/api/admin/users/${id}`, data: { action }, method: 'PATCH' })
}

export function resetUserPassword(id: string) {
  return httpClient.post<any>({ url: `/api/admin/users/${id}/reset-password`, data: {} })
}

export function listAuditLogs(params: any) {
  return httpClient.get<any[]>({ url: '/api/admin/audit', data: params })
}

export function getStats() {
  return httpClient.get<any>({ url: '/api/admin/stats' })
}
