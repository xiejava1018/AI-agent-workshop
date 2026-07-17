// lib/permissions.test.ts
// M4 RBAC 平台中台 — 鉴权 helper 单测。
//
// 测试策略:用真 DB(同 team-auth.test.ts / audit-log.test.ts 模式),用测试前缀
// 隔离 rows,afterEach 清理。每个测试自建 user/role/permission fixture。
//
// 设计:openspec/changes/m4-rbac-platform/specs/rbac-platform/spec.md §5
// 覆盖目标 ≥ 80%。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";
import {
  assertAnyPermission,
  assertPermission,
  assertPlatformAdmin,
  ensureTeamOwnerRoleForExistingOwners,
  getUserPermissions,
  getUserRoles,
} from "./permissions";

const TEST_PREFIX = "m4-perm-";
const rand = () => Math.random().toString(36).slice(2, 8);
const tid = (label: string) => `${TEST_PREFIX}${label}-${rand()}`;

const ids = {
  userWithPerm: tid("uwp"),
  userWithoutPerm: tid("uwn"),
  teamOwnerUser: tid("to"),
  memberUser: tid("mb"),
  plainUser: tid("plain"),
  team: tid("team"),
  role: tid("role"),
  perm1: tid("p1"),
  perm2: tid("p2"),
};

beforeEach(async () => {
  // 1) 创建一个 User 给所有测试共享
  await prisma.user.createMany({
    data: [
      { id: ids.userWithPerm, username: ids.userWithPerm, passwordHash: "x" },
      { id: ids.userWithoutPerm, username: ids.userWithoutPerm, passwordHash: "x" },
      { id: ids.teamOwnerUser, username: ids.teamOwnerUser, passwordHash: "x" },
      { id: ids.memberUser, username: ids.memberUser, passwordHash: "x" },
      { id: ids.plainUser, username: ids.plainUser, passwordHash: "x" },
    ],
  });

  // 2) 创建一个测试 Role
  await prisma.sysRole.create({
    data: { id: ids.role, code: tid("code"), name: "Test Role", desc: "test" },
  });

  // 3) 创建两个测试 Permission
  const p1 = await prisma.permission.create({
    data: { id: ids.perm1, code: tid("perm1-code"), module: "test", name: "P1" },
  });
  const p2 = await prisma.permission.create({
    data: { id: ids.perm2, code: tid("perm2-code"), module: "test", name: "P2" },
  });

  // 4) Role 绑定两个 Permission
  await prisma.rolePermission.createMany({
    data: [
      { roleId: ids.role, permissionId: p1.id },
      { roleId: ids.role, permissionId: p2.id },
    ],
  });

  // 5) userWithPerm 绑 Role
  await prisma.userRole.create({
    data: { userId: ids.userWithPerm, roleId: ids.role },
  });

  // 6) teamOwnerUser 是某 Team 的 OWNER
  await prisma.team.create({
    data: { id: ids.team, name: ids.team, ownerUserId: ids.teamOwnerUser },
  });
  await prisma.teamMember.create({
    data: { teamId: ids.team, userId: ids.teamOwnerUser, role: "OWNER" },
  });
  // memberUser 是同一团队 MEMBER(用于 ensureTeamOwnerRoleForExistingOwners 跳过)
  await prisma.teamMember.create({
    data: { teamId: ids.team, userId: ids.memberUser, role: "MEMBER" },
  });
});

afterEach(async () => {
  // 清理测试前缀的所有 rows(按依赖顺序)
  await prisma.rolePermission.deleteMany({
    where: { roleId: { startsWith: TEST_PREFIX } },
  });
  await prisma.userRole.deleteMany({
    where: {
      OR: [
        { userId: { startsWith: TEST_PREFIX } },
        { roleId: { startsWith: TEST_PREFIX } },
      ],
    },
  });
  await prisma.teamMember.deleteMany({
    where: { teamId: { startsWith: TEST_PREFIX } },
  });
  await prisma.team.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await prisma.sysRole.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await prisma.permission.deleteMany({
    where: { code: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_PREFIX } },
  });
});

function makeReq(opts: { userId?: string }): NextRequest {
  const headers = new Headers();
  if (opts.userId) headers.set("x-user-id", opts.userId);
  return { headers } as unknown as NextRequest;
}

describe("assertPermission", () => {
  it("returns true when user holds the permission via role binding", async () => {
    const perm = await prisma.permission.findUniqueOrThrow({
      where: { id: ids.perm1 },
    });
    expect(await assertPermission(ids.userWithPerm, perm.code)).toBe(true);
  });

  it("returns false when user has no roles", async () => {
    const perm = await prisma.permission.findUniqueOrThrow({
      where: { id: ids.perm1 },
    });
    expect(await assertPermission(ids.userWithoutPerm, perm.code)).toBe(false);
  });

  it("returns false for unknown permission code", async () => {
    expect(await assertPermission(ids.userWithPerm, "nonexistent:code")).toBe(false);
  });

  it("returns false for empty userId / empty code", async () => {
    expect(await assertPermission("", "any:code")).toBe(false);
    expect(await assertPermission(ids.userWithPerm, "")).toBe(false);
  });

  it("returns false when role is disabled", async () => {
    const perm = await prisma.permission.findUniqueOrThrow({
      where: { id: ids.perm1 },
    });
    await prisma.sysRole.update({
      where: { id: ids.role },
      data: { enabled: false },
    });
    expect(await assertPermission(ids.userWithPerm, perm.code)).toBe(false);
  });
});

