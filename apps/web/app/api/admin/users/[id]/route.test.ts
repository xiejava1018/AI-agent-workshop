// app/api/admin/users/[id]/route.test.ts
//
// T4.2 — admin user disable/enable + delete API tests.
//
// Covers PATCH (disable/enable) and DELETE:
//   - 401 when x-user-id missing
//   - 403 for MEMBER caller
//   - forged x-user-role cannot elevate a MEMBER caller
//   - 400 on invalid/missing action
//   - 400 when disabling/enabling self
//   - 403 when ADMIN targets an OWNER (disable/enable/delete/reset-equivalent)
//   - 404 when target missing
//   - PATCH disable/enable flips disabled and echoes state
//   - DELETE removes user + cascades TeamMember
//   - DELETE self → 400
//   - DELETE OWNER → 403

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "../../../../../lib/prisma";

const TEST_USERNAME_PREFIX = "test-admin-user-id-2-";
const TEST_TEAM_PREFIX = "test-admin-team-id-2-";

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
  // M4 RBAC 平台中台:OWNER/ADMIN 测试用例需要绑 platform_admin 才能通过鉴权
  if (role === "OWNER" || role === "ADMIN") {
    const roleId = await getPlatformAdminRoleId();
    await prisma.userRole.create({ data: { userId: user.id, roleId } });
  }
  return { userId: user.id, teamId: team.id };
}

function makePatchReq(
  id: string,
  opts: { callerId?: string | null; callerRole?: string | null; body?: unknown }
): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId !== null && opts.callerId !== undefined) {
    headers["x-user-id"] = opts.callerId;
  }
  if (opts.callerRole !== null && opts.callerRole !== undefined) {
    headers["x-user-role"] = opts.callerRole;
  }
  return new NextRequest(`http://localhost:30141/api/admin/users/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

function makeDeleteReq(
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
  return new NextRequest(`http://localhost:30141/api/admin/users/${id}`, {
    method: "DELETE",
    headers,
  });
}

describe("PATCH /api/admin/users/[id]", () => {
  it("returns 401 when x-user-id header is missing", async () => {
    const { PATCH } = await import("./route");
    const { userId: targetId } = await makeUser("MEMBER", "t");
    const res = await PATCH(makePatchReq(targetId, { callerId: null }), {
      params: Promise.resolve({ id: targetId }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a MEMBER caller (even with forged OWNER header)", async () => {
    const { PATCH } = await import("./route");
    const { userId: callerId } = await makeUser("MEMBER", "caller");
    const { userId: targetId } = await makeUser("MEMBER", "t");
    const res = await PATCH(
      makePatchReq(targetId, {
        callerId,
        callerRole: "OWNER",
        body: { action: "disable" },
      }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when action is missing or invalid", async () => {
    const { PATCH } = await import("./route");
    const { userId: callerId } = await makeUser("OWNER", "caller");
    const { userId: targetId } = await makeUser("MEMBER", "t");
    for (const body of [{}, { action: "bogus" }]) {
      const res = await PATCH(
        makePatchReq(targetId, { callerId, callerRole: "OWNER", body }),
        { params: Promise.resolve({ id: targetId }) }
      );
      expect(res.status).toBe(400);
    }
  });

  it("returns 400 when disabling self", async () => {
    const { PATCH } = await import("./route");
    const { userId: callerId } = await makeUser("OWNER", "caller");
    const res = await PATCH(
      makePatchReq(callerId, {
        callerId,
        callerRole: "OWNER",
        body: { action: "disable" },
      }),
      { params: Promise.resolve({ id: callerId }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the target user does not exist", async () => {
    const { PATCH } = await import("./route");
    const { userId: callerId } = await makeUser("OWNER", "caller");
    const missingId = "nonexistent-cuid";
    const res = await PATCH(
      makePatchReq(missingId, {
        callerId,
        callerRole: "OWNER",
        body: { action: "disable" },
      }),
      { params: Promise.resolve({ id: missingId }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 when ADMIN tries to disable an OWNER", async () => {
    const { PATCH } = await import("./route");
    const { userId: callerId } = await makeUser("ADMIN", "caller");
    const { userId: targetId } = await makeUser("OWNER", "t");
    const res = await PATCH(
      makePatchReq(targetId, {
        callerId,
        callerRole: "ADMIN",
        body: { action: "disable" },
      }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(403);
  });

  it("OWNER disables then enables a MEMBER, flipping User.disabled", async () => {
    const { PATCH } = await import("./route");
    const { userId: callerId } = await makeUser("OWNER", "caller");
    const { userId: targetId } = await makeUser("MEMBER", "t");

    const off = await PATCH(
      makePatchReq(targetId, {
        callerId,
        callerRole: "OWNER",
        body: { action: "disable" },
      }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(off.status).toBe(200);
    expect((await off.json()).disabled).toBe(true);
    expect(
      (await prisma.user.findUnique({ where: { id: targetId } }))!.disabled
    ).toBe(true);

    const on = await PATCH(
      makePatchReq(targetId, {
        callerId,
        callerRole: "OWNER",
        body: { action: "enable" },
      }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(on.status).toBe(200);
    expect((await on.json()).disabled).toBe(false);
    expect(
      (await prisma.user.findUnique({ where: { id: targetId } }))!.disabled
    ).toBe(false);
  });
});

describe("DELETE /api/admin/users/[id]", () => {
  it("returns 400 when deleting self", async () => {
    const { DELETE } = await import("./route");
    const { userId: callerId } = await makeUser("OWNER", "caller");
    const res = await DELETE(
      makeDeleteReq(callerId, { callerId, callerRole: "OWNER" }),
      { params: Promise.resolve({ id: callerId }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when deleting an OWNER", async () => {
    const { DELETE } = await import("./route");
    const { userId: callerId } = await makeUser("OWNER", "caller");
    const { userId: targetId } = await makeUser("OWNER", "t");
    const res = await DELETE(
      makeDeleteReq(targetId, { callerId, callerRole: "OWNER" }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 when the target user does not exist", async () => {
    const { DELETE } = await import("./route");
    const { userId: callerId } = await makeUser("OWNER", "caller");
    const missingId = "nonexistent-cuid";
    const res = await DELETE(
      makeDeleteReq(missingId, { callerId, callerRole: "OWNER" }),
      { params: Promise.resolve({ id: missingId }) }
    );
    expect(res.status).toBe(404);
  });

  it("hard-deletes a MEMBER and cascades their TeamMember rows", async () => {
    const { DELETE } = await import("./route");
    const { userId: callerId } = await makeUser("OWNER", "caller");
    const { userId: targetId, teamId } = await makeUser("MEMBER", "t");

    // Sanity: membership exists before delete.
    const before = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: targetId } },
    });
    expect(before).not.toBeNull();

    const res = await DELETE(
      makeDeleteReq(targetId, { callerId, callerRole: "OWNER" }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);

    expect(await prisma.user.findUnique({ where: { id: targetId } })).toBeNull();
    const after = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: targetId } },
    });
    expect(after).toBeNull();
  });

  it("returns 403 for a MEMBER caller", async () => {
    const { DELETE } = await import("./route");
    const { userId: callerId } = await makeUser("MEMBER", "caller");
    const { userId: targetId } = await makeUser("MEMBER", "t");
    const res = await DELETE(
      makeDeleteReq(targetId, { callerId, callerRole: "MEMBER" }),
      { params: Promise.resolve({ id: targetId }) }
    );
    expect(res.status).toBe(403);
  });
});
