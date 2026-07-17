// lib/permissions.ts
//
// M4 RBAC 平台中台 — 鉴权 helper.
//
// 设计:openspec/changes/m4-rbac-platform/design.md §7.3
//
// 与 lib/server-user.ts 的区别:
//   - assertIsAdmin(getUserHighestRole) 是**团队级**鉴权(TeamMember.role ∈ {OWNER, ADMIN})
//     — 用于"管理团队资源"类路由(本 change 不动)
//   - 本文件 assertPlatformAdmin 是**平台级**鉴权,校验权限码 `platform:access`
//     — 用于"进入平台管理"类路由(/api/admin/*)
//
// 鉴权始终查 DB,**不信任 x-user-role header**(沿用 assertIsAdmin 安全注释)。
// 路由从 x-user-id 派生调用者,经 UserRole→SysRole→RolePermission→Permission join 链判定。
//
// 平滑过渡:首版不强制要求旧数据已迁移到 UserRole,由调用方(如登录 helper)按需
// 自动补绑 team_owner 全局角色(详见 design §9.2)。

import type { NextRequest } from "next/server";
import { prisma } from "./prisma";

/**
 * 校验当前请求者拥有 platform:access 权限码。
 * 用于 /api/admin/* 类平台管理路由。
 *
 * SECURITY:仅依赖 x-user-id 派生调用者,即使请求 header 带 x-user-role 也以 DB 为准。
 * 无 header → null;userId 不存在 → null;无 platform:access → null。
 */
export async function assertPlatformAdmin(
  req: NextRequest
): Promise<{ userId: string } | null> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return null;
  const ok = await assertPermission(userId, "platform:access");
  return ok ? { userId } : null;
}

/**
 * 校验用户是否拥有指定权限码。
 * 经 UserRole→SysRole→RolePermission→Permission join 链查 DB。
 * 多角色并集(任意一个角色持有该权限码即视为有)。
 */
export async function assertPermission(
  userId: string,
  code: string
): Promise<boolean> {
  if (!userId || !code) return false;
  const row = await prisma.permission.findFirst({
    where: {
      code,
      rolePermissions: {
        some: {
          role: {
            enabled: true,
            userRoles: { some: { userId } },
          },
        },
      },
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * 校验用户是否拥有指定权限码之一(OR 语义)。
 */
export async function assertAnyPermission(
  userId: string,
  ...codes: string[]
): Promise<boolean> {
  if (!userId || codes.length === 0) return false;
  for (const c of codes) {
    if (await assertPermission(userId, c)) return true;
  }
  return false;
}

/**
 * 取用户全部权限码(去重)。
 * 用于 /api/v1/auth/me 下发 permissions[] 给前端 store 用。
 */
export async function getUserPermissions(userId: string): Promise<string[]> {
  if (!userId) return [];
  const rows = await prisma.permission.findMany({
    where: {
      rolePermissions: {
        some: {
          role: {
            enabled: true,
            userRoles: { some: { userId } },
          },
        },
      },
    },
    select: { code: true },
  });
  return rows.map((r) => r.code);
}

/**
 * 取用户绑定的全局角色列表(code + name)。
 * 用于 /api/v1/auth/me 下发 roles[] 给前端展示。
 */
export async function getUserRoles(
  userId: string
): Promise<Array<{ code: string; name: string }>> {
  if (!userId) return [];
  const rows = await prisma.sysRole.findMany({
    where: {
      enabled: true,
      userRoles: { some: { userId } },
    },
    select: { code: true, name: true },
    orderBy: { sort: "asc" },
  });
  return rows;
}

/**
 * 平滑过渡 helper:登录时若用户的 UserRole 为空但 TeamMember.role == 'OWNER',
 * 自动绑 team_owner 全局角色。避免历史团队 owner 立刻 403。
 *
 * 返回 true 表示做了绑定,false 表示不需要。
 */
export async function ensureTeamOwnerRoleForExistingOwners(
  userId: string
): Promise<boolean> {
  if (!userId) return false;
  const teamRole = await prisma.teamMember.findFirst({
    where: { userId, role: "OWNER" },
    select: { userId: true },
  });
  if (!teamRole) return false;
  const teamOwnerRole = await prisma.sysRole.findUnique({
    where: { code: "team_owner" },
    select: { id: true },
  });
  if (!teamOwnerRole) return false;
  const existing = await prisma.userRole.findUnique({
    where: { userId_roleId: { userId, roleId: teamOwnerRole.id } },
    select: { userId: true },
  });
  if (existing) return false;
  await prisma.userRole.create({
    data: { userId, roleId: teamOwnerRole.id },
  });
  return true;
}