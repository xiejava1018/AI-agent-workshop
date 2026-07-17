import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { getCurrentUserContext, getUserTeamIds } from "./server-user";
import { getUserHighestRole } from "./user-role";

let testUserId: string;
let testTeamId: string;

beforeAll(async () => {
  // Ensure a test user with a team exists
  const user = await prisma.user.upsert({
    where: { username: "test-server-user" },
    create: {
      username: "test-server-user",
      passwordHash: "x",
      mustChangePassword: false,
    },
    update: {},
  });
  testUserId = user.id;

  const team = await prisma.team.upsert({
    where: { id: "test-team-server-user" },
    create: { id: "test-team-server-user", name: "Test Team", ownerUserId: testUserId },
    update: {},
  });
  testTeamId = team.id;

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: testTeamId, userId: testUserId } },
    create: { teamId: testTeamId, userId: testUserId, role: "OWNER" },
    update: { role: "OWNER" },
  });
});

afterAll(async () => {
  // Clean up
  await prisma.teamMember.deleteMany({ where: { userId: testUserId } });
  await prisma.team.delete({ where: { id: testTeamId } }).catch(() => {});
  await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  await prisma.$disconnect();
});

describe("getUserHighestRole", () => {
  it("returns OWNER for the test user", async () => {
    expect(await getUserHighestRole(testUserId)).toBe("OWNER");
  });

  it("returns null for non-existent user", async () => {
    expect(await getUserHighestRole("nonexistent-user-id-xyz")).toBeNull();
  });
});

describe("getUserTeamIds", () => {
  it("returns the test user's team", async () => {
    const ids = await getUserTeamIds(testUserId);
    expect(ids).toContain(testTeamId);
  });

  it("returns empty array for non-existent user", async () => {
    expect(await getUserTeamIds("nonexistent-user-id-xyz")).toEqual([]);
  });
});

describe("getCurrentUserContext", () => {
  it("returns full context for valid user", async () => {
    const ctx = await getCurrentUserContext(testUserId);
    expect(ctx).not.toBeNull();
    expect(ctx!.user.username).toBe("test-server-user");
    expect(ctx!.role).toBe("OWNER");
    expect(ctx!.teamIds).toContain(testTeamId);
    expect(ctx!.mustChangePassword).toBe(false);
  });

  it("returns null for non-existent user", async () => {
    expect(await getCurrentUserContext("nonexistent-user-id-xyz")).toBeNull();
  });
});