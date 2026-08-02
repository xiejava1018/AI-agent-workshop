/**
 * team.ts —— 团队相关 API 封装(对齐后端真实契约)。
 *
 * 后端路由对照:
 *   GET    /api/admin/teams                列所有团队(platform_admin)
 *   POST   /api/admin/teams                创建团队(platform_admin)
 *   GET    /api/admin/teams/[id]           团队详情含成员(platform_admin)
 *   PUT    /api/admin/teams/[id]           改团队配额(platform_admin)
 *   DELETE /api/admin/teams/[id]           删除团队(platform_admin)
 *   POST   /api/admin/teams/[id]/members   加成员(team_owner/admin/platform)
 *   PUT    /api/admin/teams/[id]/members/[userId]  改成员角色
 *   DELETE /api/admin/teams/[id]/members/[userId]  删成员
 *   POST   /api/admin/teams/[id]/invite-links      生成邀请链接
 *   GET    /api/teams/my                   我加入的团队
 *   GET    /api/teams/[id]                 团队详情含成员(team 成员可见)
 *   GET    /api/teams/[id]/projects        团队下项目(team 成员可见)
 *   POST   /api/teams/[id]/projects        创建项目(team OWNER/ADMIN)
 */
import request from '@/utils/http'
import type { HttpClient } from '@/utils/http'

const httpClient = request as HttpClient

// ====== 类型 ======

/** 后端团队列表项(GET /api/admin/teams)。 */
export interface AdminTeamListItem {
  id: string
  name: string
  ownerUserId: string
  ownerUsername: string | null
  tokenDailyLimit: number
  maxConcurrentSessions: number
  createdAt: string
  memberCount: number
}

/** 后端团队详情含成员(GET /api/admin/teams/[id] 与 GET /api/teams/[id] 同 shape)。 */
export interface TeamMemberItem {
  userId: string
  username: string
  disabled: boolean
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  joinedAt: string
  isOwner: boolean
}

export interface TeamDetail {
  id: string
  name: string
  ownerUserId: string
  tokenDailyLimit: number
  maxConcurrentSessions: number
  createdAt: string
  members: TeamMemberItem[]
}

/** /api/teams/my 返回项。 */
export interface MyTeamItem {
  id: string
  name: string
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
}

/** @deprecated 使用 MyTeamItem,保留向后兼容。 */
export type TeamOption = MyTeamItem

/** /api/teams/[id]/projects 与 /api/projects 返回项。 */
export interface TeamProjectItem {
  id: string
  teamId: string
  name: string
  rootPath: string
  createdBy: string
  createdAt: string
}

// ====== platform_admin: /api/admin/teams ======

/** 列出所有团队(platform_admin)。 */
export async function adminListTeams(): Promise<AdminTeamListItem[]> {
  const res = await httpClient.get<{ teams: AdminTeamListItem[] }>({
    url: '/api/admin/teams',
    params: { page: 1, limit: 100 },
    keepFullResponse: true,
    showErrorMessage: false
  })
  return (res?.teams ?? []) as AdminTeamListItem[]
}

/** 创建团队(platform_admin)。 */
export async function adminCreateTeam(name: string, ownerUserId: string): Promise<AdminTeamListItem> {
  const res = await httpClient.post<{ team: AdminTeamListItem }>({
    url: '/api/admin/teams',
    data: { name, ownerUserId },
    keepFullResponse: true
  })
  return res.team
}

/** 团队详情含成员(platform_admin)。 */
export async function adminGetTeam(teamId: string): Promise<TeamDetail> {
  const res = await httpClient.get<{ team: TeamDetail }>({
    url: `/api/admin/teams/${teamId}`,
    keepFullResponse: true,
    showErrorMessage: false
  })
  return res.team
}

/** 更新团队配额(platform_admin)。 */
export async function adminUpdateTeam(
  teamId: string,
  data: { name?: string; tokenDailyLimit?: number; maxConcurrentSessions?: number }
): Promise<void> {
  await httpClient.put({
    url: `/api/admin/teams/${teamId}`,
    data,
    keepFullResponse: true
  })
}

