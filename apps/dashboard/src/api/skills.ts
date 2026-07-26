import request from '@/utils/http'

export interface SkillPackage {
  id: string
  slug?: string
  name: string
  description?: string
  scope?: 'global' | 'team' | 'user'
  teamId?: string | null
  userId?: string | null
  enabled?: boolean
}

interface SkillsResponse {
  skills?: SkillPackage[]
}

export async function listSkills(params?: { q?: string; scope?: string }): Promise<SkillPackage[]> {
  const response = await request.get<SkillsResponse>({
    url: '/api/skills/search',
    params
  })
  return response.skills ?? []
}

export function searchSkills(params: { q: string }) {
  return request.post<{ results?: unknown[] }>({ url: '/api/skills/search', data: params })
}

export function installSkill(data: { slug: string; scope: string }) {
  return request.post<unknown>({ url: '/api/skills/install', data })
}

export function toggleSkill(id: string, data: { enabled: boolean }) {
  return request.post<unknown>({ url: `/api/skills/${id}`, method: 'PATCH', data })
}
