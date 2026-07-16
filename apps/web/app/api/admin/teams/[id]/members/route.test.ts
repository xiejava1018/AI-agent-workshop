/**
 * app/api/admin/teams/[id]/members/route.test.ts
 *
 * Task 4.3 — Add member tests.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-tmember-";

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

/** Create a team + owner (OWNER membership) and return both ids. */
async function makeTeamWithOwner(): Promise<{ teamId: string; ownerId: string }> {
  const ownerId = await makePlainUser();
  const team = await prisma.team.create({
    data: { name: uniqueName("subject"), ownerUserId: ownerId },
  });
  await prisma.teamMember.create({ data: { teamId: team.id, userId: ownerId, role: "OWNER" } });
  return { teamId: team.id, ownerId };
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postReq(callerId: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (callerId != null) headers["x-user-id"] = callerId;
  return new NextRequest("http://localhost/api/admin/teams/x/members", {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
}

describe("POST /api/admin/teams/[id]/members", () => {
  it("returns 401 when unauthenticated", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq(null, {}), paramsFor("x"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when team missing", async () => {
    const { POST } = await import("./route");
    const caller = await makePlainUser();
    const res = await POST(postReq(caller, { userId: caller, role: "MEMBER" }), paramsFor("missing"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when caller is not a team admin", async () => {
    const { POST } = await import("./route");
    const { teamId } = await makeTeamWithOwner();
    const stranger = await makePlainUser();
    const target = await makePlainUser();
    const res = await POST(postReq(stranger, { userId: target, role: "MEMBER" }), paramsFor(teamId));
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid role", async () => {
    const { POST } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    const target = await makePlainUser();
    const res = await POST(postReq(ownerId, { userId: target, role: "OWNER" }), paramsFor(teamId));
    expect(res.status).toBe(400);
  });

  it("adds a member when caller is team OWNER", async () => {
    const { POST } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    const target = await makePlainUser();
    const res = await POST(postReq(ownerId, { userId: target, role: "MEMBER" }), paramsFor(teamId));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.member.userId).toBe(target);
    expect(json.member.role).toBe("MEMBER");
  });

  it("returns 409 when user already a member", async () => {
    const { POST } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    const target = await makePlainUser();
    await prisma.teamMember.create({ data: { teamId, userId: target, role: "MEMBER" } });
    const res = await POST(postReq(ownerId, { userId: target, role: "MEMBER" }), paramsFor(teamId));
    expect(res.status).toBe(409);
  });
});
