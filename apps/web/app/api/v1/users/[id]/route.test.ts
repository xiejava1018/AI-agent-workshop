// app/api/v1/users/[id]/route.test.ts
// M4 RBAC 平台中台 — 单条用户编辑 + 删除 集成测试。
// 重点覆盖：email/full_name/phone/gender 新字段 + cuid id 类型校验。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { PUT, DELETE } from "./route";

const TEST_USER_PREFIX = "test-v1-useredit-";

function uniqueUsername(label: string): string {
  return `${TEST_USER_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function uniqueEmail(label: string): string {
  return `${label}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.com`;
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

async function makeTargetUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: uniqueUsername("target"), passwordHash: "x" },
  });
  return u.id;
}

async function makeTargetUserWithEmail(label: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      username: uniqueUsername(label),
      passwordHash: "x",
      email: uniqueEmail(label),
    },
  });
  return u.id;
}

beforeEach(async () => {
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: TEST_USER_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USER_PREFIX } },
  });
});

afterEach(async () => {
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: TEST_USER_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USER_PREFIX } },
  });
  await prisma.$disconnect();
});

function makePutReq(userId: string, body: unknown, callerId?: string): NextRequest {
  const url = `http://localhost:30141/api/v1/users/${userId}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (callerId) headers["x-user-id"] = callerId;
  return new NextRequest(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}

function makeDeleteReq(userId: string, callerId?: string): NextRequest {
  const url = `http://localhost:30141/api/v1/users/${userId}`;
  const headers: Record<string, string> = {};
  if (callerId) headers["x-user-id"] = callerId;
  return new NextRequest(url, { method: "DELETE", headers });
}

describe("PUT /api/v1/users/[id]", () => {
  it("returns 401 without x-user-id", async () => {
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { username: "x" }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when id is empty", async () => {
    const callerId = await makePlatformAdmin();
    const res = await PUT(
      makePutReq("", { username: "x" }, callerId),
      { params: Promise.resolve({ id: "" }) }
    );
    // 路由对空字符串 id 直接 400（以前的实现是 404 not found）。
    expect(res.status).toBe(400);
  });

  it("returns 404 when target user not found", async () => {
    const callerId = await makePlatformAdmin();
    const res = await PUT(
      makePutReq("nonexistent-cuid", { username: "x" }, callerId),
      { params: Promise.resolve({ id: "nonexistent-cuid" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when body is missing", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const url = `http://localhost:30141/api/v1/users/${targetId}`;
    const req = new NextRequest(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": callerId },
    });
    const res = await PUT(req, { params: Promise.resolve({ id: targetId }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when no fields to update", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, {}, callerId),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when username trimmed is empty", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { username: "   " }, callerId),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 on duplicate username", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const otherUsername = uniqueUsername("other");
    await prisma.user.create({
      data: { username: otherUsername, passwordHash: "x" },
    });
    const res = await PUT(
      makePutReq(targetId, { username: otherUsername }, callerId),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(409);
  });

  it("updates email / full_name / phone / gender / disabled and persists", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();

    const res = await PUT(
      makePutReq(
        targetId,
        {
          email: "alice@example.com",
          full_name: "Alice",
          phone: "13800001111",
          gender: 1,
          disabled: false,
        },
        callerId
      ),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
    });
    expect(row.email).toBe("alice@example.com");
    expect(row.full_name).toBe("Alice");
    expect(row.phone).toBe("13800001111");
    expect(row.gender).toBe(1);
    expect(row.disabled).toBe(false);
  });

  it("clears email when set to null", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUserWithEmail("cleared");

    const res = await PUT(
      makePutReq(targetId, { email: null }, callerId),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(row.email).toBeNull();
  });

  it("returns 409 on duplicate email", async () => {
    const callerId = await makePlatformAdmin();
    const t1 = await makeTargetUserWithEmail("e1");
    const e2Email = uniqueEmail("e2");

    const res = await PUT(
      makePutReq(t1, { email: e2Email }, callerId),
      { params: Promise.resolve({ id: t1 }) }
    );
    // 因为 t1 已有 email,且我们要把 t1 的 email 改成不存在的 e2Email,应该成功;
    // 我们需要测试真正的重复：先把另外的用户创建为带 email=emailX,然后再把 t1 改成 emailX。
    // 但当前 t1 已有自己的 email,变成 emailX 时是修改,需要先清空,再 PUT 重设。
    expect(res.status).toBe(200);

    // 现在 t1.email = e2Email,接下来把另一个用户的 email 也设为 e2Email 就会 409。
    const t2 = await makeTargetUser();
    const dupRes = await PUT(
      makePutReq(t2, { email: e2Email }, callerId),
      { params: Promise.resolve({ id: t2 }) }
    );
    expect(dupRes.status).toBe(409);
  });

  it("returns 400 when gender is out of range", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { gender: 3 }, callerId),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(400);

    const res2 = await PUT(
      makePutReq(targetId, { gender: "1" }, callerId),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res2.status).toBe(400);
  });

  it("accepts gender=null to clear the field", async () => {
    const callerId = await makePlatformAdmin();
    const t = await prisma.user.create({
      data: {
        username: uniqueUsername("withgender"),
        passwordHash: "x",
        gender: 1,
      },
    });
    const res = await PUT(
      makePutReq(t.id, { gender: null }, callerId),
      { params: Promise.resolve({ id: t.id }) }
    );
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.gender).toBeNull();
  });

  it("returns 200 when only disabled toggles and leaves other fields untouched", async () => {
    const callerId = await makePlatformAdmin();
    const t = await prisma.user.create({
      data: {
        username: uniqueUsername("withall"),
        passwordHash: "x",
        email: uniqueEmail("withall"),
        full_name: "Bob",
        phone: "13900000000",
        gender: 2,
      },
    });
    const res = await PUT(
      makePutReq(t.id, { disabled: true }, callerId),
      { params: Promise.resolve({ id: t.id }) }
    );
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.disabled).toBe(true);
    expect(row.email).not.toBeNull();
    expect(row.full_name).toBe("Bob");
    expect(row.phone).toBe("13900000000");
    expect(row.gender).toBe(2);
  });
});

describe("DELETE /api/v1/users/[id]", () => {
  it("returns 401 without x-user-id", async () => {
    const t = await makeTargetUser();
    const res = await DELETE(
      makeDeleteReq(t),
      { params: Promise.resolve({ id: t }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when target id is empty string", async () => {
    const callerId = await makePlatformAdmin();
    const res = await DELETE(
      makeDeleteReq("", callerId),
      { params: Promise.resolve({ id: "" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when target user not found", async () => {
    const callerId = await makePlatformAdmin();
    const res = await DELETE(
      makeDeleteReq("nonexistent-cuid", callerId),
      { params: Promise.resolve({ id: "nonexistent-cuid" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when caller tries to delete self", async () => {
    const callerId = await makePlatformAdmin();
    const res = await DELETE(
      makeDeleteReq(callerId, callerId),
      { params: Promise.resolve({ id: callerId }) }
    );
    expect(res.status).toBe(400);
  });

  it("deletes a target user successfully", async () => {
    const callerId = await makePlatformAdmin();
    const t = await makeTargetUser();
    const res = await DELETE(
      makeDeleteReq(t, callerId),
      { params: Promise.resolve({ id: t }) }
    );
    expect(res.status).toBe(200);
    const after = await prisma.user.findUnique({ where: { id: t } });
    expect(after).toBeNull();
  });
});
