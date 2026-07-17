/**
 * tests/integration/cascade-delete.test.ts
 *
 * Task 7.4 — cascade delete bindings tests.
 *
 * Verifies that deleting an Agent, SkillPackage, or McpServer also removes
 * its related binding rows (AgentSkillBinding, AgentMcpBinding, UserSkillBinding).
 *
 * Uses the real DB via prisma. Test rows are cleaned in beforeEach/afterAll.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-cascade-";

function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now().toString(36)}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanTestRows(): Promise<void> {
  // Binding tables first (no FK cycles)
  await prisma.agentSkillBinding.deleteMany({ where: { skillPackageId: { startsWith: TEST_PREFIX } } });
  await prisma.agentMcpBinding.deleteMany({ where: { mcpServerId: { startsWith: TEST_PREFIX } } });
  await prisma.userSkillBinding.deleteMany({ where: { skillPackageId: { startsWith: TEST_PREFIX } } });
  await prisma.agentSkillBinding.deleteMany({ where: { agentId: { startsWith: TEST_PREFIX } } });
  await prisma.agentMcpBinding.deleteMany({ where: { agentId: { startsWith: TEST_PREFIX } } });

  // Agent depends on bindings already deleted
  await prisma.agent.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.skillPackage.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
  await prisma.mcpServer.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: TEST_PREFIX } } });
  await prisma.team.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
}

beforeEach(async () => {
  await cleanTestRows();
});

afterAll(async () => {
  await cleanTestRows();
  await prisma.$disconnect();
});

describe("cascade delete bindings", () => {
  // -------------------------------------------------------------------------
  // Agent deletion cascades to AgentSkillBinding + AgentMcpBinding
  // -------------------------------------------------------------------------
  it("deleting agent removes its AgentSkillBinding rows", async () => {
    const skill = await prisma.skillPackage.create({
      data: { slug: uniqueName("skill"), name: "Test Skill", scope: "global" },
    });

    const agent = await prisma.agent.create({
      data: { name: uniqueName("agent"), scope: "personal" },
    });

    await prisma.agentSkillBinding.create({
      data: { agentId: agent.id, skillPackageId: skill.id, mode: "include" },
    });

    // Verify binding exists
    const before = await prisma.agentSkillBinding.findMany({ where: { agentId: agent.id } });
    expect(before.length).toBe(1);

    // Delete agent — bindings should be cascade-removed
    await prisma.agent.delete({ where: { id: agent.id } });

    const after = await prisma.agentSkillBinding.findMany({ where: { agentId: agent.id } });
    expect(after.length).toBe(0);
  });

  it("deleting agent removes its AgentMcpBinding rows", async () => {
    const mcp = await prisma.mcpServer.create({
      data: { name: uniqueName("mcp"), scope: "global" },
    });

    const agent = await prisma.agent.create({
      data: { name: uniqueName("agent"), scope: "personal" },
    });

    await prisma.agentMcpBinding.create({
      data: { agentId: agent.id, mcpServerId: mcp.id, mode: "include" },
    });

    const before = await prisma.agentMcpBinding.findMany({ where: { agentId: agent.id } });
    expect(before.length).toBe(1);

    await prisma.agent.delete({ where: { id: agent.id } });

    const after = await prisma.agentMcpBinding.findMany({ where: { agentId: agent.id } });
    expect(after.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // SkillPackage deletion cascades to AgentSkillBinding + UserSkillBinding
  // -------------------------------------------------------------------------
  it("deleting skillPackage removes its AgentSkillBinding rows", async () => {
    const skill = await prisma.skillPackage.create({
      data: { slug: uniqueName("skill"), name: "Test Skill", scope: "global" },
    });

    const agent = await prisma.agent.create({
      data: { name: uniqueName("agent"), scope: "personal" },
    });

    await prisma.agentSkillBinding.create({
      data: { agentId: agent.id, skillPackageId: skill.id, mode: "include" },
    });

    const before = await prisma.agentSkillBinding.findMany({ where: { skillPackageId: skill.id } });
    expect(before.length).toBe(1);

    await prisma.skillPackage.delete({ where: { id: skill.id } });

    const after = await prisma.agentSkillBinding.findMany({ where: { skillPackageId: skill.id } });
    expect(after.length).toBe(0);
  });

  it("deleting skillPackage removes its UserSkillBinding rows", async () => {
    const user = await prisma.user.create({
      data: {
        username: uniqueName("user"),
        passwordHash: "dummy",
      },
    });

    const skill = await prisma.skillPackage.create({
      data: { slug: uniqueName("skill"), name: "Test Skill", scope: "user", userId: user.id },
    });

    await prisma.userSkillBinding.create({
      data: { userId: user.id, skillPackageId: skill.id, mode: "include" },
    });

    const before = await prisma.userSkillBinding.findMany({ where: { skillPackageId: skill.id } });
    expect(before.length).toBe(1);

    await prisma.skillPackage.delete({ where: { id: skill.id } });

    const after = await prisma.userSkillBinding.findMany({ where: { skillPackageId: skill.id } });
    expect(after.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // McpServer deletion cascades to AgentMcpBinding
  // -------------------------------------------------------------------------
  it("deleting mcpServer removes its AgentMcpBinding rows", async () => {
    const mcp = await prisma.mcpServer.create({
      data: { name: uniqueName("mcp"), scope: "global" },
    });

    const agent = await prisma.agent.create({
      data: { name: uniqueName("agent"), scope: "personal" },
    });

    await prisma.agentMcpBinding.create({
      data: { agentId: agent.id, mcpServerId: mcp.id, mode: "include" },
    });

    const before = await prisma.agentMcpBinding.findMany({ where: { mcpServerId: mcp.id } });
    expect(before.length).toBe(1);

    await prisma.mcpServer.delete({ where: { id: mcp.id } });

    const after = await prisma.agentMcpBinding.findMany({ where: { mcpServerId: mcp.id } });
    expect(after.length).toBe(0);
  });
});
