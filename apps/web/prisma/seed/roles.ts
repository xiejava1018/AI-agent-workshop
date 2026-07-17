#!/usr/bin/env -S npx tsx
/**
 * SysRole + RolePermission 种子脚本(幂等)
 *
 * 设计:openspec/changes/m4-rbac-platform/design.md §5
 * 运行:cd apps/web && pnpm tsx prisma/seed/roles.ts
 *
 * 预置三个全局角色:
 *   - platform_admin: 平台管理员(全权限)
 *   - team_owner:     团队 OWNER(团队/数字员工/技能/MCP/会话/审计)
 *   - member:         普通用户(自己的数字员工/技能/MCP/会话/凭据)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type RoleSeed = {
  code: string;
  name: string;
  desc: string;
  sort: number;
  /** 该角色绑定的权限码列表 */
  permissionCodes: string[];
};

const ROLE_PERMISSIONS: RoleSeed[] = [
  {
    code: "platform_admin",
    name: "平台管理员",
    desc: "拥有全部权限,管理平台用户/角色/菜单/模型/MCP/技能/审计/监控",
    sort: 1,
    permissionCodes: [
      // 平台准入
      "platform:access",
      // 用户
      "user:view", "user:create", "user:edit", "user:delete", "user:disable", "user:reset-password", "user:assign-role",
      // 角色
      "role:view", "role:create", "role:edit", "role:delete", "role:assign-permission",
      // 菜单
      "menu:view", "menu:create", "menu:edit", "menu:delete",
      // 团队(平台管理员可见所有团队)
      "team:view",
      // 数字员工
      "agent:view", "agent:create", "agent:edit", "agent:delete", "agent:clone", "agent:bind-skill", "agent:bind-mcp",
      // 技能
      "skill:view", "skill:install", "skill:create", "skill:edit", "skill:delete", "skill:scope",
      // MCP
      "mcp:view", "mcp:create", "mcp:edit", "mcp:delete", "mcp:bind", "mcp:credential",
      // 会话
      "session:view",
      // 模型
      "model:view", "model:create", "model:edit", "model:delete", "model:default", "model:set-fallback",
      // 凭据
      "apikey:view",
      // 审计
      "audit:view",
      // 监控
      "monitor:view",
    ],
  },
  {
    code: "team_owner",
    name: "团队 OWNER",
    desc: "管理本团队成员/数字员工/技能/MCP/会话/审计,无平台管理入口",
    sort: 2,
    permissionCodes: [
      // 团队管理(本团队范围由业务逻辑控制,这里只给权限码)
      "team:view", "team:edit", "team:invite", "team:add-member", "team:remove-member", "team:change-role",
      // 数字员工
      "agent:view", "agent:create", "agent:edit", "agent:clone", "agent:bind-skill", "agent:bind-mcp",
      // 技能
      "skill:view", "skill:install",
      // MCP
      "mcp:view", "mcp:bind",
      // 会话
      "session:view",
      // 审计
      "audit:view",
    ],
  },
  {
    code: "member",
    name: "普通用户",
    desc: "使用工作台:查看/创建/编辑个人数字员工、技能、会话、API Key",
    sort: 3,
    permissionCodes: [
      // 个人数字员工
      "agent:view", "agent:create", "agent:edit", "agent:clone",
      // 个人技能
      "skill:view", "skill:install",
      // 个人 MCP
      "mcp:view",
      // 会话
      "session:view", "session:create", "session:edit", "session:delete",
      // 自己的 API Key
      "apikey:view", "apikey:edit",
    ],
  },
];

async function main() {
  let rolesCreated = 0;
  let rolesSkipped = 0;
  let bindingsCreated = 0;
  let bindingsSkipped = 0;
  let bindingsMissing: string[] = [];

  for (const role of ROLE_PERMISSIONS) {
    // 1) upsert SysRole
    const existing = await prisma.sysRole.findUnique({ where: { code: role.code } });
    if (!existing) {
      await prisma.sysRole.create({
        data: {
          code: role.code,
          name: role.name,
          desc: role.desc,
          sort: role.sort,
        },
      });
      rolesCreated++;
      // eslint-disable-next-line no-console
      console.log(`  [add] role '${role.code}' (${role.name})`);
    } else {
      rolesSkipped++;
      // eslint-disable-next-line no-console
      console.log(`  [skip] role '${role.code}' exists`);
    }
    const sysRole = await prisma.sysRole.findUniqueOrThrow({ where: { code: role.code } });

    // 2) 绑定权限码
    for (const code of role.permissionCodes) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      if (!perm) {
        bindingsMissing.push(`${role.code}:${code}`);
        continue;
      }
      const exists = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: sysRole.id, permissionId: perm.id } },
      });
      if (exists) {
        bindingsSkipped++;
        continue;
      }
      await prisma.rolePermission.create({
        data: { roleId: sysRole.id, permissionId: perm.id },
      });
      bindingsCreated++;
    }
  }

  // eslint-disable-next-line no-console
  console.log("\n" + "=".repeat(60));
  // eslint-disable-next-line no-console
  console.log(
    `Role seed done. roles: created=${rolesCreated} skipped=${rolesSkipped} total=${ROLE_PERMISSIONS.length}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `RolePermission: created=${bindingsCreated} skipped=${bindingsSkipped} missing=${bindingsMissing.length}`
  );
  if (bindingsMissing.length > 0) {
    // eslint-disable-next-line no-console
    console.error("[WARN] missing permission codes (run permissions.ts first):");
    bindingsMissing.forEach((m) => console.error(`  - ${m}`));
    process.exit(2);
  }
  // eslint-disable-next-line no-console
  console.log("=".repeat(60));

  // 3) 防锁死:把 INITIAL_PLATFORM_ADMIN_USERNAME 对应用户绑 platform_admin
  const initialUsername = process.env.INITIAL_PLATFORM_ADMIN_USERNAME ?? "admin";
  const initialUser = await prisma.user.findUnique({ where: { username: initialUsername } });
  if (initialUser) {
    const platformRole = await prisma.sysRole.findUniqueOrThrow({ where: { code: "platform_admin" } });
    const existingBinding = await prisma.userRole.findUnique({
      where: { userId_roleId: { userId: initialUser.id, roleId: platformRole.id } },
    });
    if (!existingBinding) {
      await prisma.userRole.create({
        data: { userId: initialUser.id, roleId: platformRole.id },
      });
      // eslint-disable-next-line no-console
      console.log(`\n  [lock-guard] bound user '${initialUsername}' -> platform_admin`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`\n  [lock-guard] user '${initialUsername}' already has platform_admin (skip)`);
    }
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n  [lock-guard] user '${initialUsername}' not found, will be bound on first login`);
  }
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[FAIL]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());