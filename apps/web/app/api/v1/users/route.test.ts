// app/api/v1/users/route.test.ts
// M4 RBAC 平台中台 — 用户列表+创建 集成测试。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { GET, POST } from "./route";

const TEST_USER_PREFIX = "test-v1-users-";
const TEST_ROLE_PREFIX = "test-v1-urole-";

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

function makeGetReq(userId?: string): NextRequest {
  const url = "http://localhost:30141/api/v1/users";
  const headers: Record<string, string> = {};
  if (userId) headers["x-user-id"] = userId;
  return new NextRequest(url, { method: "GET", headers });
}

function makePostReq(opts: { userId?: string; body?: unknown }): NextRequest {
  const url = "http://localhost:30141/api/v1/users";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.userId) headers["x-user-id"] = opts.userId;
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body),
  });
}

describe("GET /api/v1/users", () => {
  it("returns 401 without x-user-id", async () => {
    const res = await GET(makeGetReq());
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-platform-admin", async () => {
    const userId = await makeMemberUser();
    const res = await GET(makeGetReq(userId));
    expect(res.status).toBe(403);
  });

  it("returns paginated users with roleCodes for platform_admin", async () => {
    const userId = await makePlatformAdmin();
    const res = await GET(makeGetReq(userId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(200);
    expect(body.data).toHaveProperty("records");
    expect(body.data).toHaveProperty("total");
    // 至少包含我们刚建的 platform_admin
    const records = body.data.records as Array<{
      username: string;
      roleCodes: string[];
    }>;
    const me = records.find((r) => r.username.startsWith(TEST_USER_PREFIX));
    expect(me).toBeDefined();
    expect(me?.roleCodes).toContain("platform_admin");
  });
});

describe("POST /api/v1/users", () => {
  it("returns 401 without x-user-id", async () => {
    const res = await POST(makePostReq({ body: { username: "u" } }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-platform-admin", async () => {
    const userId = await makeMemberUser();
    const res = await POST(
      makePostReq({ userId, body: { username: uniqueUsername("new") } })
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when username missing", async () => {
    const userId = await makePlatformAdmin();
    const res = await POST(makePostReq({ userId, body: {} }));
    expect(res.status).toBe(400);
  });

  it("returns 409 on duplicate username", async () => {
    const userId = await makePlatformAdmin();
    const dupeName = uniqueUsername("dupe");
    await POST(makePostReq({ userId, body: { username: dupeName } }));
    const res = await POST(makePostReq({ userId, body: { username: dupeName } }));
    expect(res.status).toBe(409);
  });

  it("creates user with random password and binds roleCodes", async () => {
    const userId = await makePlatformAdmin();
    const newUsername = uniqueUsername("newone");
    const res = await POST(
      makePostReq({
        userId,
        body: { username: newUsername, roleCodes: ["member"] },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.username).toBe(newUsername);
    expect(typeof body.data.initialPassword).toBe("string");
    // 必须改密
    const newUser = await prisma.user.findUniqueOrThrow({
      where: { username: newUsername },
      select: { mustChangePassword: true, passwordHash: true },
    });
    expect(newUser.mustChangePassword).toBe(true);
    expect(newUser.passwordHash.length).toBeGreaterThan(0);
    // 已绑 member 全局角色
    const memberRole = await prisma.sysRole.findUniqueOrThrow({
      where: { code: "member" },
    });
    const binding = await prisma.userRole.findUnique({
      where: {
        userId_roleId: {
          userId: body.data.id,
          roleId: memberRole.id,
        },
      },
    });
    expect(binding).not.toBeNull();
  });

  it("returns 400 when roleCode unknown", async () => {
    const userId = await makePlatformAdmin();
    const res = await POST(
      makePostReq({
        userId,
        body: {
          username: uniqueUsername("badr"),
          roleCodes: ["definitely-not-a-real-role"],
        },
      })
    );
    expect(res.status).toBe(400);
  });
});