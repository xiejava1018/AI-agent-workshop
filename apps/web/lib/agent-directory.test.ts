// lib/agent-directory.test.ts
//
// Task 3.2 — Supervisor agent directory discovery.
//
// Contract under test (per design §4 / plan T3.2):
//   resolveAvailableAgents({ teamId, userId }) returns the digital employees
//   the Supervisor may delegate to:
//     - all team-scoped Agents where teamId === opts.teamId
//     - all personal Agents where ownerUserId === opts.userId
//   systemPrompt is NEVER returned (security — keep prompts out of LLM context
//   until the Supervisor actually delegates).
//   Each entry exposes id/name/description/model/scope.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { resolveAvailableAgents, type AgentInfo } from "./agent-directory";

const TEST_PREFIX = "m3-agent-dir-";
const ids = {
  teamA: `${TEST_PREFIX}tA-${Math.random().toString(36).slice(2, 8)}`,
  teamB: `${TEST_PREFIX}tB-${Math.random().toString(36).slice(2, 8)}`,
  userX: `${TEST_PREFIX}uX-${Math.random().toString(36).slice(2, 8)}`,
  userY: `${TEST_PREFIX}uY-${Math.random().toString(36).slice(2, 8)}`,
  teamAgent: `${TEST_PREFIX}agTeam-${Math.random().toString(36).slice(2, 8)}`,
  otherTeamAgent: `${TEST_PREFIX}agOtherTeam-${Math.random().toString(36).slice(2, 8)}`,
  userXPersonal: `${TEST_PREFIX}agPersonalX-${Math.random().toString(36).slice(2, 8)}`,
  userYPersonal: `${TEST_PREFIX}agPersonalY-${Math.random().toString(36).slice(2, 8)}`,
};

let createdAgentIds: string[] = [];

beforeEach(async () => {
  createdAgentIds = [];
  // team-scoped agent for teamA
  const ta = await prisma.agent.create({
    data: {
      id: ids.teamAgent,
      name: "代码审查员 (teamA)",
      description: "review PR",
      systemPrompt: "you are a reviewer",
      model: "anthropic/claude-opus-4-8",
      scope: "team",
      teamId: ids.teamA,
    },
  });
  createdAgentIds.push(ta.id);

  // team-scoped agent for a DIFFERENT team — must not leak into teamA results
  const ot = await prisma.agent.create({
    data: {
      id: ids.otherTeamAgent,
      name: "其他团队员工",
      description: "other team only",
      systemPrompt: "secret prompt",
      model: "anthropic/claude-sonnet-4-5",
      scope: "team",
      teamId: ids.teamB,
    },
  });
  createdAgentIds.push(ot.id);

  // personal agent owned by userX
  const ux = await prisma.agent.create({
    data: {
      id: ids.userXPersonal,
      name: "我的私人助理 (userX)",
      description: "personal for X",
      systemPrompt: "private prompt X",
      model: "openai/gpt-5",
      scope: "personal",
      ownerUserId: ids.userX,
    },
  });
  createdAgentIds.push(ux.id);

  // personal agent owned by userY — must not leak into userX results
  const uy = await prisma.agent.create({
    data: {
      id: ids.userYPersonal,
      name: "我的私人助理 (userY)",
      description: "personal for Y",
      systemPrompt: "private prompt Y",
      model: "openai/gpt-5",
      scope: "personal",
      ownerUserId: ids.userY,
    },
  });
  createdAgentIds.push(uy.id);
});

afterEach(async () => {
  for (const id of createdAgentIds) {
    await prisma.agent.delete({ where: { id } }).catch(() => {});
  }
});

describe("resolveAvailableAgents (Task 3.2)", () => {
  it("returns an array of AgentInfo", async () => {
    const agents = await resolveAvailableAgents({
      teamId: ids.teamA,
      userId: ids.userX,
    });
    expect(Array.isArray(agents)).toBe(true);
    for (const a of agents) {
      expect(a).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        description: expect.any(String),
        model: expect.any(String),
        scope: expect.any(String),
      } satisfies Partial<Record<keyof AgentInfo, unknown>>);
    }
  });

  it("includes team-scoped agents of the requested team", async () => {
    const agents = await resolveAvailableAgents({
      teamId: ids.teamA,
      userId: ids.userX,
    });
    const idsFound = agents.map((a) => a.id);
    expect(idsFound).toContain(ids.teamAgent);
  });

  it("includes personal agents owned by the requested user", async () => {
    const agents = await resolveAvailableAgents({
      teamId: ids.teamA,
      userId: ids.userX,
    });
    const idsFound = agents.map((a) => a.id);
    expect(idsFound).toContain(ids.userXPersonal);
  });

  it("filters out personal agents owned by other users", async () => {
    const agents = await resolveAvailableAgents({
      teamId: ids.teamA,
      userId: ids.userX,
    });
    const idsFound = agents.map((a) => a.id);
    expect(idsFound).not.toContain(ids.userYPersonal);
  });

  it("filters out team-scoped agents of other teams", async () => {
    const agents = await resolveAvailableAgents({
      teamId: ids.teamA,
      userId: ids.userX,
    });
    const idsFound = agents.map((a) => a.id);
    expect(idsFound).not.toContain(ids.otherTeamAgent);
  });

  it("never returns systemPrompt (security: prompts stay server-side until delegation)", async () => {
    const agents = await resolveAvailableAgents({
      teamId: ids.teamA,
      userId: ids.userX,
    });
    for (const a of agents) {
      // The AgentInfo interface must not expose systemPrompt at all —
      // check the object shape, not just the value.
      expect(Object.prototype.hasOwnProperty.call(a, "systemPrompt")).toBe(false);
    }
  });

  it("returns an empty list when called for an unknown teamId and userId with no personal agents", async () => {
    const agents = await resolveAvailableAgents({
      teamId: `${TEST_PREFIX}nonexistent`,
      userId: `${TEST_PREFIX}nobody`,
    });
    expect(agents).toEqual([]);
  });

  it("still returns team agents when userId is omitted (team-only scope)", async () => {
    const agents = await resolveAvailableAgents({ teamId: ids.teamA });
    const idsFound = agents.map((a) => a.id);
    expect(idsFound).toContain(ids.teamAgent);
    expect(idsFound).not.toContain(ids.userXPersonal);
    expect(idsFound).not.toContain(ids.userYPersonal);
  });
});
