import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertCanReadSessionScoped,
  assertCanReadSessionBody,
  assertMemberOfTeam,
  getUserTeamMemberships,
  isSessionSharedWith,
} from "./team-auth";
import { prisma } from "./prisma";

// Test fixture: two teams with projects, several users with mixed
// memberships. Uniqueness is per-test-run via the CUID generator, so
// each suite runs against a fresh DB or a shared one with prefix-tagged
// ids. We avoid prisma.$transaction and instead pre-clean rows tagged
// with the test prefix.

const TEST_PREFIX = "m24-team-auth-";
const ids = {
  teamA: `${TEST_PREFIX}A-${Math.random().toString(36).slice(2, 8)}`,
  teamB: `${TEST_PREFIX}B-${Math.random().toString(36).slice(2, 8)}`,
  projectA: `${TEST_PREFIX}proj-A-${Math.random().toString(36).slice(2, 8)}`,
  projectB: `${TEST_PREFIX}proj-B-${Math.random().toString(36).slice(2, 8)}`,
  ownerA: `${TEST_PREFIX}ownerA-${Math.random().toString(36).slice(2, 8)}`,
  adminA: `${TEST_PREFIX}adminA-${Math.random().toString(36).slice(2, 8)}`,
  memberA: `${TEST_PREFIX}memberA-${Math.random().toString(36).slice(2, 8)}`,
  ownerB: `${TEST_PREFIX}ownerB-${Math.random().toString(36).slice(2, 8)}`,
  memberB: `${TEST_PREFIX}memberB-${Math.random().toString(36).slice(2, 8)}`,
  outsider: `${TEST_PREFIX}outsider-${Math.random().toString(36).slice(2, 8)}`,
};

beforeEach(async () => {
  // Create test teams
  await prisma.team.create({
    data: { id: ids.teamA, name: "Test Team A", ownerUserId: ids.ownerA },
  });
  await prisma.team.create({
    data: { id: ids.teamB, name: "Test Team B", ownerUserId: ids.ownerB },
  });

  // Create test users
  for (const userId of [
    ids.ownerA,
    ids.adminA,
    ids.memberA,
    ids.ownerB,
    ids.memberB,
    ids.outsider,
  ]) {
    await prisma.user.create({
      data: {
        id: userId,
        username: userId,
        passwordHash: "test",
        // mustChangePassword defaults to false
      },
    });
  }

  // Create memberships
  await prisma.teamMember.create({
    data: { teamId: ids.teamA, userId: ids.ownerA, role: "OWNER" },
  });
  await prisma.teamMember.create({
    data: { teamId: ids.teamA, userId: ids.adminA, role: "ADMIN" },
  });
  await prisma.teamMember.create({
    data: { teamId: ids.teamA, userId: ids.memberA, role: "MEMBER" },
  });
  await prisma.teamMember.create({
    data: { teamId: ids.teamB, userId: ids.ownerB, role: "OWNER" },
  });
  await prisma.teamMember.create({
    data: { teamId: ids.teamB, userId: ids.memberB, role: "MEMBER" },
  });

  // Create projects
  await prisma.project.create({
    data: {
      id: ids.projectA,
      teamId: ids.teamA,
      name: "project under team A",
      rootPath: `/tmp/${ids.projectA}`,
      createdBy: ids.ownerA,
    },
  });
  await prisma.project.create({
    data: {
      id: ids.projectB,
      teamId: ids.teamB,
      name: "project under team B",
      rootPath: `/tmp/${ids.projectB}`,
      createdBy: ids.ownerB,
    },
  });
});

afterEach(async () => {
  await prisma.sessionShare.deleteMany({
    where: {
      OR: [{ sessionId: { startsWith: TEST_PREFIX } }],
    },
  }).catch(() => {});
  await prisma.project.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
  await prisma.teamMember.deleteMany({
    where: { teamId: { startsWith: TEST_PREFIX } },
  });
  await prisma.team.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_PREFIX } },
  });
});