/** 删除团队(platform_admin)。 */
export async function adminDeleteTeam(teamId: string): Promise<void> {
  await httpClient.del({
    url: `/api/admin/teams/${teamId}`,
    keepFullResponse: true
  })
}

// ====== 成员管理(共用,team_owner/admin/platform 都能调) ======

/** 添加成员到团队。 */
export async function addTeamMember(
  teamId: string,
  userId: string,
  role: 'ADMIN' | 'MEMBER' = 'MEMBER'
): Promise<TeamMemberItem> {
  const res = await httpClient.post<{ member: TeamMemberItem }>({
    url: `/api/admin/teams/${teamId}/members`,
    data: { userId, role },
    keepFullResponse: true
  })
  return res.member
}

/** 修改成员角色(不能改 owner)。 */
export async function updateMemberRole(
  teamId: string,
  userId: string,
  role: 'ADMIN' | 'MEMBER'
): Promise<TeamMemberItem> {
  const res = await httpClient.put<{ member: TeamMemberItem }>({
    url: `/api/admin/teams/${teamId}/members/${userId}`,
    data: { role },
    keepFullResponse: true
  })
  return res.member
}

/** 删除成员(不能删 owner)。 */
export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  await httpClient.del({
    url: `/api/admin/teams/${teamId}/members/${userId}`,
    keepFullResponse: true
  })
}

/** 生成邀请链接(7 天有效)。 */
export async function createInviteLink(teamId: string): Promise<string> {
  const res = await httpClient.post<{ url?: string; link?: string }>({
    url: `/api/admin/teams/${teamId}/invite-links`,
    data: {},
    keepFullResponse: true
  })
  // 兼容后端两种字段名
  return (res?.url ?? res?.link ?? '') as string
}

// ====== 我的团队(任意登录用户) ======

/** 我加入的团队。 */
export async function listMyTeams(): Promise<MyTeamItem[]> {
  const res = await request.get<{ teams?: MyTeamItem[] }>({
    url: '/api/teams/my',
    showErrorMessage: false
  })
  return (res?.teams ?? []) as MyTeamItem[]
}

// ====== 团队自查(team 成员可见) ======

/** 团队详情(团队任意成员可看)。 */
export async function getTeam(teamId: string): Promise<TeamDetail> {
  const res = await httpClient.get<{ team: TeamDetail }>({
    url: `/api/teams/${teamId}`,
    keepFullResponse: true,
    showErrorMessage: false
  })
  return res.team
}

/** 团队下项目(团队任意成员可看)。 */
export async function listTeamProjects(teamId: string): Promise<TeamProjectItem[]> {
  const res = await httpClient.get<{ projects: TeamProjectItem[] }>({
    url: `/api/teams/${teamId}/projects`,
    keepFullResponse: true,
    showErrorMessage: false
  })
  return (res?.projects ?? []) as TeamProjectItem[]
}

/** 在团队下创建项目(team OWNER/ADMIN)。 */
export async function createTeamProject(
  teamId: string,
  name: string,
  rootPath: string
): Promise<TeamProjectItem> {
  const res = await httpClient.post<{ project: TeamProjectItem }>({
    url: `/api/teams/${teamId}/projects`,
    data: { name, rootPath },
    keepFullResponse: true
  })
  return res.project
}

// ====== 通用辅助 ======

/** 取所有团队(platform_admin)或我的团队(普通用户),用于下拉选择。 */
export async function listTeamsForPicker(
  isPlatformAdmin: boolean
): Promise<Array<{ id: string; name: string; role?: string }>> {
  return isPlatformAdmin ? adminListTeams() : listMyTeams()
}

/** 角色显示名。 */
export function roleLabel(role: string): string {
  switch (role) {
    case 'OWNER':
      return '所有者'
    case 'ADMIN':
      return '管理员'
    case 'MEMBER':
      return '成员'
    default:
      return role
  }
}
