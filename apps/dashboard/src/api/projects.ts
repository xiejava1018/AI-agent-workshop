/**
 * 项目(Project) API 封装。
 *
 * 对应后端:
 *   GET    /api/projects           列出当前用户加入的所有团队下的项目
 *   POST   /api/projects           创建项目(需 TeamMember.OWNER/ADMIN)
 *   GET    /api/projects/[id]      (未实现,暂不需要)
 *   POST   /api/projects/[id]/bind 绑定到当前用户的 lastProjectId
 *
 * 设计说明:
 *   - 后端 agent/new 路由要求 user.lastProjectId 已绑定才能新建会话;
 *     前端 workbench 通过 ProjectPicker 让用户选择/切换项目;
 *   - "当前已绑定项目"信息来自 user.lastProjectId,经 GET /api/projects 拿到的列表
 *     里 id === lastProjectId 的就是当前项目。前端没有直接查 lastProjectId 的接口,
 *     而是从 useUserStore().info.lastProjectId 读取(由 /api/auth/me 提供)。
 */
import request from '@/utils/http'
import type { HttpClient } from '@/utils/http'

const httpClient = request as HttpClient

/** 后端 Project 行(camelCase)。 */
export interface ProjectItem {
  id: string
  teamId: string
  name: string
  rootPath: string
  createdBy: string
  createdAt: string
}

/** GET /api/projects 响应。 */
interface ListProjectsResponse {
  projects: ProjectItem[]
}

/** POST /api/projects/[id]/bind 响应。 */
interface BindProjectResponse {
  ok: boolean
  lastProjectId: string
}

/**
 * 列出当前用户加入的所有团队下的项目。
 * 后端不需要任何特殊权限,任何登录用户都能拿到自己可见的项目。
 */
export function listProjects(): Promise<ProjectItem[]> {
  return httpClient
    .get<ListProjectsResponse>({
      url: '/api/projects',
      keepFullResponse: true,
      showErrorMessage: false
    })
    .then((res) => {
      const data = (res ?? {}) as ListProjectsResponse
      return Array.isArray(data.projects) ? data.projects : []
    })
}

/**
 * 绑定项目到当前用户的 lastProjectId。
 * 后端会校验:用户必须是该项目所属 team 的 TeamMember。
 *
 * 成功后,调用方应同步更新 useUserStore().info.lastProjectId,让 UI 立即反映,
 * 不需要等下一次 /api/auth/me 拉取。
 */
export function bindProject(projectId: string): Promise<BindProjectResponse> {
  return httpClient.post<BindProjectResponse>({
    url: `/api/projects/${encodeURIComponent(projectId)}/bind`,
    keepFullResponse: true
  })
}

/**
 * 创建项目(需 TeamMember.OWNER/ADMIN 角色)。
 *
 * @param name      项目显示名
 * @param rootPath  项目根目录绝对路径(必须已存在于文件系统)
 */
export function createProject(name: string, rootPath: string): Promise<ProjectItem> {
  return httpClient
    .post<{ project: ProjectItem }>({
      url: '/api/projects',
      data: { name, root_path: rootPath },
      keepFullResponse: true
    })
    .then((res) => (res as { project: ProjectItem }).project)
}
