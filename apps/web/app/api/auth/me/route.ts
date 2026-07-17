// app/api/auth/me/route.ts
//
// Returns the current authenticated user's context.
// Middleware already verifies the access token and injects x-user-id / x-user-role.
//
// M4 扩展:
//   - 响应新增 permissions: string[]   (User→UserRole→SysRole→RolePermission→Permission 链)
//   - 响应新增 roles: { code, name }[] (User→UserRole→SysRole 链)
//   - 这两个字段驱动前端动态菜单 + v-auth 按钮级权限。
//   - 平滑过渡:若用户 UserRole 为空但 TeamMember.role='OWNER',自动绑 team_owner
//     全局角色(防锁死 + 让历史团队 OWNER 也能立即看到 team 管理菜单)。

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/server-user";
import {
  ensureTeamOwnerRoleForExistingOwners,
  getUserPermissions,
  getUserRoles,
} from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  const ctx = await getCurrentUserContext(userId);
  if (!ctx) {
    return NextResponse.json({ error: "invalid session" }, { status: 401 });
  }

  // 平滑过渡:无 UserRole 且为 TeamMember OWNER → 自动绑 team_owner
  // 失败也不应阻塞 /me 响应(最坏情况用户看到空菜单而非 500)
  try {
    await ensureTeamOwnerRoleForExistingOwners(userId);
  } catch {
    // 静默:不阻塞主流程;下次 /me 再试
  }

  const [permissions, roles] = await Promise.all([
    getUserPermissions(userId),
    getUserRoles(userId),
  ]);

  return NextResponse.json({
    id: ctx.user.id,
    username: ctx.user.username,
    mustChangePassword: ctx.user.mustChangePassword,
    role: ctx.role,
    permissions,
    roles,
  });
}
