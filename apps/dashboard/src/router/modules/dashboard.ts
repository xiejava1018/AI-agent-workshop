import { AppRouteRecord } from '@/types/router'

/**
 * 工作区模块 —— 单独的顶级路由(避免嵌在 /dashboard/* 下面,与现存路由兼容)。
 * 老实现只有 dashboardRoutes 本体,这里补 workbench + workspace/agent 别名两个顶级路由,
 * 以便菜单点击 + URL 直接访问(`#/workspace/agent`)同时可用。
 */
export const workbenchRoutes: AppRouteRecord[] = [
  {
    path: '/workspace/agent',
    name: 'AgentWorkbench',
    component: '/agent-workbench/index',
    meta: {
      title: 'Agent 工作台',
      icon: 'ri:robot-line',
      keepAlive: false,
      fixedTab: false,
      roles: ['R_SUPER', 'R_ADMIN']
    }
  }
]

export const dashboardRoutes: AppRouteRecord = {
  name: 'Dashboard',
  path: '/dashboard',
  component: '/index/index',
  meta: {
    title: 'menus.dashboard.title',
    icon: 'ri:pie-chart-line',
    roles: ['R_SUPER', 'R_ADMIN']
  },
  children: [
    {
      path: 'console',
      name: 'Console',
      component: '/dashboard/console',
      meta: {
        title: 'menus.dashboard.console',
        keepAlive: false,
        fixedTab: true
      }
    },
    {
      path: 'workbench',
      name: 'AgentWorkbenchAlias',
      component: '/agent-workbench/index',
      meta: {
        title: 'Agent 工作台',
        icon: 'ri:robot-line',
        keepAlive: false,
        fixedTab: false,
        isHide: true
      }
    }
  ]
}