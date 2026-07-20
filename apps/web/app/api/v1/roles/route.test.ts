// app/api/v1/roles/route.test.ts
// M4 RBAC 平台中台 — 角色 CRUD 列表+创建 集成测试。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { GET, POST } from "./route";

const TEST_USER_PREFIX = "test-v1-roles-";
const TEST_ROLE_PREFIX = "test-v1-role-";

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

async function makePlatformAdminUser(): Promise<string> {
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
  const url = "http://localhost:30141/api/v1/roles";
  const headers: Record<string, string> = {};
  if (userId) headers["x-user-id"] = userId;
  return new NextRequest(url, { method: "GET", headers });
}

function makePostReq(opts: { userId?: string; body?: unknown }): NextRequest {
  const url = "http://localhost:30141/api/v1/roles";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.userId) headers["x-user-id"] = opts.userId;
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(opts.body) });
}

describe("GET /api/v1/roles", () => {
  it("returns 401 without x-user-id", async () => {
    const res = await GET(makeGetReq());
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-platform-admin", async () => {
    const userId = await makeMemberUser();
    const res = await GET(makeGetReq(userId));
    expect(res.status).toBe(403);
  });

  it("returns 200 with paginated roles for platform_admin", async () => {
    const userId = await makePlatformAdminUser();
    const res = await GET(makeGetReq(userId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(200);
    expect(body.data).toHaveProperty("records");
    expect(body.data).toHaveProperty("total");
    expect(body.data).toHaveProperty("page");
    expect(Array.isArray(body.data.records)).toBe(true);
  });
});

describe("POST /api/v1/roles", () => {
  it("returns 401 without x-user-id", async () => {
    const res = await POST(
      makePostReq({ body: { code: uniqueRoleCode("x"), name: "X" } })
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-platform-admin", async () => {
    const userId = await makeMemberUser();
    const res = await POST(
      makePostReq({ userId, body: { code: uniqueRoleCode("x"), name: "X" } })
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when code or name missing", async () => {
    const userId = await makePlatformAdminUser();
    const res = await POST(
      makePostReq({ userId, body: { code: uniqueRoleCode("x") } })
    );
    expect(res.status).toBe(400);
  });

  it("creates role and binds permission codes atomically", async () => {
    const userId = await makePlatformAdminUser();
    const code = uniqueRoleCode("with-perms");
    const res = await POST(
      makePostReq({
        userId,
        body: {
          code,
          name: "Role With Perms",
          desc: "test",
          enabled: true,
          permissionCodes: ["user:view", "role:view"],
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.code).toBe(code);
    const roleId = body.data.id;
    const bindings = await prisma.rolePermission.findMany({
      where: { roleId },
    });
    expect(bindings.length).toBe(2);
  });

  it("XIE-23: records a role.create audit log entry", async () => {
    const userId = await makePlatformAdminUser();
    const code = uniqueRoleCode("audited");
    const res = await POST(
      makePostReq({
        userId,
        body: { code, name: "Audited Role", permissionCodes: ["user:view"] },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const auditRow = await prisma.auditLog.findFirst({
      where: {
        userId,
        action: "role.create",
        resourceType: "role",
        resourceId: body.data.id,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).not.toBeNull();
    const meta = JSON.parse(auditRow!.metadata ?? "{}");
    expect(meta.after.code).toBe(code);
    expect(meta.after.permissionCodes).toContain("user:view");
  });

  it("returns 409 when code already exists", async () => {
    const userId = await makePlatformAdminUser();
    const code = uniqueRoleCode("dup");
    await POST(
      makePostReq({ userId, body: { code, name: "First" } })
    );
    const res = await POST(
      makePostReq({ userId, body: { code, name: "Second" } })
    );
    expect(res.status).toBe(409);
  });

  it("returns 400 when permission code unknown", async () => {
    const userId = await makePlatformAdminUser();
    const res = await POST(
      makePostReq({
        userId,
        body: {
          code: uniqueRoleCode("bogus"),
          name: "Bogus",
          permissionCodes: ["definitely-not-a-real-perm"],
        },
      })
    );
    expect(res.status).toBe(400);
  });
});