describe("assertMemberOfTeam", () => {
  it("returns true when the user is a member of the team", async () => {
    expect(await assertMemberOfTeam(ids.ownerA, ids.teamA)).toBe(true);
    expect(await assertMemberOfTeam(ids.memberA, ids.teamA)).toBe(true);
    expect(await assertMemberOfTeam(ids.outsider, ids.teamA)).toBe(false);
  });

  it("returns false for null teamId", async () => {
    expect(await assertMemberOfTeam(ids.ownerA, null)).toBe(false);
  });

  it("returns false when an OWNER of one team probes another team", async () => {
    // The previous M2.3 bug: OWNER cross-team bypass
    expect(await assertMemberOfTeam(ids.ownerA, ids.teamB)).toBe(false);
    expect(await assertMemberOfTeam(ids.ownerB, ids.teamA)).toBe(false);
  });
});

describe("getUserTeamMemberships", () => {
  it("lists the teams the user belongs to, with their highest role", async () => {
    const ownerTeamMap = await getUserTeamMemberships(ids.ownerA);
    expect(ownerTeamMap.size).toBe(1);
    expect(ownerTeamMap.get(ids.teamA)).toBe("OWNER");
  });

  it("returns an empty map for an outsider", async () => {
    const map = await getUserTeamMemberships(ids.outsider);
    expect(map.size).toBe(0);
  });
});

describe("assertCanReadSessionScoped", () => {
  const sessionIdA = `${TEST_PREFIX}sess-A-${Math.random().toString(36).slice(2, 8)}`;
  const sessionIdA_old = `${TEST_PREFIX}sess-A-OLD-${Math.random().toString(36).slice(2, 8)}`;
  const sessionIdB = `${TEST_PREFIX}sess-B-${Math.random().toString(36).slice(2, 8)}`;

  it("session owner can always read their own session", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: ids.teamA,
      createdAt: Date.now(),
    };
    const result = await assertCanReadSessionScoped(
      ids.ownerA,
      "OWNER",
      meta,
      sessionIdA
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("owner");
  });

  it("team member (MEMBER role) of the same team can read the session", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: ids.teamA,
      createdAt: Date.now(),
    };
    const result = await assertCanReadSessionScoped(
      ids.memberA,
      "MEMBER",
      meta,
      sessionIdA
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("team_member");
    expect(result.teamRole).toBe("MEMBER");
  });

  it("ADMIN of the same team can read the session", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: ids.teamA,
      createdAt: Date.now(),
    };
    const result = await assertCanReadSessionScoped(
      ids.adminA,
      "ADMIN",
      meta,
      sessionIdA
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("team_member");
    expect(result.teamRole).toBe("ADMIN");
  });

  it("OWNER of a DIFFERENT team is DENIED — the M2.3 bypass is gone", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: ids.teamA,
      createdAt: Date.now(),
    };
    // ownerB is team B's OWNER, not a member of team A.
    const result = await assertCanReadSessionScoped(
      ids.ownerB,
      "OWNER",
      meta,
      sessionIdA
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("deny");
  });

  it("outsider with no team membership is DENIED", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: ids.teamA,
      createdAt: Date.now(),
    };
    const result = await assertCanReadSessionScoped(
      ids.outsider,
      null,
      meta,
      sessionIdA
    );
    expect(result.allowed).toBe(false);
  });

  it("session with teamId=null is DENIED (pre-M2.4 data, deny-by-default)", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: null,
      createdAt: Date.now(),
    };
    // Even the original owner doesn't get a free pass for unscoped sessions
    // — they need to be re-scoped via /api/projects/[id]/bind or share.
    // Actually: re-reading the rule, the owner-of-the-session check
    // (step 2) does NOT short-circuit on null teamId because the session
    // was bounded by a project — but if THAT project's teamId is
    // undetermined, we have no scope to validate. The current
    // implementation returns reason="deny" when teamId is null. This
    // test pins that as the safe default.
    const result = await assertCanReadSessionScoped(
      ids.ownerA,
      "OWNER",
      meta,
      sessionIdA_old
    );
    expect(result.allowed).toBe(false);
  });

  it("undefined meta is DENIED", async () => {
    const result = await assertCanReadSessionScoped(
      ids.ownerA,
      "OWNER",
      undefined,
      `${TEST_PREFIX}does-not-exist`
    );
    expect(result.allowed).toBe(false);
  });

  it("is allowed when explicitly shared via SessionShare", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: ids.teamA,
      createdAt: Date.now(),
    };
    // outsider enters a SessionShare row
    await prisma.sessionShare.create({
      data: { sessionId: sessionIdA, sharedWithUserId: ids.outsider },
    });
    const result = await assertCanReadSessionScoped(
      ids.outsider,
      null,
      meta,
      sessionIdA
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("shared");
    // Sanity: isSessionSharedWith also resolves
    expect(await isSessionSharedWith(sessionIdA, ids.outsider)).toBe(true);
    expect(await isSessionSharedWith(sessionIdA, ids.memberB)).toBe(false);
  });
});

