/**
 * app/api/admin/teams/[id]/route.test.ts
 *
 * Task 4.3 — Team detail / update / delete tests.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-teamid-";

function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now().toString(36)}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanTestRows(): Promise<void> {
  const teams = await prisma.team.findMany({
    where: { name: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length > 0) {
    await prisma.inviteLink.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.project.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } });
  }
  await prisma.team.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  const users = await prisma.user.findMany({
    where: { username: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.teamMember.deleteMany({ where: { userId: { in: userIds } } });
  }
  await prisma.user.deleteMany({ where: { username: { startsWith: TEST_PREFIX } } });
}

beforeEach(async () => {
  await cleanTestRows();
});

afterAll(async () => {
  await cleanTestRows();
  await prisma.$disconnect();
});

/** M4:resolve platform_admin SysRole(由 seed 提供);不存在则失败。 */
async function getPlatformAdminRoleId(): Promise<string> {
  const r = await prisma.sysRole.findUnique({
    where: { code: "platform_admin" },
    select: { id: true },
  });
  if (!r) {
    throw new Error(
      "platform_admin SysRole not seeded; run `pnpm tsx prisma/seed/roles.ts` first"
    );
  }
  return r.id;
}

async function makeUser(role: "OWNER" | "ADMIN" | "MEMBER"): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: uniqueName(role.toLowerCase()),
      passwordHash: await bcrypt.hash("pass-1234", 10),
      mustChangePassword: false,
    },
  });
  const team = await prisma.team.create({
    data: { name: uniqueName(`home-${role.toLowerCase()}`), ownerUserId: user.id },
  });
  await prisma.teamMember.create({ data: { teamId: team.id, userId: user.id, role } });
  // M4 RBAC 平台中台:OWNER/ADMIN 测试用例需要绑 platform_admin 才能通过鉴权
  if (role === "OWNER" || role === "ADMIN") {
    const roleId = await getPlatformAdminRoleId();
    await prisma.userRole.create({ data: { userId: user.id, roleId } });
  }
  return user.id;
}

/** Create a team owned by ownerId with an OWNER membership. */
async function makeTeam(ownerId: string): Promise<string> {
  const team = await prisma.team.create({
    data: { name: uniqueName("subject"), ownerUserId: ownerId },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: ownerId, role: "OWNER" },
  });
  return team.id;
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req(method: string, callerId: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (callerId != null) headers["x-user-id"] = callerId;
  return new NextRequest("http://localhost/api/admin/teams/x", {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/admin/teams/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("GET", null), paramsFor("x"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when team missing", async () => {
    const { GET } = await import("./route");
    const adminId = await makeUser("ADMIN");
    const res = await GET(req("GET", adminId), paramsFor("missing-id"));
    expect(res.status).toBe(404);
  });

  it("returns team detail with members", async () => {
    const { GET } = await import("./route");
    const ownerId = await makeUser("OWNER");
    const teamId = await makeTeam(ownerId);
    const res = await GET(req("GET", ownerId), paramsFor(teamId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.team.id).toBe(teamId);
    expect(json.team.members.length).toBeGreaterThanOrEqual(1);
    expect(json.team.members.some((m: { isOwner: boolean }) => m.isOwner)).toBe(true);
  });
});

describe("PUT /api/admin/teams/[id]", () => {
  // M4 RBAC 平台中台:旧"修改团队是 OWNER-only"约束已放开。

  it("updates name and quota fields", async () => {
    const { PUT } = await import("./route");
    const ownerId = await makeUser("OWNER");
    const teamId = await makeTeam(ownerId);
    const newName = uniqueName("renamed");
    const res = await PUT(
      req("PUT", ownerId, { name: newName, tokenDailyLimit: 500, maxConcurrentSessions: 3 }),
      paramsFor(teamId),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.team.name).toBe(newName);
    expect(json.team.tokenDailyLimit).toBe(500);
    expect(json.team.maxConcurrentSessions).toBe(3);
  });

  it("rejects negative quota", async () => {
    const { PUT } = await import("./route");
    const ownerId = await makeUser("OWNER");
    const teamId = await makeTeam(ownerId);
    const res = await PUT(req("PUT", ownerId, { tokenDailyLimit: -1 }), paramsFor(teamId));
    expect(res.status).toBe(400);
  });

  it("returns 404 when team missing", async () => {
    const { PUT } = await import("./route");
    const ownerId = await makeUser("OWNER");
    const res = await PUT(req("PUT", ownerId, { name: "X" }), paramsFor("missing-id"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/admin/teams/[id]", () => {
  // M4 RBAC 平台中台:旧"删除团队是 OWNER-only"约束已放开。

  it("hard-deletes team and cascades members/projects/invite-links", async () => {
    const { DELETE } = await import("./route");
    const ownerId = await makeUser("OWNER");
    const teamId = await makeTeam(ownerId);
    await prisma.inviteLink.create({
      data: { teamId, token: uniqueName("tok"), expiresAt: new Date(Date.now() + 3600_000) },
    });
    const res = await DELETE(req("DELETE", ownerId), paramsFor(teamId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: teamId, deleted: true });

    expect(await prisma.team.findUnique({ where: { id: teamId } })).toBeNull();
    expect(await prisma.teamMember.count({ where: { teamId } })).toBe(0);
    expect(await prisma.inviteLink.count({ where: { teamId } })).toBe(0);
  });

  it("returns 404 when team missing", async () => {
    const { DELETE } = await import("./route");
    const ownerId = await makeUser("OWNER");
    const res = await DELETE(req("DELETE", ownerId), paramsFor("missing-id"));
    expect(res.status).toBe(404);
  });
});
