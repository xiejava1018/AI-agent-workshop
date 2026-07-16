// app/api/admin/users/route.test.ts
//
// M2.3 — admin user creation & listing API tests.
//
// Covers:
//   - POST happy path: returns id/username/initialPassword, mustChangePassword=true,
//     createdBy set to caller.
//   - POST non-admin (MEMBER role): 403 forbidden, no user created.
//   - POST missing x-user-id header: 401.
//   - POST with only x-user-id: role is derived from DB (admin allowed, MEMBER denied).
//   - POST forged x-user-role header cannot elevate a MEMBER caller.
//   - POST empty username: 400.
//   - POST duplicate username: 409 username exists.
//   - GET non-admin: 403.
//   - GET returns admin's team users (members of teams the admin is in), with
//     id/username/mustChangePassword/createdBy shape.
//
// Uses real SQLite DB via prisma. Test users are isolated by
// TEST_USERNAME_PREFIX (test-admin-${randomSuffix}-...) and cleaned in
// beforeEach/afterEach.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "../../../../lib/prisma";

const TEST_USERNAME_PREFIX = "test-admin-user-";
const TEST_TEAM_PREFIX = "test-admin-team-";

function uniqueUsername(label: string): string {
  return `${TEST_USERNAME_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function uniqueTeamName(label: string): string {
  return `${TEST_TEAM_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function cleanTestRows(): Promise<void> {
  // Clean up teams first (cascade), then users.
  // NOTE: the POST handler auto-creates a Project bound to the caller's team,
  // so we must delete projects referencing these teams BEFORE the teams —
  // otherwise Project_teamId_fkey blocks the team delete on this shared DB.
  const teams = await prisma.team.findMany({
    where: { name: { startsWith: TEST_TEAM_PREFIX } },
    select: { id: true },
  });
  const teamIds = teams.map(t => t.id);
  if (teamIds.length > 0) {
    await prisma.project.deleteMany({ where: { teamId: { in: teamIds } } });
  }
  await prisma.teamMember.deleteMany({
    where: { team: { name: { startsWith: TEST_TEAM_PREFIX } } },
  });
  await prisma.team.deleteMany({
    where: { name: { startsWith: TEST_TEAM_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USERNAME_PREFIX } },
  });
}

beforeEach(async () => {
  await cleanTestRows();
});

afterAll(async () => {
  await cleanTestRows();
  await prisma.$disconnect();
});

async function makeAdminUser(): Promise<{ userId: string; teamId: string }> {
  const username = uniqueUsername("admin");
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash("admin-pass-1234", 10),
      mustChangePassword: false,
    },
  });
  const team = await prisma.team.create({
    data: {
      name: uniqueTeamName("admin-team"),
      ownerUserId: user.id,
    },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: user.id, role: "OWNER" },
  });
  return { userId: user.id, teamId: team.id };
}

async function makeMemberUser(): Promise<{ userId: string; teamId: string }> {
  const username = uniqueUsername("member");
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash("member-pass-1234", 10),
      mustChangePassword: false,
    },
  });
  const team = await prisma.team.create({
    data: {
      name: uniqueTeamName("member-team"),
      ownerUserId: user.id,
    },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: user.id, role: "MEMBER" },
  });
  return { userId: user.id, teamId: team.id };
}

function makePostReq(opts: {
  callerId?: string | null;
  callerRole?: string | null;
  body?: unknown;
}): NextRequest {
  const url = "http://localhost:30141/api/admin/users";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.callerId !== null && opts.callerId !== undefined) {
    headers["x-user-id"] = opts.callerId;
  }
  if (opts.callerRole !== null && opts.callerRole !== undefined) {
    headers["x-user-role"] = opts.callerRole;
  }
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

function makeGetReq(opts: {
  callerId?: string | null;
  callerRole?: string | null;
}): NextRequest {
  const url = "http://localhost:30141/api/admin/users";
  const headers: Record<string, string> = {};
  if (opts.callerId !== null && opts.callerId !== undefined) {
    headers["x-user-id"] = opts.callerId;
  }
  if (opts.callerRole !== null && opts.callerRole !== undefined) {
    headers["x-user-role"] = opts.callerRole;
  }
  return new NextRequest(url, { method: "GET", headers });
}

