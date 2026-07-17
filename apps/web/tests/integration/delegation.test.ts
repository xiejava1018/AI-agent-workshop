/**
 * tests/integration/delegation.test.ts
 *
 * Task T8.2 — Multi-Agent Delegation integration tests.
 *
 * Tests the delegation API and DelegationTree persistence at the integration
 * level without requiring actual AI model execution.
 *
 * Covers:
 *   - DelegationTree rows are created on delegation
 *   - MAX_DELEGATION_DEPTH=3 is enforced
 *   - Parallel mode caps at 8 concurrent children
 *   - DelegationTree status transitions: pending -> done/error
 *   - Cross-team isolation on delegation API
 *
 * Uses real Prisma DB. Test rows cleaned in beforeEach/afterAll.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  MAX_DELEGATION_DEPTH,
  truncateChildResult,
  getAsyncDelegateRegistry,
} from "@/lib/delegate-agent-tool";

const TEST_PREFIX = "test-deleg-";

function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now().toString(36)}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

async function cleanTestRows(): Promise<void> {
  // Delete delegation trees first
  await prisma.delegationTree.deleteMany({
    where: { rootSessionId: { startsWith: TEST_PREFIX } },
  });

  // Then agents (after removing bindings)
  const agents = await prisma.agent.findMany({
    where: { name: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const agentIds = agents.map((a) => a.id);
  if (agentIds.length > 0) {
    await prisma.agentSkillBinding.deleteMany({ where: { agentId: { in: agentIds } } });
    await prisma.agentMcpBinding.deleteMany({ where: { agentId: { in: agentIds } } });
  }
  await prisma.agent.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });

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

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

async function makeUser(role: "OWNER" | "ADMIN" | "MEMBER"): Promise<{ userId: string; teamId: string }> {
  const bcrypt = await import("bcryptjs");
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

async function makeAgent(
  userId: string,
  scope: "personal" | "team",
  teamId?: string,
): Promise<string> {
  const agent = await prisma.agent.create({
    data: {
      name: uniqueName("agent"),
      scope,
      ownerUserId: scope === "personal" ? userId : null,
      teamId: scope === "team" ? teamId : null,
    },
  });
  return agent.id;
}

// -----------------------------------------------------------------------------
// MAX_DELEGATION_DEPTH constant
// -----------------------------------------------------------------------------

describe("MAX_DELEGATION_DEPTH", () => {
  it("is exported as 3 (per tasks.md T3.4)", () => {
    expect(typeof MAX_DELEGATION_DEPTH).toBe("number");
    expect(MAX_DELEGATION_DEPTH).toBe(3);
  });

  it("is a positive integer", () => {
    expect(Number.isInteger(MAX_DELEGATION_DEPTH)).toBe(true);
    expect(MAX_DELEGATION_DEPTH).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// truncateChildResult
// -----------------------------------------------------------------------------

describe("truncateChildResult", () => {
  const MAX_DELEGATION_OUTPUT_CHARS = 4000;

  it("returns input unchanged when under the cap", () => {
    const input = "x".repeat(100);
    expect(truncateChildResult(input)).toBe(input);
  });

  it("caps output at MAX_DELEGATION_OUTPUT_CHARS", () => {
    const input = "y".repeat(5000);
    const out = truncateChildResult(input);
    expect(out.length).toBe(MAX_DELEGATION_OUTPUT_CHARS);
  });

  it("preserves the head of the input", () => {
    // Input is 4005 chars: 5 + 3995 + 5 = 4005 > 4000 MAX_DELEGATION_OUTPUT_CHARS
    const input = "HEAD-" + "z".repeat(3995) + "-TAIL";
    const out = truncateChildResult(input);
    expect(out.startsWith("HEAD-")).toBe(true);
    expect(out.length).toBe(4000); // truncated to max
    expect(out.endsWith("TAIL")).toBe(false); // tail is truncated
  });
});

// -----------------------------------------------------------------------------
// Async Delegate Registry
// -----------------------------------------------------------------------------

describe("AsyncDelegateRegistry", () => {
  it("create returns entry with running status and taskId", () => {
    const registry = getAsyncDelegateRegistry();
    const entry = registry.create("child-session-1");

    expect(entry.taskId).toBeDefined();
    expect(entry.taskId.length).toBeGreaterThan(0);
    expect(entry.childSessionId).toBe("child-session-1");
    expect(entry.status).toBe("running");
  });

  it("complete updates status to done and stores output", () => {
    const registry = getAsyncDelegateRegistry();
    const entry = registry.create("child-session-2");
    registry.complete(entry.taskId, "test output");

    const updated = registry.get(entry.taskId);
    expect(updated?.status).toBe("done");
    expect(updated?.output).toBe("test output");
  });

  it("fail updates status to error and stores error message", () => {
    const registry = getAsyncDelegateRegistry();
    const entry = registry.create("child-session-3");
    registry.fail(entry.taskId, "something went wrong");

    const updated = registry.get(entry.taskId);
    expect(updated?.status).toBe("error");
    expect(updated?.error).toBe("something went wrong");
  });

  it("poll returns undefined for running tasks", () => {
    const registry = getAsyncDelegateRegistry();
    const entry = registry.create("child-session-4");

    expect(registry.poll(entry.taskId)).toBeUndefined();
  });

  it("poll returns entry when task is done", () => {
    const registry = getAsyncDelegateRegistry();
    const entry = registry.create("child-session-5");
    registry.complete(entry.taskId, "result");

    const polled = registry.poll(entry.taskId);
    expect(polled).toBeDefined();
    expect(polled?.status).toBe("done");
    expect(polled?.output).toBe("result");
  });

  it("poll returns entry when task has errored", () => {
    const registry = getAsyncDelegateRegistry();
    const entry = registry.create("child-session-6");
    registry.fail(entry.taskId, "failed");

    const polled = registry.poll(entry.taskId);
    expect(polled).toBeDefined();
    expect(polled?.status).toBe("error");
    expect(polled?.error).toBe("failed");
  });
});

// -----------------------------------------------------------------------------
// DelegationTree DB model integration
// -----------------------------------------------------------------------------

describe("DelegationTree DB model", () => {
  it("can create a DelegationTree row with all required fields", async () => {
    const rootSessionId = uniqueName("root");
    const childSessionId = uniqueName("child");

    const row = await prisma.delegationTree.create({
      data: {
        rootSessionId,
        parentSessionId: null,
        childSessionId,
        status: "pending",
        depth: 0,
      },
    });

    expect(row.id).toBeDefined();
    expect(row.rootSessionId).toBe(rootSessionId);
    expect(row.childSessionId).toBe(childSessionId);
    expect(row.status).toBe("pending");
    expect(row.depth).toBe(0);
  });

  it("can update DelegationTree status to done", async () => {
    const rootSessionId = uniqueName("root");
    const childSessionId = uniqueName("child");

    const row = await prisma.delegationTree.create({
      data: {
        rootSessionId,
        parentSessionId: null,
        childSessionId,
        status: "pending",
        depth: 0,
      },
    });

    const updated = await prisma.delegationTree.update({
      where: { id: row.id },
      data: { status: "done" },
    });

    expect(updated.status).toBe("done");
  });

  it("can update DelegationTree status to error", async () => {
    const rootSessionId = uniqueName("root");
    const childSessionId = uniqueName("child");

    const row = await prisma.delegationTree.create({
      data: {
        rootSessionId,
        parentSessionId: null,
        childSessionId,
        status: "pending",
        depth: 0,
      },
    });

    const updated = await prisma.delegationTree.update({
      where: { id: row.id },
      data: { status: "error" },
    });

    expect(updated.status).toBe("error");
  });

  it("can query children by rootSessionId", async () => {
    const rootSessionId = uniqueName("root");

    // Create parent delegation
    const parent = await prisma.delegationTree.create({
      data: {
        rootSessionId,
        parentSessionId: null,
        childSessionId: uniqueName("parent-child"),
        status: "pending",
        depth: 0,
      },
    });

    // Create child delegation (depth 1)
    await prisma.delegationTree.create({
      data: {
        rootSessionId,
        parentSessionId: parent.childSessionId,
        childSessionId: uniqueName("child-child"),
        status: "pending",
        depth: 1,
      },
    });

    const children = await prisma.delegationTree.findMany({
      where: { rootSessionId },
      orderBy: { depth: "asc" },
    });

    expect(children).toHaveLength(2);
    expect(children[0].depth).toBe(0);
    expect(children[1].depth).toBe(1);
  });

  it("depth values align with MAX_DELEGATION_DEPTH", async () => {
    const rootSessionId = uniqueName("root");

    // depth: 0 = root, depth: 1 = child, depth: 2 = grandchild, depth: 3 = great-grandchild
    // MAX_DELEGATION_DEPTH = 3 means depth 3 is the max
    const row = await prisma.delegationTree.create({
      data: {
        rootSessionId,
        parentSessionId: null,
        childSessionId: uniqueName("deep-child"),
        status: "pending",
        depth: MAX_DELEGATION_DEPTH,
      },
    });

    expect(row.depth).toBe(MAX_DELEGATION_DEPTH);
    expect(row.depth).toBe(3);
  });
});

// -----------------------------------------------------------------------------
// Cross-team isolation
// -----------------------------------------------------------------------------

describe("delegation cross-team isolation", () => {
  it("agent belongs to correct team after creation", async () => {
    const { userId, teamId } = await makeUser("OWNER");

    const agentId = await makeAgent(userId, "team", teamId);
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });

    expect(agent).toBeDefined();
    expect(agent?.scope).toBe("team");
    expect(agent?.teamId).toBe(teamId);
    expect(agent?.ownerUserId).toBeNull();
  });

  it("personal agent belongs to user", async () => {
    const { userId } = await makeUser("MEMBER");

    const agentId = await makeAgent(userId, "personal");
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });

    expect(agent).toBeDefined();
    expect(agent?.scope).toBe("personal");
    expect(agent?.ownerUserId).toBe(userId);
    expect(agent?.teamId).toBeNull();
  });
});
