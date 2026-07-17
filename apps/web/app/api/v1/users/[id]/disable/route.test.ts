// app/api/v1/users/[id]/disable/route.test.ts
// M4 RBAC 平台中台 — 启用/停用用户 集成测试。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../../../../../../lib/prisma";
import { PUT } from "./route";

const TEST_USER_PREFIX = "test-v1-userdis-";

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

async function makeMemberUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: uniqueUsername("member"), passwordHash: "x" },
  });
  return u.id;
}

async function makeTargetUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: uniqueUsername("target"), passwordHash: "x" },
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

function makePutReq(userId: string, opts: { callerId?: string; body?: unknown }): NextRequest {
  const url = `http://localhost:30141/api/v1/users/${userId}/disable`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId) headers["x-user-id"] = opts.callerId;
  return new NextRequest(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(opts.body),
  });
}

describe("PUT /api/v1/users/[id]/disable", () => {
  it("returns 401 without x-user-id", async () => {
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { body: { disabled: true } }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-platform-admin", async () => {
    const targetId = await makeTargetUser();
    const callerId = await makeMemberUser();
    const res = await PUT(
      makePutReq(targetId, { callerId, body: { disabled: true } }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 when target user not found", async () => {
    const callerId = await makePlatformAdmin();
    const res = await PUT(
      makePutReq("nope", { callerId, body: { disabled: true } }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when caller disables themselves", async () => {
    const callerId = await makePlatformAdmin();
    const res = await PUT(
      makePutReq(callerId, { callerId, body: { disabled: true } }),
      { params: Promise.resolve({ id: callerId }) }
    );
    expect(res.status).toBe(400);
  });

  it("toggles disabled flag on target user", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { callerId, body: { disabled: true } }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(200);
    const target = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { disabled: true },
    });
    expect(target.disabled).toBe(true);
  });
});