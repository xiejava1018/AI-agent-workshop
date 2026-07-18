import request from '@/utils/http'
import { AppRouteRecord } from '@/types/router'
import { asyncRoutes } from '@/router/routes/asyncRoutes'
import { RoutesAlias } from '@/router/routesAlias'
import { menuDataToRouter } from '@/router/utils/menuToRouter'

type BackendListResponse<T> = Http.BaseResponse<T[]> & {
  total?: number
  current?: number
  page?: number
  pageSize?: number
  size?: number
}

const normalizePaginationParams = (params: Record<string, any>) => {
  const { current, size, page, pageSize, ...rest } = params

  return {
    ...rest,
    page: page ?? current ?? 1,
    pageSize: pageSize ?? size ?? 10
  }
}

// 后端菜单字段映射到前端路由格式
interface BackendMenuItem {
  id: number
  name: string
  title?: string
  path: string
  icon?: string
  component?: string
  sort_order?: number
  is_visible?: boolean
  parent_id?: number | null
  children?: BackendMenuItem[]
}

/**
 * 将后端菜单转换为前端路由格式
 *
 * 后端数据结构：
 * - 父菜单：path 为绝对路径（如 /system），component 为 /index/index（Layout）
 * - 子菜单：path 为相对路径（如 users），component 为实际组件路径（如 /system/user）
 * - 占位菜单：component 为 /placeholder
 */
function backendMenuToRoute(menu: BackendMenuItem): AppRouteRecord {
  const hasChildren = menu.children && menu.children.length > 0

  // 直接使用后端返回的 component（已转换为实际路径）
  const component = menu.component || (hasChildren ? RoutesAlias.Layout : '')

  return {
    name: menu.name,
    path: menu.path,
    component,
    meta: {
      title: menu.title || menu.name,
      icon: menu.icon,
      keepAlive: !hasChildren,
      isHide: menu.is_visible === false,
      isHideTab: menu.is_visible === false
    },
    children: hasChildren ? menu.children!.map((child) => backendMenuToRoute(child)) : undefined
  }
}

// 获取用户列表
export function fetchGetUserList(
  params: Api.SystemManage.UserSearchParams = {}
): Promise<BackendListResponse<Api.SystemManage.UserListItem>> {
  return request.get<BackendListResponse<Api.SystemManage.UserListItem>>({
    url: '/api/v1/users',
    params: normalizePaginationParams(params as Record<string, any>),
    keepFullResponse: true,
    showErrorMessage: false
  })
}

// 获取角色列表
export function fetchGetRoleList(
  params: Api.SystemManage.RoleSearchParams = {}
): Promise<BackendListResponse<Api.SystemManage.RoleListItem>> {
  return request.get<BackendListResponse<Api.SystemManage.RoleListItem>>({
    url: '/api/v1/roles',
    params: normalizePaginationParams(params as Record<string, any>),
    keepFullResponse: true,
    showErrorMessage: false
  })
}

interface MenuResponse {
  menuList: AppRouteRecord[]
}

// M4 后端 user-menu 节点(已被服务端按权限码过滤)
interface BackendUserMenuNode {
  id: string
  parentId: string | null
  name: string
  title: string
  path: string
  component: string
  icon?: string
  type: string
  authMark?: string
  sort?: number
  visible?: boolean
  enabled?: boolean
  meta?: Record<string, unknown>
  children?: BackendUserMenuNode[]
}

// 将 M4 后端 user-menu 节点转为前端路由格式
function userMenuNodeToRoute(node: BackendUserMenuNode): AppRouteRecord {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0
  return {
    name: node.name,
    path: node.path,
    component: node.component || (node.type === 'directory' || hasChildren ? RoutesAlias.Layout : ''),
    meta: {
      title: node.title || node.name,
      icon: node.icon,
      keepAlive: !hasChildren,
      isHide: node.visible === false,
      isHideTab: node.visible === false,
      authList: [],
      ...(node.meta || {})
    },
    children: hasChildren ? node.children!.map(userMenuNodeToRoute) : undefined
  }
}

// 获取当前用户菜单树(M4 RBAC)
// 改:原实现读本地 asyncRoutes(等于 Soybean 硬编码);
// 现改为调真实后端 /api/v1/menus/user-menu(服务端按 platform:access/角色权限码过滤)
export async function fetchGetMenuList(): Promise<MenuResponse> {
  const res = await request.get<{ code: number; message: string; data: BackendUserMenuNode[] }>({
    url: '/api/v1/menus/user-menu',
    keepFullResponse: true,
    showErrorMessage: false
  })
  const list = Array.isArray(res?.data) ? res.data : []
  return { menuList: list.map(userMenuNodeToRoute) }
}