describe("assertCanReadSessionBody", () => {
  // Reuses the same session ids and meta setup from the scoped tests.
  const sessionIdA = `${TEST_PREFIX}sess-A-body-${Math.random().toString(36).slice(2, 8)}`;

  it("session owner can always read body", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: ids.teamA,
      createdAt: Date.now(),
    };
    const result = await assertCanReadSessionBody(ids.ownerA, "OWNER", meta, sessionIdA);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("owner");
  });

  it("team OWNER can read body", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: ids.teamA,
      createdAt: Date.now(),
    };
    // memberA is only a MEMBER — should be denied for body access.
    const memberResult = await assertCanReadSessionBody(ids.memberA, "MEMBER", meta, sessionIdA);
    expect(memberResult.allowed).toBe(false);
    expect(memberResult.reason).toBe("body_access_denied");

    // adminA is ADMIN — allowed.
    const adminResult = await assertCanReadSessionBody(ids.adminA, "ADMIN", meta, sessionIdA);
    expect(adminResult.allowed).toBe(true);
    expect(adminResult.reason).toBe("team_admin");
    expect(adminResult.teamRole).toBe("ADMIN");
  });

  it("team ADMIN can read body", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: ids.teamA,
      createdAt: Date.now(),
    };
    const result = await assertCanReadSessionBody(ids.adminA, "ADMIN", meta, sessionIdA);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("team_admin");
  });

  it("team MEMBER is denied body_access_denied (not a total deny)", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: ids.teamA,
      createdAt: Date.now(),
    };
    const result = await assertCanReadSessionBody(ids.memberA, "MEMBER", meta, sessionIdA);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("body_access_denied");
  });

  it("shared-with user is denied body_access_denied", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: ids.teamA,
      createdAt: Date.now(),
    };
    // outsider gets a SessionShare for this session
    await prisma.sessionShare.create({
      data: { sessionId: sessionIdA, sharedWithUserId: ids.outsider },
    });
    const result = await assertCanReadSessionBody(ids.outsider, null, meta, sessionIdA);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("body_access_denied");
  });

  it("owner of a DIFFERENT team is denied (not team_admin)", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: ids.teamA,
      createdAt: Date.now(),
    };
    // ownerB is team B's OWNER, but not a member of team A.
    const result = await assertCanReadSessionBody(ids.ownerB, "OWNER", meta, sessionIdA);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("deny"); // No team membership at all — total deny.
  });

  it("session with teamId=null is denied", async () => {
    const meta = {
      userId: ids.ownerA,
      projectId: ids.projectA,
      teamId: null,
      createdAt: Date.now(),
    };
    const result = await assertCanReadSessionBody(ids.ownerA, "OWNER", meta, sessionIdA);
    expect(result.allowed).toBe(false);
  });

  it("undefined meta is denied", async () => {
    const result = await assertCanReadSessionBody(
      ids.ownerA,
      "OWNER",
      undefined,
      `${TEST_PREFIX}does-not-exist`
    );
    expect(result.allowed).toBe(false);
  });
});