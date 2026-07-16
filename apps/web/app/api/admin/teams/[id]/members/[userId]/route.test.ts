/**
 * app/api/admin/teams/[id]/members/[userId]/route.test.ts
 *
 * Task 4.3 — Remove member / update member role tests.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-tmemberid-";

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

async function makePlainUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: uniqueName("plain"),
      passwordHash: await bcrypt.hash("pass-1234", 10),
      mustChangePassword: false,
    },
  });
  return user.id;
}

async function makeTeamWithOwner(): Promise<{ teamId: string; ownerId: string }> {
  const ownerId = await makePlainUser();
  const team = await prisma.team.create({
    data: { name: uniqueName("subject"), ownerUserId: ownerId },
  });
  await prisma.teamMember.create({ data: { teamId: team.id, userId: ownerId, role: "OWNER" } });
  return { teamId: team.id, ownerId };
}

function paramsFor(id: string, userId: string) {
  return { params: Promise.resolve({ id, userId }) };
}

function makeReq(method: string, callerId: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (callerId != null) headers["x-user-id"] = callerId;
  return new NextRequest("http://localhost/api/admin/teams/x/members/y", {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("DELETE /api/admin/teams/[id]/members/[userId]", () => {
  it("returns 401 when unauthenticated", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(makeReq("DELETE", null), paramsFor("x", "y"));
    expect(res.status).toBe(401);
  });

  it("cannot remove the team owner", async () => {
    const { DELETE } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    const res = await DELETE(makeReq("DELETE", ownerId), paramsFor(teamId, ownerId));
    expect(res.status).toBe(400);
  });

  it("removes a regular member", async () => {
    const { DELETE } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    const target = await makePlainUser();
    await prisma.teamMember.create({ data: { teamId, userId: target, role: "MEMBER" } });
    const res = await DELETE(makeReq("DELETE", ownerId), paramsFor(teamId, target));
    expect(res.status).toBe(200);
    expect(
      await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: target } } }),
    ).toBeNull();
  });

  it("returns 404 when target is not a member", async () => {
    const { DELETE } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    const stranger = await makePlainUser();
    const res = await DELETE(makeReq("DELETE", ownerId), paramsFor(teamId, stranger));
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/admin/teams/[id]/members/[userId]", () => {
  it("cannot change the owner's role", async () => {
    const { PUT } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    const res = await PUT(makeReq("PUT", ownerId, { role: "MEMBER" }), paramsFor(teamId, ownerId));
    expect(res.status).toBe(400);
  });

  it("updates a member's role", async () => {
    const { PUT } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    const target = await makePlainUser();
    await prisma.teamMember.create({ data: { teamId, userId: target, role: "MEMBER" } });
    const res = await PUT(makeReq("PUT", ownerId, { role: "ADMIN" }), paramsFor(teamId, target));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.member.role).toBe("ADMIN");
  });

  it("returns 400 for invalid role", async () => {
    const { PUT } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    const target = await makePlainUser();
    await prisma.teamMember.create({ data: { teamId, userId: target, role: "MEMBER" } });
    const res = await PUT(makeReq("PUT", ownerId, { role: "OWNER" }), paramsFor(teamId, target));
    expect(res.status).toBe(400);
  });
});
