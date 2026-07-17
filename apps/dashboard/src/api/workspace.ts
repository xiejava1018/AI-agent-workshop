import request from '@/utils/http'

export function getWorkspaceStats() {
  return request.get<any>({
    url: '/api/dashboard/stats'
  })
}

export function getRecentSessions(limit = 10) {
  return request.get<any>({
    url: '/api/sessions',
    params: { limit, orderBy: 'createdAt', order: 'desc' }
  })
}