describe("POST /api/admin/users", () => {
  it("returns 401 when x-user-id header is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makePostReq({ callerId: null }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "auth required" });
  });

  it("derives an admin role from DB when x-user-role header is missing", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeAdminUser();
    const username = uniqueUsername("role-from-db");
    const res = await POST(
      makePostReq({
        callerId: userId,
        callerRole: null,
        body: { username },
      })
    );

    expect(res.status).toBe(200);
    expect((await res.json()).username).toBe(username);
  });

  it("returns 403 for MEMBER with only x-user-id and no x-user-role", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeMemberUser();
    const blockedUsername = uniqueUsername("missing-role");
    const res = await POST(
      makePostReq({
        callerId: userId,
        callerRole: null,
        body: { username: blockedUsername },
      })
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(
      await prisma.user.findUnique({ where: { username: blockedUsername } })
    ).toBeNull();
  });

  it("returns 403 when MEMBER forges an OWNER role header", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeMemberUser();
    const blockedUsername = uniqueUsername("forged-role");
    const res = await POST(
      makePostReq({
        callerId: userId,
        callerRole: "OWNER",
        body: { username: blockedUsername },
      })
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(
      await prisma.user.findUnique({ where: { username: blockedUsername } })
    ).toBeNull();
  });

  it("returns 403 with forbidden when caller is MEMBER", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeMemberUser();
    const blockedUsername = uniqueUsername("blocked");
    const res = await POST(
      makePostReq({
        callerId: userId,
        callerRole: "MEMBER",
        body: { username: blockedUsername },
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "forbidden" });

    // The blocked-username user must NOT exist
    const blocked = await prisma.user.findUnique({
      where: { username: blockedUsername },
    });
    expect(blocked).toBeNull();
  });

  it("returns 400 when username is empty", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeAdminUser();
    const res = await POST(
      makePostReq({
        callerId: userId,
        callerRole: "OWNER",
        body: { username: "" },
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "username required" });
  });

  it("returns 400 when username is whitespace only", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeAdminUser();
    const res = await POST(
      makePostReq({
        callerId: userId,
        callerRole: "OWNER",
        body: { username: "   " },
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 when username already exists", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeAdminUser();
    const existingUsername = uniqueUsername("dup");
    await prisma.user.create({
      data: {
        username: existingUsername,
        passwordHash: "x",
        mustChangePassword: false,
      },
    });

    const res = await POST(
      makePostReq({
        callerId: userId,
        callerRole: "OWNER",
        body: { username: existingUsername },
      })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "username exists" });
  });

  it("OWNER creates a user: returns id+username+initialPassword, mustChangePassword=true, createdBy set", async () => {
    const { POST } = await import("./route");
    const { userId: adminId } = await makeAdminUser();
    const newUsername = uniqueUsername("alice");

    const res = await POST(
      makePostReq({
        callerId: adminId,
        callerRole: "OWNER",
        body: { username: newUsername },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.username).toBe(newUsername);
    expect(typeof body.initialPassword).toBe("string");
    expect(body.initialPassword.length).toBeGreaterThanOrEqual(16);

    // Verify the user actually exists with the right shape
    const created = await prisma.user.findUnique({
      where: { username: newUsername },
    });
    expect(created).not.toBeNull();
    expect(created!.mustChangePassword).toBe(true);
    expect(created!.createdBy).toBe(adminId);
    expect(created!.createdAt).toBeInstanceOf(Date);
    // The hashed password must not equal the initial password
    expect(created!.passwordHash).not.toBe(body.initialPassword);
    expect(await bcrypt.compare(body.initialPassword, created!.passwordHash)).toBe(
      true
    );
  });

  it("ADMIN (not OWNER) can also create users", async () => {
    const { POST } = await import("./route");
    const { userId: adminId } = await makeAdminUser();
    const newUsername = uniqueUsername("bob");

    const res = await POST(
      makePostReq({
        callerId: adminId,
        callerRole: "ADMIN",
        body: { username: newUsername },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.username).toBe(newUsername);
    expect(body.id).toBeTruthy();
  });

  it("trims leading/trailing whitespace from username before creating", async () => {
    const { POST } = await import("./route");
    const { userId: adminId } = await makeAdminUser();
    const newUsername = uniqueUsername("trim");

    const res = await POST(
      makePostReq({
        callerId: adminId,
        callerRole: "OWNER",
        body: { username: `  ${newUsername}  ` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.username).toBe(newUsername);
  });
});

describe("GET /api/admin/users", () => {
  it("returns 401 when x-user-id header is missing", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetReq({ callerId: null }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is MEMBER", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeMemberUser();
    const res = await GET(makeGetReq({ callerId: userId, callerRole: "MEMBER" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "forbidden" });
  });

  it("returns the admin's team users with id/username/mustChangePassword/createdBy", async () => {
    const { POST, GET } = await import("./route");
    const { userId: adminId, teamId } = await makeAdminUser();

    // Create two new users via the admin endpoint so they are persisted.
    const u1 = uniqueUsername("user1");
    const u2 = uniqueUsername("user2");
    for (const username of [u1, u2]) {
      const createRes = await POST(
        makePostReq({
          callerId: adminId,
          callerRole: "OWNER",
          body: { username },
        })
      );
      expect(createRes.status).toBe(200);
    }

    // The POST handler already auto-binds each created user to the caller's
    // team as a TeamMember, so use upsert to stay idempotent — a plain create
    // would hit the (teamId, userId) unique constraint.
    const createdUsers = await prisma.user.findMany({
      where: { username: { in: [u1, u2] } },
    });
    for (const u of createdUsers) {
      await prisma.teamMember.upsert({
        where: { teamId_userId: { teamId, userId: u.id } },
        update: { role: "MEMBER" },
        create: { teamId, userId: u.id, role: "MEMBER" },
      });
    }

    const res = await GET(makeGetReq({ callerId: adminId, callerRole: "OWNER" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.users)).toBe(true);

    const usernames = body.users.map((x: { username: string }) => x.username);
    expect(usernames).toContain(u1);
    expect(usernames).toContain(u2);

    // Each entry has the right shape
    const user1 = body.users.find((x: { username: string }) => x.username === u1);
    expect(user1.id).toBeTruthy();
    expect(user1.mustChangePassword).toBe(true);
    expect(user1.createdBy).toBe(adminId);
  });
});