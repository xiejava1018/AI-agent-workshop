import request from '@/utils/http'

export function listSkills(params?: any): Promise<any[]> {
  return request.get<any[]>({ url: '/api/skills/search', data: params || {} })
}

export function searchSkills(params: { q: string }): Promise<any[]> {
  return request.get<any[]>({ url: '/api/skills/search', data: params })
}

export function installSkill(data: { slug: string; scope: string }): Promise<any> {
  return request.post<any>({ url: '/api/skills/install', data })
}

export function toggleSkill(id: string, data: { enabled: boolean }): Promise<any> {
  return request.post<any>({ url: `/api/skills/${id}`, method: 'PATCH', data })
}
