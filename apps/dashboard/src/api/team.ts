import request from '@/utils/http'

const httpClient = request as import('@/utils/http').HttpClient

export function listTeams() {
  return httpClient.get<any[]>({ url: '/api/admin/teams', params: {} })
}

export function createTeam(data: any) {
  return httpClient.post<any>({ url: '/api/admin/teams', data })
}

export function getMembers(teamId: string) {
  return httpClient.get<any[]>({ url: `/api/admin/teams/${teamId}/members`, params: {} })
}

export function inviteMember(teamId: string, data: any) {
  return httpClient.post<any>({ url: `/api/admin/teams/${teamId}/invites`, data })
}

export function updateMemberRole(teamId: string, memberId: string, role: string) {
  return httpClient.request<any>({ method: 'PATCH', url: `/api/admin/teams/${teamId}/members/${memberId}`, data: { role } })
}

export function removeMember(teamId: string, memberId: string) {
  return httpClient.del<any>({ url: `/api/admin/teams/${teamId}/members/${memberId}` })
}

export function createInviteLink(teamId: string) {
  return httpClient.post<any>({ url: `/api/admin/teams/${teamId}/invites`, data: {} })
}

export interface TeamOption {
  id: string
  name: string
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
}

interface MyTeamsResponse {
  teams?: TeamOption[]
}

export async function listMyTeams(): Promise<TeamOption[]> {
  const response = await request.get<MyTeamsResponse>({ url: '/api/teams/my' })
  return response.teams ?? []
}