describe("assertAnyPermission", () => {
  it("returns true if user holds any one of the listed codes", async () => {
    const p1 = await prisma.permission.findUniqueOrThrow({ where: { id: ids.perm1 } });
    const p2 = await prisma.permission.findUniqueOrThrow({ where: { id: ids.perm2 } });
    expect(await assertAnyPermission(ids.userWithPerm, p1.code, p2.code)).toBe(true);
  });

  it("returns false when user holds none", async () => {
    expect(
      await assertAnyPermission(ids.userWithoutPerm, "nope:1", "nope:2")
    ).toBe(false);
  });

  it("returns false for empty args", async () => {
    expect(await assertAnyPermission(ids.userWithPerm)).toBe(false);
  });
});

describe("getUserPermissions", () => {
  it("returns deduplicated permission codes for user", async () => {
    const codes = await getUserPermissions(ids.userWithPerm);
    expect(codes.length).toBe(2);
    expect(new Set(codes).size).toBe(2); // dedup
  });

  it("returns empty array for user without roles", async () => {
    expect(await getUserPermissions(ids.userWithoutPerm)).toEqual([]);
  });

  it("returns empty array for empty userId", async () => {
    expect(await getUserPermissions("")).toEqual([]);
  });

  it("excludes permissions from disabled roles", async () => {
    await prisma.sysRole.update({
      where: { id: ids.role },
      data: { enabled: false },
    });
    expect(await getUserPermissions(ids.userWithPerm)).toEqual([]);
  });
});

describe("getUserRoles", () => {
  it("returns role code+name ordered by sort", async () => {
    const role = await prisma.sysRole.findUniqueOrThrow({
      where: { id: ids.role },
    });
    const roles = await getUserRoles(ids.userWithPerm);
    expect(roles.length).toBe(1);
    expect(roles[0]).toMatchObject({ code: role.code });
    expect(typeof roles[0].name).toBe("string");
  });

  it("returns empty array for user without roles", async () => {
    expect(await getUserRoles(ids.userWithoutPerm)).toEqual([]);
  });
});

describe("assertPlatformAdmin", () => {
  it("returns null without x-user-id header", async () => {
    expect(await assertPlatformAdmin(makeReq({}))).toBeNull();
  });

  it("returns null when user lacks platform:access permission", async () => {
    expect(
      await assertPlatformAdmin(makeReq({ userId: ids.userWithPerm }))
    ).toBeNull();
  });

  it("returns {userId} when user holds platform:access", async () => {
    const platPerm = await prisma.permission.findUniqueOrThrow({
      where: { code: "platform:access" },
    });
    // 复用测试 role,加绑 platform:access
    await prisma.rolePermission.create({
      data: { roleId: ids.role, permissionId: platPerm.id },
    });
    const out = await assertPlatformAdmin(
      makeReq({ userId: ids.userWithPerm })
    );
    expect(out).toEqual({ userId: ids.userWithPerm });
  });
});

describe("ensureTeamOwnerRoleForExistingOwners", () => {
  it("binds team_owner role for TeamMember OWNER who has no UserRole", async () => {
    const ok = await ensureTeamOwnerRoleForExistingOwners(ids.teamOwnerUser);
    expect(ok).toBe(true);
    // 验证:team_owner SysRole 存在(已 seed),UserRole 创建
    const teamOwnerRole = await prisma.sysRole.findUniqueOrThrow({
      where: { code: "team_owner" },
    });
    const binding = await prisma.userRole.findUnique({
      where: { userId_roleId: { userId: ids.teamOwnerUser, roleId: teamOwnerRole.id } },
    });
    expect(binding).not.toBeNull();
  });

  it("returns false if user already has UserRole", async () => {
    // 先绑一次
    await ensureTeamOwnerRoleForExistingOwners(ids.teamOwnerUser);
    // 再调用应返回 false
    const ok = await ensureTeamOwnerRoleForExistingOwners(ids.teamOwnerUser);
    expect(ok).toBe(false);
  });

  it("returns false for MEMBER-only user", async () => {
    expect(await ensureTeamOwnerRoleForExistingOwners(ids.memberUser)).toBe(false);
  });

  it("returns false for user with no TeamMember", async () => {
    expect(await ensureTeamOwnerRoleForExistingOwners(ids.plainUser)).toBe(false);
  });

  it("returns false for empty userId", async () => {
    expect(await ensureTeamOwnerRoleForExistingOwners("")).toBe(false);
  });
});