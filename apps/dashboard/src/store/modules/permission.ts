/**
 * 权限状态管理模块
 *
 * 提供基于角色的菜单权限控制功能
 *
 * ## 主要功能
 *
 * - 角色类型定义
 * - 菜单项类型定义
 * - 根据用户角色返回可访问菜单
 *
 * ## 角色说明
 *
 * - PLATFORM_ADMIN: 平台管理员，可访问平台管理菜单
 * - OWNER: 团队所有者，可访问团队管理菜单
 * - ADMIN: 团队管理员，可访问团队管理菜单
 * - MEMBER: 普通成员，仅可访问通用菜单
 *
 * @module store/modules/permission
 */

/** 角色类型 */
export type Role = 'PLATFORM_ADMIN' | 'OWNER' | 'ADMIN' | 'MEMBER'

/** 菜单项接口 */
export interface MenuItem {
  key: string
  label: string
  icon?: string
  children?: MenuItem[]
}

/**
 * 根据用户角色返回可访问菜单
 * @param role 用户角色
 * @returns 菜单项数组
 */
export function getMenuByRole(role: Role): MenuItem[] {
  // 所有用户都可访问的通用菜单
  const common: MenuItem[] = [
    { key: '/workspace', label: '工作空间', icon: 'HomeOutlined' },
    { key: '/agents', label: '数字员工', icon: 'RobotOutlined' },
    { key: '/skills', label: '技能中心', icon: 'ThunderboltOutlined' },
    { key: '/settings', label: '我的设置', icon: 'SettingOutlined' }
  ]

  // OWNER 和 ADMIN 可访问团队管理
  if (role === 'OWNER' || role === 'ADMIN') {
    common.push({ key: '/team', label: '团队管理', icon: 'TeamOutlined' })
  }

  // PLATFORM_ADMIN 可访问平台管理菜单
  if (role === 'PLATFORM_ADMIN') {
    common.push(
      { key: '/platform', label: '平台管理', icon: 'SettingOutlined' },
      { key: '/platform/users', label: '用户管理' },
      { key: '/platform/audit', label: '审计日志' },
      { key: '/platform/models', label: '模型配置' },
      { key: '/platform/mcp', label: 'MCP 管理' },
      { key: '/platform/skills', label: '技能精选库' }
    )
  }

  return common
}

/**
 * 判断用户角色是否为平台管理员
 * @param role 用户角色
 * @returns 是否为平台管理员
 */
export function isPlatformAdmin(role: Role | string): boolean {
  return role === 'PLATFORM_ADMIN'
}

/**
 * 判断用户角色是否为团队所有者或管理员
 * @param role 用户角色
 * @returns 是否为团队所有者或管理员
 */
export function isTeamAdmin(role: Role | string): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}
