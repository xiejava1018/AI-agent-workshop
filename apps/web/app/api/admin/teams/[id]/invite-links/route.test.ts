/**
 * app/api/admin/teams/[id]/invite-links/route.test.ts
 *
 * Task 4.3 — Invite link list / create tests.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-tinvite-";

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

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(method: string, callerId: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (callerId != null) headers["x-user-id"] = callerId;
  return new NextRequest("http://localhost/api/admin/teams/x/invite-links", {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/admin/teams/[id]/invite-links", () => {
  it("returns 401 when unauthenticated", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq("POST", null, {}), paramsFor("x"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a stranger", async () => {
    const { POST } = await import("./route");
    const { teamId } = await makeTeamWithOwner();
    const stranger = await makePlainUser();
    const res = await POST(makeReq("POST", stranger, {}), paramsFor(teamId));
    expect(res.status).toBe(403);
  });

  it("creates an invite link with a token and default expiry", async () => {
    const { POST } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    const res = await POST(makeReq("POST", ownerId, { role: "MEMBER" }), paramsFor(teamId));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(typeof json.inviteLink.token).toBe("string");
    expect(json.inviteLink.token.length).toBeGreaterThan(10);
    expect(json.inviteLink.role).toBe("MEMBER");
    expect(new Date(json.inviteLink.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects invalid role", async () => {
    const { POST } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    const res = await POST(makeReq("POST", ownerId, { role: "OWNER" }), paramsFor(teamId));
    expect(res.status).toBe(400);
  });

  it("rejects non-positive expiresInHours", async () => {
    const { POST } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    const res = await POST(makeReq("POST", ownerId, { expiresInHours: 0 }), paramsFor(teamId));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/teams/[id]/invite-links", () => {
  it("returns only active (unused, unexpired) links", async () => {
    const { GET } = await import("./route");
    const { teamId, ownerId } = await makeTeamWithOwner();
    // Active
    await prisma.inviteLink.create({
      data: { teamId, token: uniqueName("active"), expiresAt: new Date(Date.now() + 3600_000) },
    });
    // Expired
    await prisma.inviteLink.create({
      data: { teamId, token: uniqueName("expired"), expiresAt: new Date(Date.now() - 3600_000) },
    });
    // Used
    await prisma.inviteLink.create({
      data: {
        teamId,
        token: uniqueName("used"),
        expiresAt: new Date(Date.now() + 3600_000),
        usedBy: ownerId,
      },
    });
    const res = await GET(makeReq("GET", ownerId), paramsFor(teamId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.inviteLinks.length).toBe(1);
  });
});
