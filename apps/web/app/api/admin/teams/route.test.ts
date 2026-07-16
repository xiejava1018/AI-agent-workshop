/**
 * app/api/admin/teams/route.test.ts
 *
 * Task 4.3 — Team lifecycle API tests (POST create + GET list).
 *
 * Uses the real DB via prisma. Test rows are prefixed and cleaned in
 * beforeEach/afterAll.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-teams-";

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
  // Remove memberships for test users before deleting them.
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

/** Create a standalone user with a given platform role (via a throwaway team). */
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
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: user.id, role },
  });
  return user.id;
}

/** Create a plain user with no team membership (platform role = null). */
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

function makePostReq(opts: { callerId?: string | null; body?: unknown }): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  return new NextRequest("http://localhost/api/admin/teams", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

function makeGetReq(opts: { callerId?: string | null; page?: number; limit?: number }): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  const url = new URL("http://localhost/api/admin/teams");
  if (opts.page != null) url.searchParams.set("page", String(opts.page));
  if (opts.limit != null) url.searchParams.set("limit", String(opts.limit));
  return new NextRequest(url.toString(), { method: "GET", headers });
}

describe("POST /api/admin/teams", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makePostReq({ callerId: null, body: { name: "X", ownerUserId: "y" } }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is ADMIN (OWNER-only)", async () => {
    const { POST } = await import("./route");
    const adminId = await makeUser("ADMIN");
    const ownerTarget = await makePlainUser();
    const res = await POST(
      makePostReq({ callerId: adminId, body: { name: uniqueName("t"), ownerUserId: ownerTarget } }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when name is missing", async () => {
    const { POST } = await import("./route");
    const ownerId = await makeUser("OWNER");
    const res = await POST(makePostReq({ callerId: ownerId, body: { ownerUserId: ownerId } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "name required" });
  });

  it("returns 400 when ownerUserId does not exist", async () => {
    const { POST } = await import("./route");
    const ownerId = await makeUser("OWNER");
    const res = await POST(
      makePostReq({ callerId: ownerId, body: { name: uniqueName("t"), ownerUserId: "nonexistent-id" } }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "ownerUserId does not exist" });
  });

  it("creates a team with an OWNER membership for the owner", async () => {
    const { POST } = await import("./route");
    const ownerId = await makeUser("OWNER");
    const target = await makePlainUser();
    const name = uniqueName("t");
    const res = await POST(makePostReq({ callerId: ownerId, body: { name, ownerUserId: target } }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.team.name).toBe(name);
    expect(json.team.ownerUserId).toBe(target);

    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: json.team.id, userId: target } },
    });
    expect(membership?.role).toBe("OWNER");
  });
});

describe("GET /api/admin/teams", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetReq({ callerId: null }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for MEMBER", async () => {
    const { GET } = await import("./route");
    const memberId = await makeUser("MEMBER");
    const res = await GET(makeGetReq({ callerId: memberId }));
    expect(res.status).toBe(403);
  });

  it("returns teams with member count and owner info for ADMIN", async () => {
    const { GET } = await import("./route");
    const adminId = await makeUser("ADMIN");
    const res = await GET(makeGetReq({ callerId: adminId, limit: 100 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.teams)).toBe(true);
    expect(typeof json.total).toBe("number");
    for (const t of json.teams) {
      expect(typeof t.memberCount).toBe("number");
      expect("ownerUsername" in t).toBe(true);
    }
  });

  it("caps limit at 100", async () => {
    const { GET } = await import("./route");
    const adminId = await makeUser("ADMIN");
    const res = await GET(makeGetReq({ callerId: adminId, limit: 9999 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.limit).toBe(100);
  });
});
