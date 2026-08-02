import request from '@/utils/http'
import type { HttpClient } from '@/utils/http'

const httpClient = request as HttpClient

const API_PREFIX = '/api/v1'

type BackendListResponse<T> = Http.BaseResponse<T[]> & {
  total?: number
  current?: number
  page?: number
  pageSize?: number
  size?: number
}

// 适配 useTable 内部的分页字段(useTable 全局 pageKey='current' / sizeKey='size'),把
//  `current`/`size` 优先映射为后端约定的 `page`/`pageSize`。
//
// 关键点:**必须让 `current`/`size` 覆盖 `page`/`pageSize`**,否则页面用 useTable 时
// `apiParams:` 里若显式给了 `page:1`/`pageSize:10`,即使 `useTable` 在翻页时把
// `current` 改成 2,仍会沿用 `page=1`,导致翻页请求永远是 page=1(用户观察到的
// "翻页无效果" bug)。
//
// 保留向下兼容:仍允许调用方直接传 `page`/`pageSize`(非 useTable 场景),但当两个
// 字段都存在时,`current`/`size` 优先。
const normalizePaginationParams = (params?: Record<string, any>) => {
  if (!params) return undefined
  const { current, size, page, pageSize, ...rest } = params

  // current 优先 page:useTable 翻页时只会更新 current,page 在 apiParams 中是
  // 初始值,如果不优先 current,翻页就被 apiParams 里的 page 锁死。
  const resolvedPage = current !== undefined ? current : page ?? 1
  const resolvedPageSize = size !== undefined ? size : pageSize ?? 10

  return {
    ...rest,
    page: resolvedPage,
    pageSize: resolvedPageSize
  }
}

// ========== 菜单管理 ==========

// 工具:把后端 {code, message, data: [...] / T} 包装解为内层 data
// 供菜单相关 API 复用(它们都需要返数组/对象本体)
function unwrapData<T>(p: Promise<{ code: number; message: string; data: T }>): Promise<T> {
  return p.then((res) => res.data)
}

// 工具:把后端 M4 SysMenu 节点适配为菜单管理表格期望的格式
// (formatter 读 row.meta.title / row.meta.isEnable / row.meta.authList)
function adaptMenuNode(node: any): any {
  if (!node) return node
  return {
    ...node,
    meta: {
      title: node.title,
      isEnable: node.enabled,
      isHide: !node.visible,
      authList: node.menuAuths ?? [],
      ...(node.meta || {})
    }
  }
}

function adaptMenuList<T extends { children?: any[] } | any[]>(data: T): T {
  if (!data) return data
  // tree 形态(数组,可能有嵌套 children)
  if (Array.isArray(data)) {
    return data.map((n) => adaptMenuNode({ ...n, children: adaptMenuList(n.children || []) })) as unknown as T
  }
  return adaptMenuNode(data) as T
}

export const getUserMenu = (): Promise<any[]> => {
  return unwrapData(
    httpClient.get<{ code: number; message: string; data: any[] }>({
      url: `${API_PREFIX}/menus/tree`,
      keepFullResponse: true,
      showErrorMessage: false
    })
  ).then(adaptMenuList)
}

export const getAllMenu = (): Promise<any[]> => {
  return unwrapData(
    httpClient.get<{ code: number; message: string; data: any[] }>({
      url: `${API_PREFIX}/menus/tree`,
      keepFullResponse: true,
      showErrorMessage: false
    })
  ).then(adaptMenuList)
}

export const addMenu = (data: any): Promise<any> => {
  return httpClient.post({ url: `${API_PREFIX}/menus`, data })
}

export const updateMenu = (id: number, data: any): Promise<any> => {
  return httpClient.put({ url: `${API_PREFIX}/menus/${id}`, data })
}

export const deleteMenu = (id: string | number): Promise<Http.BaseResponse<unknown>> => {
  return httpClient.del({
    url: `${API_PREFIX}/menus/${id}`,
    keepFullResponse: true
  })
}

// ========== 角色管理 ==========

export const getRoleList = (
  params?: Record<string, any>
): Promise<BackendListResponse<Api.SystemManage.RoleListItem>> => {
  return httpClient.get({
    url: `${API_PREFIX}/roles`,
    params: normalizePaginationParams(params),
    keepFullResponse: true
  })
}

export const addRole = (data: any): Promise<any> => {
  return httpClient.post({ url: `${API_PREFIX}/roles`, data })
}

export const updateRole = (id: number | string, data: any): Promise<any> => {
  return httpClient.put({ url: `${API_PREFIX}/roles/${id}`, data })
}

export const deleteRole = (id: number | string): Promise<any> => {
  return httpClient.del({ url: `${API_PREFIX}/roles/${id}` })
}

export const getRoleMenus = (roleID: number): Promise<Http.BaseResponse<any>> => {
  return httpClient.get({
    url: `${API_PREFIX}/roles/${roleID}/menus`,
    keepFullResponse: true
  })
}

