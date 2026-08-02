// app/api/v1/roles/[id]/route.test.ts
// M4 RBAC 平台中台 — 角色单条更新 + 删除 集成测试。
// 重点覆盖：id 类型校验 + code 不可变 + enabled/sort 类型校验 + 预置角色保护。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { PUT, DELETE } from "./route";

const TEST_USER_PREFIX = "test-v1-roleedit-";
const TEST_ROLE_PREFIX = "test-v1-roleedit-role-";

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

async function makeTargetRole(): Promise<{ id: string; code: string }> {
  const code = uniqueRoleCode("t");
  const role = await prisma.sysRole.create({
    data: {
      code,
      name: "Test Role",
      desc: "for test",
      enabled: true,
      sort: 0,
    },
  });
  return { id: role.id, code };
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

function makePutReq(roleId: string, body: unknown, callerId?: string): NextRequest {
  const url = `http://localhost:30141/api/v1/roles/${roleId}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (callerId) headers["x-user-id"] = callerId;
  return new NextRequest(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}

function makeDeleteReq(roleId: string, callerId?: string): NextRequest {
  const url = `http://localhost:30141/api/v1/roles/${roleId}`;
  const headers: Record<string, string> = {};
  if (callerId) headers["x-user-id"] = callerId;
  return new NextRequest(url, { method: "DELETE", headers });
}

describe("PUT /api/v1/roles/[id]", () => {
  it("returns 401 without x-user-id", async () => {
    const t = await makeTargetRole();
    const res = await PUT(
      makePutReq(t.id, { name: "x" }),
      { params: Promise.resolve({ id: t.id }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when id is empty", async () => {
    const callerId = await makePlatformAdminUser();
    const res = await PUT(
      makePutReq("", { name: "x" }, callerId),
      { params: Promise.resolve({ id: "" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when target role not found", async () => {
    const callerId = await makePlatformAdminUser();
    const res = await PUT(
      makePutReq("nonexistent-cuid", { name: "x" }, callerId),
      { params: Promise.resolve({ id: "nonexistent-cuid" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when body missing", async () => {
    const callerId = await makePlatformAdminUser();
    const t = await makeTargetRole();
    const url = `http://localhost:30141/api/v1/roles/${t.id}`;
    const req = new NextRequest(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": callerId },
    });
    const res = await PUT(req, { params: Promise.resolve({ id: t.id }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when no editable fields supplied", async () => {
    const callerId = await makePlatformAdminUser();
    const t = await makeTargetRole();
    const res = await PUT(
      makePutReq(t.id, { irrelevant: 1 }, callerId),
      { params: Promise.resolve({ id: t.id }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when code is included in body (immutable)", async () => {
    const callerId = await makePlatformAdminUser();
    const t = await makeTargetRole();
    const res = await PUT(
      makePutReq(t.id, { code: "newcode", name: "New" }, callerId),
      { params: Promise.resolve({ id: t.id }) }
    );
    expect(res.status).toBe(400);
    const after = await prisma.sysRole.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.code).toBe(t.code);
  });

  it("returns 400 when enabled is not boolean", async () => {
    const callerId = await makePlatformAdminUser();
    const t = await makeTargetRole();
    const res = await PUT(
      makePutReq(t.id, { enabled: "true" }, callerId),
      { params: Promise.resolve({ id: t.id }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when sort is not number", async () => {
    const callerId = await makePlatformAdminUser();
    const t = await makeTargetRole();
    const res = await PUT(
      makePutReq(t.id, { sort: "5" }, callerId),
      { params: Promise.resolve({ id: t.id }) }
    );
    expect(res.status).toBe(400);
  });

  it("updates name / desc / enabled / sort and persists", async () => {
    const callerId = await makePlatformAdminUser();
    const t = await makeTargetRole();
    const res = await PUT(
      makePutReq(
        t.id,
        {
          name: "Renamed",
          desc: "new desc",
          enabled: false,
          sort: 42,
        },
        callerId
      ),
      { params: Promise.resolve({ id: t.id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(200);

    const after = await prisma.sysRole.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.name).toBe("Renamed");
    expect(after.desc).toBe("new desc");
    expect(after.enabled).toBe(false);
    expect(after.sort).toBe(42);
    expect(after.code).toBe(t.code); // code 未被修改
  });
});

describe("DELETE /api/v1/roles/[id]", () => {
  it("returns 401 without x-user-id", async () => {
    const t = await makeTargetRole();
    const res = await DELETE(
      makeDeleteReq(t.id),
      { params: Promise.resolve({ id: t.id }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when id is empty", async () => {
    const callerId = await makePlatformAdminUser();
    const res = await DELETE(
      makeDeleteReq("", callerId),
      { params: Promise.resolve({ id: "" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when target role not found", async () => {
    const callerId = await makePlatformAdminUser();
    const res = await DELETE(
      makeDeleteReq("nonexistent-cuid", callerId),
      { params: Promise.resolve({ id: "nonexistent-cuid" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when trying to delete built-in role platform_admin", async () => {
    const callerId = await makePlatformAdminUser();
    const r = await prisma.sysRole.findUniqueOrThrow({
      where: { code: "platform_admin" },
    });
    const res = await DELETE(
      makeDeleteReq(r.id, callerId),
      { params: Promise.resolve({ id: r.id }) }
    );
    expect(res.status).toBe(400);
    const after = await prisma.sysRole.findUniqueOrThrow({
      where: { code: "platform_admin" },
    });
    expect(after).toBeTruthy();
  });

  it("deletes a custom role successfully", async () => {
    const callerId = await makePlatformAdminUser();
    const t = await makeTargetRole();
    const res = await DELETE(
      makeDeleteReq(t.id, callerId),
      { params: Promise.resolve({ id: t.id }) }
    );
    expect(res.status).toBe(200);
    const after = await prisma.sysRole.findUnique({ where: { id: t.id } });
    expect(after).toBeNull();
  });
});