#!/usr/bin/env -S npx tsx
/**
 * SysMenu 种子脚本(幂等)
 *
 * 设计:openspec/changes/m4-rbac-platform/design.md §6
 * 来源:docs/ui-design/index.html 导航结构(13 屏)
 *
 * 菜单可见性规则:
 *   meta.permissions = []                      → 公共菜单(所有登录用户可见)
 *   meta.permissions = ["user:view", ...]      → 用户必须拥有其中至少一个权限码
 *   父目录菜单无 component,只看子菜单级联
 *
 * 运行:cd apps/web && pnpm tsx prisma/seed/menus.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type ChildSeed = {
  name: string;
  title: string;
  path: string;
  component: string;
  sort: number;
  /** 可见性所需的权限码,空数组=公共 */
  permissionCodes: string[];
};

type ParentSeed = {
  name: string;
  title: string;
  path: string;
  icon: string;
  sort: number;
  children: ChildSeed[];
};

const MENUS: ParentSeed[] = [
  {
    name: "workspace",
    title: "工作区",
    path: "/workspace",
    icon: "HomeOutlined",
    sort: 1,
    children: [
      {
        name: "home",
        title: "工作空间",
        path: "/workspace",
        component: "/workspace/index",
        sort: 1,
        permissionCodes: [],
      },
      {
        name: "agent-workbench",
        title: "Agent 工作台",
        path: "/workspace/agent",
        component: "/agent-workbench/index",
        sort: 2,
        permissionCodes: ["session:view"],
      },
      {
        name: "orchestration",
        title: "多 Agent 编排",
        path: "/workspace/orchestrate",
        component: "/orchestration/index",
        sort: 3,
        permissionCodes: ["session:view", "agent:view"],
      },
    ],
  },
  {
    name: "my-resources",
    title: "我的资源",
    path: "/my",
    icon: "UserOutlined",
    sort: 2,
    children: [
      {
        name: "digital-employees",
        title: "数字员工",
        path: "/agents",
        component: "/digital-employees/index",
        sort: 1,
        permissionCodes: ["agent:view"],
      },
      {
        name: "skill-center",
        title: "技能中心",
        path: "/skills",
        component: "/skill-center/index",
        sort: 2,
        permissionCodes: ["skill:view"],
      },
      {
        name: "my-settings",
        title: "我的设置",
        path: "/settings",
        component: "/settings/index",
        sort: 3,
        permissionCodes: [],
      },
    ],
  },
  {
    name: "team",
    title: "团队",
    path: "/team",
    icon: "TeamOutlined",
    sort: 3,
    children: [
      {
        name: "team-management",
        title: "团队管理",
        path: "/team",
        component: "/team/index",
        sort: 1,
        permissionCodes: ["team:view"],
      },
    ],
  },
  {
    name: "platform",
    title: "平台管理",
    path: "/platform",
    icon: "SettingOutlined",
    sort: 4,
    children: [
      {
        name: "platform-users",
        title: "用户管理",
        path: "/system/user",
        component: "/system/user/index",
        sort: 1,
        permissionCodes: ["user:view"],
      },
      {
        name: "platform-roles",
        title: "角色管理",
        path: "/system/role",
        component: "/system/role/index",
        sort: 2,
        permissionCodes: ["role:view"],
      },
      {
        name: "platform-menus",
        title: "菜单管理",
        path: "/system/menu",
        component: "/system/menu/index",
        sort: 3,
        permissionCodes: ["menu:view"],
      },
      {
        name: "platform-models",
        title: "模型配置",
        path: "/admin/models",
        component: "/platform/index",
        sort: 4,
        permissionCodes: ["model:view"],
      },
      {
        name: "platform-mcp",
        title: "MCP 精选库",
        path: "/admin/mcp",
        component: "/platform/index",
        sort: 5,
        permissionCodes: ["mcp:view"],
      },
      {
        name: "platform-skill",
        title: "技能精选库",
        path: "/admin/skill",
        component: "/platform/index",
        sort: 6,
        permissionCodes: ["skill:view"],
      },
      {
        name: "platform-agenttpl",
        title: "数字员工模板",
        path: "/admin/agenttpl",
        component: "/platform/index",
        sort: 7,
        permissionCodes: ["agent:view"],
      },
      {
        name: "platform-audit",
        title: "审计日志",
        path: "/system/audit-log",
        component: "/system/audit-log/index",
        sort: 8,
        permissionCodes: ["audit:view"],
      },
      {
        name: "platform-monitor",
        title: "监控大盘",
        path: "/admin/monitor",
        component: "/platform/index",
        sort: 9,
        permissionCodes: ["monitor:view"],
      },
    ],
  },
];

async function upsertParent(parent: ParentSeed) {
  const existing = await prisma.sysMenu.findFirst({
    where: { parentId: null, name: parent.name },
  });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`  [skip] parent '${parent.name}' exists`);
    return existing;
  }
  return prisma.sysMenu.create({
    data: {
      name: parent.name,
      title: parent.title,
      path: parent.path,
      icon: parent.icon,
      type: "directory",
      sort: parent.sort,
      parentId: null,
      meta: JSON.stringify({ permissions: [] }),
    },
  });
}

async function upsertChild(parentId: string, child: ChildSeed) {
  const existing = await prisma.sysMenu.findFirst({
    where: { parentId, name: child.name },
  });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`  [skip] child '${child.name}' exists`);
    return existing;
  }
  return prisma.sysMenu.create({
    data: {
      name: child.name,
      title: child.title,
      path: child.path,
      component: child.component,
      type: "menu",
      sort: child.sort,
      parentId,
      meta: JSON.stringify({ permissions: child.permissionCodes }),
    },
  });
}

async function main() {
  for (const parent of MENUS) {
    // eslint-disable-next-line no-console
    console.log(`\n[parent] ${parent.name}`);
    const created = await upsertParent(parent);
    for (const child of parent.children) {
      // eslint-disable-next-line no-console
      console.log(`  [child] ${child.name}`);
      await upsertChild(created.id, child);
    }
  }

  // 统计
  const total = await prisma.sysMenu.count();
  const parents = await prisma.sysMenu.count({ where: { type: "directory" } });
  const children = await prisma.sysMenu.count({ where: { type: "menu" } });
  // eslint-disable-next-line no-console
  console.log("\n" + "=".repeat(60));
  // eslint-disable-next-line no-console
  console.log(`Menu seed done. total=${total} parents=${parents} children=${children}`);
  // eslint-disable-next-line no-console
  console.log("=".repeat(60));
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[FAIL]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());