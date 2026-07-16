// app/api/admin/users/[id]/reset-password/route.test.ts
//
// T4.2 — admin password reset API tests.
//
// Covers POST /api/admin/users/[id]/reset-password:
//   - 401 when x-user-id missing
//   - 403 for MEMBER caller (forged header cannot elevate)
//   - 400 when resetting own password
//   - 404 when target missing
//   - 403 when ADMIN targets an OWNER
//   - OWNER resets a MEMBER: returns initialPassword once, stores bcrypt hash,
//     mustChangePassword=true, hash matches the returned plaintext.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "../../../../../../lib/prisma";

const TEST_USERNAME_PREFIX = "test-admin-rp-";
const TEST_TEAM_PREFIX = "test-admin-rp-team-";

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

async function makeUser(
  role: "OWNER" | "ADMIN" | "MEMBER",
  label: string
): Promise<{ userId: string; teamId: string }> {
  const user = await prisma.user.create({
    data: {
      username: uniqueUsername(label),
      passwordHash: await bcrypt.hash(`${label}-pass-1234`, 10),
      mustChangePassword: false,
    },
  });
  const team = await prisma.team.create({
    data: { name: uniqueTeamName(`${label}-team`), ownerUserId: user.id },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: user.id, role },
  });
  return { userId: user.id, teamId: team.id };
}

function makeReq(
  id: string,
  opts: { callerId?: string | null; callerRole?: string | null }
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.callerId !== null && opts.callerId !== undefined) {
    headers["x-user-id"] = opts.callerId;
  }
  if (opts.callerRole !== null && opts.callerRole !== undefined) {
    headers["x-user-role"] = opts.callerRole;
  }
  return new NextRequest(
    `http://localhost:30141/api/admin/users/${id}/reset-password`,
    { method: "POST", headers }
  );
}

describe("POST /api/admin/users/[id]/reset-password", () => {
  it("returns 401 when x-user-id header is missing", async () => {
    const { POST } = await import("./route");
    const { userId: targetId } = await makeUser("MEMBER", "t");
    const res = await POST(makeReq(targetId, { callerId: null }), {
      params: Promise.resolve({ id: targetId }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for MEMBER caller even with a forged OWNER header", async () => {
    const { POST } = await import("./route");
    const { userId: callerId } = await makeUser("MEMBER", "caller");
    const { userId: targetId } = await makeUser("MEMBER", "t");
    const res = await POST(
      makeReq(targetId, { callerId, callerRole: "OWNER" }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when resetting own password", async () => {
    const { POST } = await import("./route");
    const { userId: callerId } = await makeUser("OWNER", "caller");
    const res = await POST(
      makeReq(callerId, { callerId, callerRole: "OWNER" }),
      { params: Promise.resolve({ id: callerId }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the target user does not exist", async () => {
    const { POST } = await import("./route");
    const { userId: callerId } = await makeUser("OWNER", "caller");
    const missingId = "nonexistent-cuid";
    const res = await POST(
      makeReq(missingId, { callerId, callerRole: "OWNER" }),
      { params: Promise.resolve({ id: missingId }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 when ADMIN targets an OWNER", async () => {
    const { POST } = await import("./route");
    const { userId: callerId } = await makeUser("ADMIN", "caller");
    const { userId: targetId } = await makeUser("OWNER", "t");
    const res = await POST(
      makeReq(targetId, { callerId, callerRole: "ADMIN" }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(403);
  });

  it("OWNER resets a MEMBER: returns initialPassword, stores hash, sets mustChangePassword=true", async () => {
    const { POST } = await import("./route");
    const { userId: callerId } = await makeUser("OWNER", "caller");
    const { userId: targetId } = await makeUser("MEMBER", "t");
    const oldHash = (
      await prisma.user.findUnique({ where: { id: targetId } })
    )!.passwordHash;

    const res = await POST(
      makeReq(targetId, { callerId, callerRole: "OWNER" }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.initialPassword).toBe("string");
    expect(body.initialPassword.length).toBeGreaterThanOrEqual(16);

    const stored = await prisma.user.findUnique({ where: { id: targetId } });
    expect(stored).not.toBeNull();
    expect(stored!.mustChangePassword).toBe(true);
    // The stored hash changed and is NOT the plaintext.
    expect(stored!.passwordHash).not.toBe(oldHash);
    expect(stored!.passwordHash).not.toBe(body.initialPassword);
    expect(
      await bcrypt.compare(body.initialPassword, stored!.passwordHash)
    ).toBe(true);
  });
});
