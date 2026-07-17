/**
 * 路由鉴权守卫模块
 *
 * 提供简单的登录状态验证和重定向功能
 *
 * ## 主要功能
 *
 * - 检查用户登录状态
 * - 未登录用户重定向到登录页
 * - 放行已登录用户或静态路由
 *
 * ## 工作流程
 *
 * 1. 检查目标路径是否为静态路由（放行）
 * 2. 检查用户是否已登录（已登录则放行）
 * 3. 未登录则重定向到登录页，并携带原始路径作为 redirect 参数
 *
 * @module router/guards/auth
 */
import type { Router } from 'vue-router'
import { useUserStore } from '@/store/modules/user'
import { RoutesAlias } from '../routesAlias'
import { staticRoutes } from '../routes/staticRoutes'

/**
 * 检查路径是否为静态路由
 * 静态路由不需要登录即可访问
 */
function isStaticRoute(path: string): boolean {
  const checkRoute = (routes: any[], targetPath: string): boolean => {
    return routes.some((route) => {
      // 异常页面不需要登录
      if (route.name === 'Exception404' || route.name === 'Exception403') {
        return false
      }

      // 处理动态路由参数匹配
      const routePath = route.path
      const pattern = routePath.replace(/:[^/]+/g, '[^/]+').replace(/\*/g, '.*')
      const regex = new RegExp(`^${pattern}$`)

      if (regex.test(targetPath)) {
        return true
      }
      if (route.children && route.children.length > 0) {
        return checkRoute(route.children, targetPath)
      }
      return false
    })
  }

  return checkRoute(staticRoutes, path)
}

/**
 * 设置路由全局前置守卫
 * 验证用户是否已登录，未登录则跳转到登录页
 */
export function setupAuthGuard(router: Router): void {
  router.beforeEach((to, _from, next) => {
    const userStore = useUserStore()

    // 已登录或访问登录页或静态路由，直接放行
    if (userStore.isLogin || to.path === RoutesAlias.Login || isStaticRoute(to.path)) {
      next()
      return
    }

    // 未登录且访问需要权限的页面，跳转到登录页并携带 redirect 参数
    next({
      name: 'Login',
      query: { redirect: to.fullPath }
    })
  })
}