export const assignRoleMenus = (roleID: number, data: any): Promise<any> => {
  return httpClient.put({ url: `${API_PREFIX}/roles/${roleID}/menus`, data })
}

// ========== 用户管理 ==========

export const getUserList = (
  params: Record<string, any>
): Promise<BackendListResponse<Api.SystemManage.UserListItem>> => {
  return httpClient.get({
    url: `${API_PREFIX}/users`,
    params: normalizePaginationParams(params),
    keepFullResponse: true
  })
}

export const addUser = (data: any): Promise<any> => {
  return httpClient.post({ url: `${API_PREFIX}/users`, data })
}

export const updateUser = (id: number | string, data: any): Promise<any> => {
  return httpClient.put({ url: `${API_PREFIX}/users/${id}`, data })
}

export const deleteUser = (id: number | string): Promise<any> => {
  return httpClient.del({ url: `${API_PREFIX}/users/${id}` })
}

/**
 * 给用户绑定全局角色（差量替换）。
 * 后端路由：PUT /api/v1/users/{id}/roles —— body: { roleCodes: string[] }。
 * id 既接收 number 也接收 cuid 字符串。
 */
export const assignUserRoles = (
  id: number | string,
  roleCodes: string[]
): Promise<any> => {
  return httpClient.put({ url: `${API_PREFIX}/users/${id}/roles`, data: { roleCodes } })
}

/**
 * 管理员给指定用户设置密码（创建/编辑用户表单使用）。
 * 后端路由: PUT /api/v1/users/{id}/password —— body: { password: string }。
 * 与 reset-password 的区别:这个接口是「管理员在前端表单中明文指定」的绝
 * 对密码,后端 bcrypt 哈希后设 mustChangePassword=false;
 * reset-password 是「生成随机密码并返回给管理员」,mustChangePassword=true。
 */
export const setUserPassword = (
  id: number | string,
  password: string
): Promise<any> => {
  return httpClient.put({
    url: `${API_PREFIX}/users/${id}/password`,
    data: { password }
  })
}

// ========== 菜单元素权限 (后端暂不支持, 保留接口占位) ==========

export const getAuthList = (menuID: number): Promise<any> => {
  console.warn('[API] 菜单元素权限接口后端暂不支持')
  return Promise.resolve([])
}

export const addAuth = (data: any): Promise<any> => {
  console.warn('[API] 菜单元素权限接口后端暂不支持')
  return Promise.resolve({ code: 200, msg: 'success', data: null } as any)
}

export const updateAuth = (data: any): Promise<any> => {
  console.warn('[API] 菜单元素权限接口后端暂不支持')
  return Promise.resolve({ code: 200, msg: 'success', data: null } as any)
}

export const deleteAuth = (id: number): Promise<any> => {
  console.warn('[API] 菜单元素权限接口后端暂不支持')
  return Promise.resolve({ code: 200, msg: 'success', data: null } as any)
}

// ========== 登录日志 ==========

export const getLoginLogList = (params?: any): Promise<any> => {
  console.warn('[API] 登录日志接口后端暂不支持')
  return Promise.resolve({ code: 200, msg: 'success', data: { total: 0, items: [] } } as any)
}

// ========== 兼容别名 ==========

/** @deprecated 请使用 getRoleMenus */
export const getAllMenuByRole = getRoleMenus

/**
 * 保存角色菜单权限（兼容旧格式）
 * 将前端传来的 { role_id, menu_data } 转换为后端需要的 { menu_ids, menu_permissions }
 */
export const saveRolePermission = (data: any): Promise<any> => {
  const roleId = data.role_id
  const menuData = typeof data.menu_data === 'string' ? JSON.parse(data.menu_data) : data.menu_data

  const extractIds = (menus: any[]): number[] => {
    const ids: number[] = []
    for (const menu of menus) {
      if (menu.hasPermission && menu.id && !isNaN(Number(menu.id))) {
        ids.push(Number(menu.id))
      }
      if (menu.children && menu.children.length > 0) {
        ids.push(...extractIds(menu.children))
      }
    }
    return [...new Set(ids)]
  }

  const extractPermissions = (menus: any[]): any[] => {
    const perms: any[] = []
    for (const menu of menus) {
      if (menu.id && !isNaN(Number(menu.id)) && menu.meta?.authList && menu.meta.authList.length > 0) {
        const granted = menu.meta.authList
          .filter((a: any) => a.hasPermission)
          .map((a: any) => a.authMark)
        if (granted.length > 0) {
          perms.push({ menu_id: Number(menu.id), permissions: granted })
        }
      }
      if (menu.children && menu.children.length > 0) {
        perms.push(...extractPermissions(menu.children))
      }
    }
    return perms
  }

  const menuList = Array.isArray(menuData) ? menuData : []
  const menuIds = extractIds(menuList)
  const menuPermissions = extractPermissions(menuList)
  return assignRoleMenus(roleId, { menu_ids: menuIds, menu_permissions: menuPermissions })
}
