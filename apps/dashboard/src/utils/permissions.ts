/**
 * 纯权限码校验工具(无副作用、无 store 依赖)。
 *
 * userStore.hasPermission / hasAnyPermission 委托至此,使权限判断逻辑可在
 * 单测中针对真实代码锁定契约(而非在测试里重新声明)。
 *
 * @module utils/permissions
 */

/**
 * 判断权限码集合中是否包含指定 code。
 * 空集合(permissions 未加载)返回 false。
 */
export function hasPermission(permissions: Set<string>, code: string): boolean {
  return permissions.has(code)
}

/**
 * 判断权限码集合中是否包含给定 codes 中的任意一个(OR 语义)。
 * codes 为空数组时返回 false。
 */
export function hasAnyPermission(permissions: Set<string>, codes: string[]): boolean {
  return codes.some((c) => permissions.has(c))
}
