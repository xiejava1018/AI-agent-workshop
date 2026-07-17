import request from '@/utils/http'
import type { HttpClient } from '@/utils/http'

const httpClient = request as HttpClient

export function listAgents(params?: { scope?: string }) {
  return httpClient.get<any[]>({ url: '/api/digital-employees', params })
}

export function createAgent(data: any) {
  return httpClient.post<any>({ url: '/api/digital-employees', data })
}

export function updateAgent(id: string, data: any) {
  return httpClient.put<any>({ url: `/api/digital-employees/${id}`, data })
}

export function deleteAgent(id: string) {
  return httpClient.del<any>({ url: `/api/digital-employees/${id}` })
}

export function getSkills() {
  return httpClient.get<any[]>({ url: '/api/skills/search', params: {} })
}

export function getMcpServers() {
  return httpClient.get<any[]>({ url: '/api/admin/mcp', params: {} })
}
