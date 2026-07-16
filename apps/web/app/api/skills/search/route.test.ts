/**
 * app/api/skills/search/route.test.ts
 *
 * Task 5.2 — SkillPackage scope-filtered GET search tests.
 *
 * Covers:
 *   GET /api/skills/search
 *     - 401 when x-user-id missing
 *     - 401 when user doesn't exist
 *     - returns all skills when no filters provided
 *     - filters by scope=global
 *     - filters by scope=team (restricts to caller's teams)
 *     - filters by scope=user (restricts to caller's own packages)
 *     - filters by q text search (name/description case-insensitive)
 *     - combines q + scope filters together
 *
 * Uses real SQLite DB via prisma. Test rows are cleaned in beforeEach/afterEach.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-skill-srch-";

function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now().toString(36)}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanTestRows(): Promise<void> {
  // Delete ALL skill packages (shared DB with other tests, hardcoded names don't
  // follow the prefix pattern so prefix-only filtering is insufficient).
  await prisma.skillPackage.deleteMany({});
  await prisma.teamMember.deleteMany({
    where: { team: { name: { startsWith: TEST_PREFIX } } },
  });
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

async function makeUser(): Promise<{ userId: string; teamId: string }> {
  const username = uniqueName("user");
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: "not-needed",
      mustChangePassword: false,
    },
  });
  const team = await prisma.team.create({
    data: { name: uniqueName("team"), ownerUserId: user.id },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: user.id, role: "MEMBER" },
  });
  return { userId: user.id, teamId: team.id };
}

async function seedSkillPackage(data: {
  slug: string;
  name: string;
  description?: string;
  scope: string;
  teamId?: string | null;
  userId?: string | null;
}): Promise<string> {
  const sp = await prisma.skillPackage.create({
    data: {
      slug: data.slug,
      name: data.name,
      description: data.description ?? "",
      scope: data.scope,
      source: "builtin",
      filePath: `/skills/${data.slug}`,
      teamId: data.teamId ?? null,
      userId: data.userId ?? null,
      enabled: true,
    },
  });
  return sp.id;
}

function makeGetReq(opts: {
  callerId?: string | null;
  q?: string;
  scope?: string;
}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  const url = new URL("http://localhost:30141/api/skills/search");
  if (opts.q) url.searchParams.set("q", opts.q);
  if (opts.scope) url.searchParams.set("scope", opts.scope);
  return new NextRequest(url.toString(), { method: "GET", headers });
}

describe("GET /api/skills/search", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetReq({ callerId: null }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "auth required" });
  });

  it("returns 401 when userId does not correspond to a real user", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetReq({ callerId: "nonexistent-id" }));
    expect(res.status).toBe(401);
  });

  it("returns all skills when no query or scope filter is provided", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser();

    await seedSkillPackage({ slug: uniqueName("build"), name: "Build Tool", scope: "global" });
    await seedSkillPackage({ slug: uniqueName("deploy"), name: "Deploy Script", scope: "global", userId: null, teamId: null });

    const res = await GET(makeGetReq({ callerId: userId }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skills.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by scope=global", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser();

  await seedSkillPackage({ slug: uniqueName("global"), name: "Global Skill", scope: "global" });
    await seedSkillPackage({ slug: uniqueName("team"), name: "Team Skill", scope: "team", userId: null, teamId: null });
    // team scope requires the caller's teamId, but without a real teamId it won't match
    // — still, scope=global should only return global ones.

    const res = await GET(makeGetReq({ callerId: userId, scope: "global" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skills.every((s: { scope: string }) => s.scope === "global")).toBe(true);
  });

  it("filters by scope=team and restricts to caller's teams", async () => {
    const { GET } = await import("./route");
    const { userId, teamId } = await makeUser();

    const otherTeam = await prisma.team.create({
      data: { name: uniqueName("other-team"), ownerUserId: userId },
    });

    // The user is NOT a member of otherTeam, so team-scoped packages under otherTeam
    // should NOT appear.

    const myPkgId = await seedSkillPackage({
      slug: "my-team-skill", name: "My Team Skill", scope: "team", teamId,
    });
    await seedSkillPackage({
      slug: "other-team-skill", name: "Other Team Skill", scope: "team", teamId: otherTeam.id,
    });

    const res = await GET(makeGetReq({ callerId: userId, scope: "team" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skills.length).toBe(1);
    expect(json.skills[0].id).toBe(myPkgId);
    expect(json.skills[0].scope).toBe("team");
  });

  it("filters by scope=user and restricts to caller's own packages", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser();

    const otherUser = await prisma.user.create({
      data: {
        username: uniqueName("other-user"),
        passwordHash: "pw",
        mustChangePassword: false,
      },
    });

    const myPkgId = await seedSkillPackage({
      slug: "my-user-skill", name: "My User Skill", scope: "user", userId,
    });
    await seedSkillPackage({
      slug: "other-user-skill", name: "Other User Skill", scope: "user", userId: otherUser.id,
    });

    const res = await GET(makeGetReq({ callerId: userId, scope: "user" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skills.length).toBe(1);
    expect(json.skills[0].id).toBe(myPkgId);
    expect(json.skills[0].scope).toBe("user");
  });

  it("filters by q text search on name (case-insensitive)", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser();

    await seedSkillPackage({ slug: uniqueName("cr"), name: "Code Review", scope: "global" });
    await seedSkillPackage({ slug: uniqueName("commit"), name: "Commit Message", scope: "global" });

    const res = await GET(makeGetReq({ callerId: userId, q: "code" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skills.length).toBe(1);
    expect(json.skills[0].name).toBe("Code Review");
  });

  it("filters by q text search on description (case-insensitive)", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser();

    await seedSkillPackage({
      slug: uniqueName("deploy"), name: "Deploy Helper", description: "Helps with deployment automation", scope: "global",
    });
    await seedSkillPackage({
      slug: uniqueName("test"), name: "Test Helper", description: "Runs unit tests", scope: "global",
    });

    const res = await GET(makeGetReq({ callerId: userId, q: "deployment" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skills.length).toBe(1);
    expect(json.skills[0].name).toBe("Deploy Helper");
  });

  it("combines q and scope filters together", async () => {
    const { GET } = await import("./route");
    const { userId, teamId } = await makeUser();

    await seedSkillPackage({
      slug: "lint-global", name: "Lint Global", description: "A linter for all", scope: "global",
    });
    await seedSkillPackage({
      slug: "lint-team", name: "Lint Team", description: "A linter for the team", scope: "team", teamId,
    });
    await seedSkillPackage({
      slug: "build-tool", name: "Build Tool", description: "Builds things", scope: "global",
    });

    const res = await GET(makeGetReq({ callerId: userId, q: "lint", scope: "team" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skills.length).toBe(1);
    expect(json.skills[0].slug).toBe("lint-team");
  });
});
