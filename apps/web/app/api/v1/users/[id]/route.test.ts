// app/api/v1/users/[id]/route.test.ts
//
// M4 RBAC 平台中台 — 单条用户编辑 + 删除 集成测试。
//
// 覆盖:
//   - DELETE:401 / 403 / 404 / 400(自删) / 200 删除目标用户
//   - DELETE:回归测试 — 目标用户存在 TeamMember 时也能成功删除
//     (历史上 /api/v1/users/[id] 直接 prisma.user.delete,撞 TeamMember
//     RESTRICT FK → 500。修复方式:与 /api/admin/users/[id] 对齐,先
//     deleteMany TeamMember 再 delete User,事务内执行)。
//   - PUT:401 / 403 / 404 / 200 改 username / 200 改 disabled / 400 body /
//     400 无字段可改 / 409 username 重复。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { DELETE, PUT } from "./route";

const TEST_USER_PREFIX = "test-v1-userid-";
const TEST_TEAM_PREFIX = "test-v1-userid-team-";

function uniqueUsername(label: string): string {
  return `${TEST_USER_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function uniqueTeamName(label: string): string {
  return `${TEST_TEAM_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
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

async function makeTargetUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: uniqueUsername("target"), passwordHash: "x" },
  });
  return u.id;
}

async function makeTargetUserWithTeam(): Promise<{ userId: string; teamId: string }> {
  const u = await prisma.user.create({
    data: { username: uniqueUsername("target-in-team"), passwordHash: "x" },
  });
  const team = await prisma.team.create({
    data: { name: uniqueTeamName("t"), ownerUserId: u.id },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: u.id, role: "OWNER" },
  });
  return { userId: u.id, teamId: team.id };
}

async function cleanTestRows(): Promise<void> {
  // TeamMember (with FK to Team) → Project → Team → UserRole → User
  const teams = await prisma.team.findMany({
    where: { name: { startsWith: TEST_TEAM_PREFIX } },
    select: { id: true },
  });
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length > 0) {
    await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.project.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  }
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: TEST_USER_PREFIX } } },
  });
  await prisma.userSkillBinding.deleteMany({
    where: { user: { username: { startsWith: TEST_USER_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USER_PREFIX } },
  });
}

beforeEach(async () => {
  await cleanTestRows();
});

afterEach(async () => {
  await cleanTestRows();
  await prisma.$disconnect();
});

function makeDeleteReq(userId: string, opts: { callerId?: string | null }): NextRequest {
  const url = `http://localhost:30141/api/v1/users/${userId}`;
  const headers: Record<string, string> = {};
  if (opts.callerId !== null && opts.callerId !== undefined) {
    headers["x-user-id"] = opts.callerId;
  }
  return new NextRequest(url, { method: "DELETE", headers });
}

function makePutReq(
  userId: string,
  opts: { callerId?: string | null; body?: unknown }
): NextRequest {
  const url = `http://localhost:30141/api/v1/users/${userId}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId !== null && opts.callerId !== undefined) {
    headers["x-user-id"] = opts.callerId;
  }
  return new NextRequest(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

describe("DELETE /api/v1/users/[id]", () => {
  it("returns 401 without x-user-id", async () => {
    const targetId = await makeTargetUser();
    const res = await DELETE(
      makeDeleteReq(targetId, { callerId: null }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for caller without user:delete permission", async () => {
    const callerId = await makeTargetUser();
    const targetId = await makeTargetUser();
    const res = await DELETE(
      makeDeleteReq(targetId, { callerId }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(403);
    // user not deleted
    expect(await prisma.user.findUnique({ where: { id: targetId } })).not.toBeNull();
  });

  it("returns 404 when target user does not exist", async () => {
    const callerId = await makePlatformAdmin();
    const res = await DELETE(
      makeDeleteReq("nope", { callerId }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when caller deletes themselves", async () => {
    const callerId = await makePlatformAdmin();
    const res = await DELETE(
      makeDeleteReq(callerId, { callerId }),
      { params: Promise.resolve({ id: callerId }) }
    );
    expect(res.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: callerId } })).not.toBeNull();
  });

  it("deletes a target user that has no TeamMember rows", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const res = await DELETE(
      makeDeleteReq(targetId, { callerId }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: targetId } })).toBeNull();
  });

  it("REGRESSION: deletes a target user that owns a Team (TeamMember.userId RESTRICT FK)", async () => {
    // 历史上 /api/v1/users/[id] DELETE 直接 prisma.user.delete,撞
    // TeamMember_userId_fkey 的 RESTRICT → 500 Internal Server Error。
    // 修复:事务内先 deleteMany TeamMember 再 delete User,与
    // /api/admin/users/[id] 对齐。本测试保护此回归。
    const callerId = await makePlatformAdmin();
    const { userId: targetId } = await makeTargetUserWithTeam();

    // sanity check:目标用户有 TeamMember
    expect(
      await prisma.teamMember.findFirst({ where: { userId: targetId } })
    ).not.toBeNull();

    const res = await DELETE(
      makeDeleteReq(targetId, { callerId }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(200);
    // user + TeamMember rows 都被清掉
    expect(await prisma.user.findUnique({ where: { id: targetId } })).toBeNull();
    expect(
      await prisma.teamMember.findMany({ where: { userId: targetId } })
    ).toEqual([]);
  });
});

describe("PUT /api/v1/users/[id]", () => {
  it("returns 401 without x-user-id", async () => {
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { callerId: null, body: { username: "x" } }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for caller without user:edit permission", async () => {
    const callerId = await makeTargetUser();
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { callerId, body: { username: "newname" } }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 when target user does not exist", async () => {
    const callerId = await makePlatformAdmin();
    const res = await PUT(
      makePutReq("nope", { callerId, body: { username: "x" } }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(res.status).toBe(404);
  });

  it("updates username and disabled", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { callerId, body: { username: uniqueUsername("renamed"), disabled: true } }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
    expect(after.disabled).toBe(true);
  });

  it("returns 409 when username already taken", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const otherUsername = uniqueUsername("other");
    await prisma.user.create({
      data: { username: otherUsername, passwordHash: "x" },
    });
    const res = await PUT(
      makePutReq(targetId, { callerId, body: { username: otherUsername } }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(409);
  });

  it("returns 400 when no fields to update", async () => {
    const callerId = await makePlatformAdmin();
    const targetId = await makeTargetUser();
    const res = await PUT(
      makePutReq(targetId, { callerId, body: {} }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(400);
  });
});