/**
 * tests/integration/skills-install.test.ts
 *
 * Task 5.1 — scoped skill install (POST /api/skills/install) tests.
 *
 * Covers the new DB-backed `SkillPackage` registration path (body carries
 * `slug`):
 *   - 401 when x-user-id missing
 *   - 400 when slug / name missing or scope invalid
 *   - global scope: OWNER only (403 for ADMIN/MEMBER)
 *   - team scope: OWNER or ADMIN of the team; 400 without teamId; 403 for
 *     non-admin / non-member
 *   - user scope: any authenticated user, userId defaults to caller; installing
 *     for another user requires OWNER
 *   - 409 on duplicate (scope, slug, teamId, userId)
 *
 * Uses the real DB via prisma. Test rows are cleaned in beforeEach/afterAll.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/skills/install/route";

const TEST_PREFIX = "test-skinst-";

function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now().toString(36)}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanTestRows(): Promise<void> {
  await prisma.skillPackage.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });

  const teams = await prisma.team.findMany({
    where: { name: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length > 0) {
    await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } });
  }
  await prisma.team.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: TEST_PREFIX } } });
}

beforeEach(async () => {
  await cleanTestRows();
});

afterAll(async () => {
  await cleanTestRows();
  await prisma.$disconnect();
});

/** Create a user who holds `role` in a fresh team. */
async function makeUser(
  role: "OWNER" | "ADMIN" | "MEMBER",
): Promise<{ userId: string; teamId: string }> {
  const user = await prisma.user.create({
    data: {
      username: uniqueName(role.toLowerCase()),
      passwordHash: await bcrypt.hash("pass-1234", 10),
      mustChangePassword: false,
    },
  });
  const team = await prisma.team.create({
    data: { name: uniqueName(`team-${role.toLowerCase()}`), ownerUserId: user.id },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: user.id, role },
  });
  return { userId: user.id, teamId: team.id };
}

/** Create a plain user with no team membership. */
async function makeLoneUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: uniqueName("lone"),
      passwordHash: await bcrypt.hash("pass-1234", 10),
      mustChangePassword: false,
    },
  });
  return user.id;
}

function makeReq(opts: { callerId?: string | null; body?: unknown }): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  return new NextRequest("http://localhost:30141/api/skills/install", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

describe("POST /api/skills/install (scoped registration)", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const res = await POST(
      makeReq({ callerId: null, body: { slug: uniqueName("s"), name: "S", scope: "user" } }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "auth required" });
  });

  it("returns 400 when slug is missing", async () => {
    const userId = await makeLoneUser();
    const res = await POST(makeReq({ callerId: userId, body: { name: "S", scope: "user" } }));
    // No `slug` key → falls through to legacy npx path, which needs `package`.
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is missing", async () => {
    const userId = await makeLoneUser();
    const res = await POST(
      makeReq({ callerId: userId, body: { slug: uniqueName("s"), scope: "user" } }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "name required" });
  });

  it("returns 400 when scope is invalid", async () => {
    const userId = await makeLoneUser();
    const res = await POST(
      makeReq({ callerId: userId, body: { slug: uniqueName("s"), name: "S", scope: "bogus" } }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'scope must be "global" | "team" | "user"' });
  });

  // --- global scope ---------------------------------------------------------

  it("global scope: OWNER can install", async () => {
    const { userId } = await makeUser("OWNER");
    const slug = uniqueName("global");
    const res = await POST(
      makeReq({ callerId: userId, body: { slug, name: "Global Skill", scope: "global" } }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.skill.scope).toBe("global");
    expect(json.skill.slug).toBe(slug);
    expect(json.skill.teamId).toBeNull();
    expect(json.skill.userId).toBeNull();
  });

  it("global scope: ADMIN is forbidden (OWNER-only)", async () => {
    const { userId } = await makeUser("ADMIN");
    const res = await POST(
      makeReq({ callerId: userId, body: { slug: uniqueName("g"), name: "G", scope: "global" } }),
    );
    expect(res.status).toBe(403);
  });

  // --- team scope -----------------------------------------------------------

  it("team scope: 400 when teamId missing", async () => {
    const { userId } = await makeUser("OWNER");
    const res = await POST(
      makeReq({ callerId: userId, body: { slug: uniqueName("t"), name: "T", scope: "team" } }),
    );
    expect(res.status).toBe(400);
  });

  it("team scope: ADMIN of the team can install", async () => {
    const { userId, teamId } = await makeUser("ADMIN");
    const slug = uniqueName("team");
    const res = await POST(
      makeReq({ callerId: userId, body: { slug, name: "Team Skill", scope: "team", teamId } }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.skill.scope).toBe("team");
    expect(json.skill.teamId).toBe(teamId);
    expect(json.skill.userId).toBeNull();
  });

  it("team scope: MEMBER of the team is forbidden", async () => {
    const { userId, teamId } = await makeUser("MEMBER");
    const res = await POST(
      makeReq({ callerId: userId, body: { slug: uniqueName("t"), name: "T", scope: "team", teamId } }),
    );
    expect(res.status).toBe(403);
  });

  it("team scope: non-member is forbidden", async () => {
    const outsider = await makeLoneUser();
    const { teamId } = await makeUser("OWNER");
    const res = await POST(
      makeReq({ callerId: outsider, body: { slug: uniqueName("t"), name: "T", scope: "team", teamId } }),
    );
    expect(res.status).toBe(403);
  });

  // --- user scope -----------------------------------------------------------

  it("user scope: any authenticated user installs for themselves (userId defaults to caller)", async () => {
    const userId = await makeLoneUser();
    const slug = uniqueName("user");
    const res = await POST(
      makeReq({ callerId: userId, body: { slug, name: "User Skill", scope: "user" } }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.skill.scope).toBe("user");
    expect(json.skill.userId).toBe(userId);
    expect(json.skill.teamId).toBeNull();
  });

  it("user scope: installing for a different user requires OWNER (403 for non-owner)", async () => {
    const caller = await makeLoneUser();
    const other = await makeLoneUser();
    const res = await POST(
      makeReq({
        callerId: caller,
        body: { slug: uniqueName("u"), name: "U", scope: "user", userId: other },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("user scope: OWNER can install for another user", async () => {
    const { userId: owner } = await makeUser("OWNER");
    const other = await makeLoneUser();
    const slug = uniqueName("user");
    const res = await POST(
      makeReq({
        callerId: owner,
        body: { slug, name: "U", scope: "user", userId: other },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.skill.userId).toBe(other);
  });

  // --- duplicates -----------------------------------------------------------

  it("returns 409 on duplicate (scope, slug, teamId, userId)", async () => {
    const userId = await makeLoneUser();
    const slug = uniqueName("dup");
    const first = await POST(
      makeReq({ callerId: userId, body: { slug, name: "Dup", scope: "user" } }),
    );
    expect(first.status).toBe(201);
    const second = await POST(
      makeReq({ callerId: userId, body: { slug, name: "Dup", scope: "user" } }),
    );
    expect(second.status).toBe(409);
  });
});
