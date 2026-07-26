import request from '@/utils/http'
import type { HttpClient } from '@/utils/http'

const httpClient = request as HttpClient

export type DigitalEmployeeScope = 'team' | 'personal'

export interface DigitalEmployeeBinding {
  skillPackageId?: string
  mcpServerId?: string
  mode?: string
}

export interface DigitalEmployee {
  id: string
  name: string
  description: string
  systemPrompt: string
  model: string
  scope: DigitalEmployeeScope
  teamId?: string | null
  ownerUserId?: string | null
  skillIds: string[]
  mcpServerIds: string[]
  skillBindings?: DigitalEmployeeBinding[]
  mcpBindings?: DigitalEmployeeBinding[]
  createdAt?: string | number
  updatedAt?: string | number
}

interface DigitalEmployeesResponse {
  agents?: DigitalEmployee[]
}

interface DigitalEmployeeResponse {
  agent?: DigitalEmployee
}

export interface DigitalEmployeeQuery {
  scope?: DigitalEmployeeScope
  teamId?: string
}

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

export interface McpServer {
  id: string
  name: string
  transport?: string
  endpoint?: string
  command?: string
  scope?: 'global' | 'team' | 'user'
  teamId?: string | null
  userId?: string | null
  enabled?: boolean
}

function normalizeAgent(agent: DigitalEmployee): DigitalEmployee {
  return {
    ...agent,
    skillIds:
      agent.skillIds ??
      agent.skillBindings?.flatMap((binding) =>
        typeof binding.skillPackageId === 'string' ? [binding.skillPackageId] : []
      ) ??
      [],
    mcpServerIds:
      agent.mcpServerIds ??
      agent.mcpBindings?.flatMap((binding) =>
        typeof binding.mcpServerId === 'string' ? [binding.mcpServerId] : []
      ) ??
      []
  }
}

export async function listAgents(params?: DigitalEmployeeQuery): Promise<DigitalEmployee[]> {
  const response = await httpClient.get<DigitalEmployeesResponse>({
    url: '/api/digital-employees',
    params
  })
  return (response.agents ?? []).map(normalizeAgent)
}

export async function getAgent(id: string): Promise<DigitalEmployee> {
  const response = await httpClient.get<DigitalEmployeeResponse>({
    url: `/api/digital-employees/${encodeURIComponent(id)}`
  })
  if (!response.agent) throw new Error('数字员工不存在')
  return normalizeAgent(response.agent)
}

export function createAgent(data: Partial<DigitalEmployee> & { name: string }) {
  return httpClient.post<DigitalEmployee>({ url: '/api/digital-employees', data })
}

export function updateAgent(id: string, data: Partial<DigitalEmployee>) {
  return httpClient.request<DigitalEmployeeResponse>({
    url: `/api/digital-employees/${encodeURIComponent(id)}`,
    method: 'PUT',
    data
  })
}

export function deleteAgent(id: string) {
  return httpClient.del<unknown>({ url: `/api/digital-employees/${encodeURIComponent(id)}` })
}

interface SkillsResponse {
  skills?: SkillPackage[]
}

export async function getSkills(params?: { q?: string; scope?: string }): Promise<SkillPackage[]> {
  const response = await httpClient.get<SkillsResponse>({
    url: '/api/skills/search',
    params
  })
  return response.skills ?? []
}

interface McpServersResponse {
  servers?: McpServer[]
}

export async function getMcpServers(params?: { scope?: string; teamId?: string }): Promise<McpServer[]> {
  const response = await httpClient.get<McpServersResponse>({
    url: '/api/admin/mcp',
    params
  })
  return response.servers ?? []
}
