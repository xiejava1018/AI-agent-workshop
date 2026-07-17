// app/api/v1/menus/role/[roleId]/route.test.ts
// M4 RBAC 平台中台 — 角色绑定的权限码集合 集成测试。
//
// GET  取角色绑定的权限码列表(用于"分配权限"弹窗初始回填)
// PUT  差量替换角色绑定的权限码(原子事务,UI 上"保存"按钮调用)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../../../../../../lib/prisma";
import { GET, PUT } from "./route";

const TEST_USER_PREFIX = "test-v1-rolemenu-";
const TEST_ROLE_PREFIX = "test-v1-mrole-";

function uniqueUsername(label: string): string {
  return `${TEST_USER_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function uniqueRoleCode(label: string): string {
  return `${TEST_ROLE_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function getPlatformAdminRoleId(): Promise<string> {
  const r = await prisma.sysRole.findUniqueOrThrow({
    where: { code: "platform_admin" },
    select: { id: true },
  });
  return r.id;
}

async function makePlatformAdmin(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: uniqueUsername("admin"), passwordHash: "x" },
  });
  const roleId = await getPlatformAdminRoleId();
  await prisma.userRole.create({ data: { userId: u.id, roleId } });
  return u.id;
}

async function makeMemberUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: uniqueUsername("member"), passwordHash: "x" },
  });
  return u.id;
}

beforeEach(async () => {
  await prisma.rolePermission.deleteMany({
    where: { role: { code: { startsWith: TEST_ROLE_PREFIX } } },
  });
  await prisma.userRole.deleteMany({
    where: { role: { code: { startsWith: TEST_ROLE_PREFIX } } },
  });
  await prisma.sysRole.deleteMany({
    where: { code: { startsWith: TEST_ROLE_PREFIX } },
  });
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: TEST_USER_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USER_PREFIX } },
  });
});

afterEach(async () => {
  await prisma.rolePermission.deleteMany({
    where: { role: { code: { startsWith: TEST_ROLE_PREFIX } } },
  });
  await prisma.userRole.deleteMany({
    where: { role: { code: { startsWith: TEST_ROLE_PREFIX } } },
  });
  await prisma.sysRole.deleteMany({
    where: { code: { startsWith: TEST_ROLE_PREFIX } },
  });
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: TEST_USER_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USER_PREFIX } },
  });
  await prisma.$disconnect();
});

function makeGetReq(roleId: string, userId?: string): NextRequest {
  const url = `http://localhost:30141/api/v1/menus/role/${roleId}`;
  const headers: Record<string, string> = {};
  if (userId) headers["x-user-id"] = userId;
  return new NextRequest(url, { method: "GET", headers });
}

function makePutReq(roleId: string, opts: { userId?: string; body?: unknown }): NextRequest {
  const url = `http://localhost:30141/api/v1/menus/role/${roleId}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.userId) headers["x-user-id"] = opts.userId;
  return new NextRequest(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(opts.body),
  });
}

async function makeTestRole(): Promise<{ id: string; code: string }> {
  const code = uniqueRoleCode("test");
  const r = await prisma.sysRole.create({
    data: { code, name: "Test Role" },
  });
  return { id: r.id, code };
}

describe("GET /api/v1/menus/role/[roleId]", () => {
  it("returns 401 without x-user-id", async () => {
    const { id } = await makeTestRole();
    const res = await GET(makeGetReq(id), { params: Promise.resolve({ roleId: id }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-platform-admin", async () => {
    const { id } = await makeTestRole();
    const userId = await makeMemberUser();
    const res = await GET(makeGetReq(id, userId), {
      params: Promise.resolve({ roleId: id }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when role not found", async () => {
    const userId = await makePlatformAdmin();
    const res = await GET(makeGetReq("nonexistent-id", userId), {
      params: Promise.resolve({ roleId: "nonexistent-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns permission codes for an existing role", async () => {
    const { id } = await makeTestRole();
    const userId = await makePlatformAdmin();
    // 绑两个权限码
    const perms = await Promise.all([
      prisma.permission.findUniqueOrThrow({ where: { code: "user:view" } }),
      prisma.permission.findUniqueOrThrow({ where: { code: "role:view" } }),
    ]);
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: id, permissionId: p.id })),
    });
    const res = await GET(makeGetReq(id, userId), {
      params: Promise.resolve({ roleId: id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.permissionCodes.sort()).toEqual(["role:view", "user:view"]);
  });
});

describe("PUT /api/v1/menus/role/[roleId]", () => {
  it("returns 401 without x-user-id", async () => {
    const { id } = await makeTestRole();
    const res = await PUT(makePutReq(id, { body: { permissionCodes: [] } }), {
      params: Promise.resolve({ roleId: id }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-platform-admin", async () => {
    const { id } = await makeTestRole();
    const userId = await makeMemberUser();
    const res = await PUT(
      makePutReq(id, { userId, body: { permissionCodes: [] } }),
      { params: Promise.resolve({ roleId: id }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when body invalid", async () => {
    const { id } = await makeTestRole();
    const userId = await makePlatformAdmin();
    const res = await PUT(
      makePutReq(id, { userId, body: { foo: "bar" } }),
      { params: Promise.resolve({ roleId: id }) }
    );
    expect(res.status).toBe(400);
  });

  it("replaces role permissions atomically (删旧 + 增新)", async () => {
    const { id } = await makeTestRole();
    const userId = await makePlatformAdmin();
    // 初始绑一个
    const initial = await prisma.permission.findUniqueOrThrow({
      where: { code: "user:view" },
    });
    await prisma.rolePermission.create({
      data: { roleId: id, permissionId: initial.id },
    });
    // 替换为另一个
    const res = await PUT(
      makePutReq(id, { userId, body: { permissionCodes: ["role:view"] } }),
      { params: Promise.resolve({ roleId: id }) }
    );
    expect(res.status).toBe(200);
    const bindings = await prisma.rolePermission.findMany({ where: { roleId: id } });
    expect(bindings.length).toBe(1);
    const codes = await prisma.permission.findMany({
      where: { id: { in: bindings.map((b) => b.permissionId) } },
      select: { code: true },
    });
    expect(codes.map((c) => c.code)).toEqual(["role:view"]);
  });

  it("accepts empty permissionCodes to clear all", async () => {
    const { id } = await makeTestRole();
    const userId = await makePlatformAdmin();
    const p = await prisma.permission.findUniqueOrThrow({
      where: { code: "user:view" },
    });
    await prisma.rolePermission.create({
      data: { roleId: id, permissionId: p.id },
    });
    const res = await PUT(
      makePutReq(id, { userId, body: { permissionCodes: [] } }),
      { params: Promise.resolve({ roleId: id }) }
    );
    expect(res.status).toBe(200);
    const count = await prisma.rolePermission.count({ where: { roleId: id } });
    expect(count).toBe(0);
  });

  it("returns 400 when permission code unknown", async () => {
    const { id } = await makeTestRole();
    const userId = await makePlatformAdmin();
    const res = await PUT(
      makePutReq(id, {
        userId,
        body: { permissionCodes: ["nope-this-is-fake"] },
      }),
      { params: Promise.resolve({ roleId: id }) }
    );
    expect(res.status).toBe(400);
  });
});