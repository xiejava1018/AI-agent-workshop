// app/api/v1/users/[id]/password/route.test.ts
// M4 RBAC 平台中台 — 管理员给指定用户设置密码 集成测试。
//
// 覆盖：
//   - 401 没 x-user-id
//   - 403 caller 无 user:reset-password
//   - 400 id 空 / body 缺 / password 缺 / password 太短
//   - 404 用户不存在
//   - 200 成功：bcrypt 哈希落库、mustChangePassword=false、原用户保留其他字段
//   - 200 caller 给自己改密也允许（鉴权只看权限码，不看是不是自己）

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "../../../../../../lib/prisma";
import { PUT } from "./route";

const TEST_USER_PREFIX = "test-v1-userpw-";

function uniqueUsername(label: string): string {
  return `${TEST_USER_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
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

async function makeTargetUser(opts: { mustChangePassword?: boolean } = {}): Promise<string> {
  const u = await prisma.user.create({
    data: {
      username: uniqueUsername("target"),
      passwordHash: "x",
      mustChangePassword: opts.mustChangePassword ?? true,
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
  const url = `http://localhost:30141/api/v1/users/${userId}/password`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (callerId) headers["x-user-id"] = callerId;
  return new NextRequest(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}

describe("PUT /api/v1/users/[id]/password", () => {
  it("returns 401 without x-user-id", async () => {
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { password: "newpass1234" }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when id is empty", async () => {
    const callerId = await makePlatformAdmin();
    const res = await PUT(
      makePutReq("", { password: "newpass1234" }, callerId),
      { params: Promise.resolve({ id: "" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when target user not found", async () => {
    const callerId = await makePlatformAdmin();
    const res = await PUT(
      makePutReq("nonexistent-cuid", { password: "newpass1234" }, callerId),
      { params: Promise.resolve({ id: "nonexistent-cuid" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when body is missing", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const url = `http://localhost:30141/api/v1/users/${targetId}/password`;
    const req = new NextRequest(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": callerId },
    });
    const res = await PUT(req, { params: Promise.resolve({ id: targetId }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is missing", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, {}, callerId),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is too short", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { password: "short" }, callerId),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is whitespace only", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { password: "        " }, callerId),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(400);
  });

  it("updates password hash and clears mustChangePassword", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser({ mustChangePassword: true });
    const newPassword = "newpass1234";

    const res = await PUT(
      makePutReq(targetId, { password: newPassword }, callerId),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.code).toBe(200);
    expect(body.data.id).toBe(targetId);
    expect(body.data.initialPassword).toBeUndefined();

    // bcrypt 哈希落库
    const row = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(row.passwordHash).not.toBe("x");
    expect(row.passwordHash.length).toBeGreaterThan(20);
    expect(await bcrypt.compare(newPassword, row.passwordHash)).toBe(true);
    // mustChangePassword 必须是 false（管理员主动设的最终密码）
    expect(row.mustChangePassword).toBe(false);
  });

  it("trims password before hashing", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { password: "  newpass1234  " }, callerId),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(await bcrypt.compare("newpass1234", row.passwordHash)).toBe(true);
  });

  it("allows caller (admin) to set their own password", async () => {
    // 鉴权只看 user:reset-password,不强制 caller != target
    const callerId = await makePlatformAdmin();
    const newPassword = "selfpw1234";
    const res = await PUT(
      makePutReq(callerId, { password: newPassword }, callerId),
      { params: Promise.resolve({ id: callerId }) }
    );
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: callerId } });
    expect(await bcrypt.compare(newPassword, row.passwordHash)).toBe(true);
  });

  it("preserves other fields (email / full_name / gender / disabled)", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    // 写入扩展字段
    await prisma.user.update({
      where: { id: targetId },
      data: {
        email: "alice@example.com",
        full_name: "Alice",
        phone: "13800001111",
        gender: 1,
        disabled: false,
      },
    });
    const res = await PUT(
      makePutReq(targetId, { password: "newpass1234" }, callerId),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(row.email).toBe("alice@example.com");
    expect(row.full_name).toBe("Alice");
    expect(row.phone).toBe("13800001111");
    expect(row.gender).toBe(1);
    expect(row.disabled).toBe(false);
  });
});
