/**
 * app/api/digital-employees/route.test.ts
 *
 * Task 4.1 — digital employees CRUD API tests.
 *
 * Covers:
 *   POST /api/digital-employees
 *     - 401 when x-user-id missing
 *     - 400 when name missing
 *     - 400 when scope is neither "team" nor "personal"
 *     - 403 when MEMBER tries to create a team-scoped agent
 *     - 403 when creating team agent for a team caller is not ADMIN/OWNER of
 *     - personal agent: ownerUserId = callerId
 *     - team agent: teamId set, caller must be ADMIN/OWNER of that team
 *     - skillIds/mcpServerIds create binding rows in transaction
 *     - returns created agent with bindings
 *   GET /api/digital-employees
 *     - 401 when x-user-id missing
 *     - returns personal agents owned by caller
 *     - returns team agents where caller is ADMIN/OWNER
 *     - scope query param filters results
 *     - teamId query param filters team agents
 *
 * Uses real SQLite DB via prisma. Test rows are cleaned in beforeEach/afterEach.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// -----------------------------------------------------------------------------
// Test fixtures helpers
// -----------------------------------------------------------------------------

const TEST_PREFIX = "test-de-";

function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now().toString(36)}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanTestRows(): Promise<void> {
  // Find agents first (no relation defined on binding tables)
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

  // Find teams first (no relation defined on teamMember)
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

async function makeUser(role: "OWNER" | "ADMIN" | "MEMBER"): Promise<{ userId: string; teamId: string }> {
  const username = uniqueName(role.toLowerCase());
  const user = await prisma.user.create({
    data: {
      username,
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

// -----------------------------------------------------------------------------
// Request helpers
// -----------------------------------------------------------------------------

function makePostReq(opts: {
  callerId?: string | null;
  body?: unknown;
}): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  return new NextRequest("http://localhost:30141/api/digital-employees", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

function makeGetReq(opts: {
  callerId?: string | null;
  scope?: string;
  teamId?: string;
}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  const url = new URL("http://localhost:30141/api/digital-employees");
  if (opts.scope) url.searchParams.set("scope", opts.scope);
  if (opts.teamId) url.searchParams.set("teamId", opts.teamId);
  return new NextRequest(url.toString(), { method: "GET", headers });
}

// -----------------------------------------------------------------------------
// POST tests
// -----------------------------------------------------------------------------

describe("POST /api/digital-employees", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makePostReq({ callerId: null, body: { name: "Agent" } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "auth required" });
  });

  it("returns 400 when name is missing", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const res = await POST(makePostReq({ callerId: userId, body: {} }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "name required" });
  });

  it("returns 400 when name is empty string", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const res = await POST(makePostReq({ callerId: userId, body: { name: "" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "name required" });
  });

  it("returns 400 when scope is invalid", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const res = await POST(makePostReq({ callerId: userId, body: { name: "A", scope: "invalid" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'scope must be "team" or "personal"' });
  });

  it("returns 400 when scope=team but teamId is missing", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const res = await POST(makePostReq({ callerId: userId, body: { name: "A", scope: "team" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "teamId required for team-scoped agent" });
  });

  it("returns 403 when MEMBER tries to create team-scoped agent", async () => {
    const { POST } = await import("./route");
    const { userId, teamId } = await makeUser("MEMBER");
    const res = await POST(
      makePostReq({ callerId: userId, body: { name: "A", scope: "team", teamId } })
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when caller does not belong to the target team", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const { teamId: otherTeamId } = await makeUser("MEMBER");
    // userId is OWNER of their own team, but tries to create agent in otherTeamId
    const res = await POST(
      makePostReq({ callerId: userId, body: { name: "A", scope: "team", teamId: otherTeamId } })
    );
    expect(res.status).toBe(403);
  });

  it("creates a personal agent with ownerUserId = callerId", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const res = await POST(
      makePostReq({ callerId: userId, body: { name: "My Agent", scope: "personal" } })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("My Agent");
    expect(body.scope).toBe("personal");
    expect(body.ownerUserId).toBe(userId);
    expect(body.teamId).toBeNull();
  });

  it("creates a team agent when caller is OWNER of the team", async () => {
    const { POST } = await import("./route");
    const { userId, teamId } = await makeUser("OWNER");
    const res = await POST(
      makePostReq({ callerId: userId, body: { name: "Team Agent", scope: "team", teamId } })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Team Agent");
    expect(body.scope).toBe("team");
    expect(body.teamId).toBe(teamId);
    expect(body.ownerUserId).toBeNull();
  });

  it("creates a team agent when caller is ADMIN of the team", async () => {
    const { POST } = await import("./route");
    const { userId, teamId } = await makeUser("ADMIN");
    const res = await POST(
      makePostReq({ callerId: userId, body: { name: "Admin Agent", scope: "team", teamId } })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.scope).toBe("team");
  });

  it("creates agent with skill and MCP bindings", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("MEMBER");

    // Create a SkillPackage and McpServer to reference
    const skill = await prisma.skillPackage.create({
      data: { slug: "test-skill", name: "Test Skill", scope: "global", source: "builtin", filePath: "/skills/test" },
    });
    const mcp = await prisma.mcpServer.create({
      data: { name: "test-mcp", transport: "stdio", command: "npx test-mcp", scope: "global" },
    });

    const res = await POST(
      makePostReq({
        callerId: userId,
        body: {
          name: "Agent with Bindings",
          scope: "personal",
          skillIds: [skill.id],
          mcpServerIds: [mcp.id],
        },
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.skillBindings).toHaveLength(1);
    expect(body.mcpBindings).toHaveLength(1);
    expect(body.skillBindings[0].skillPackageId).toBe(skill.id);
    expect(body.mcpBindings[0].mcpServerId).toBe(mcp.id);
  });

  it("returns 201 with all fields on success", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const res = await POST(
      makePostReq({
        callerId: userId,
        body: {
          name: " Full Agent ",
          description: "A helpful agent",
          systemPrompt: "You are helpful",
          model: "claude-3",
          scope: "personal",
        },
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe(" Full Agent ".trim()); // trimmed
    expect(body.description).toBe("A helpful agent");
    expect(body.systemPrompt).toBe("You are helpful");
    expect(body.model).toBe("claude-3");
  });
});

// -----------------------------------------------------------------------------
// GET list tests
// -----------------------------------------------------------------------------

describe("GET /api/digital-employees", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetReq({ callerId: null }));
    expect(res.status).toBe(401);
  });

  it("returns personal agents owned by caller", async () => {
    const { GET, POST } = await import("./route");
    const { userId } = await makeUser("MEMBER");

    // Create two personal agents
    await POST(makePostReq({ callerId: userId, body: { name: "Agent A", scope: "personal" } }));
    await POST(makePostReq({ callerId: userId, body: { name: "Agent B", scope: "personal" } }));

    const res = await GET(makeGetReq({ callerId: userId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(2);
    const names = body.agents.map((a: { name: string }) => a.name);
    expect(names).toContain("Agent A");
    expect(names).toContain("Agent B");
  });

  it("does not return other users' personal agents", async () => {
    const { GET, POST } = await import("./route");
    const { userId: user1 } = await makeUser("MEMBER");
    const { userId: user2 } = await makeUser("MEMBER");

    await POST(makePostReq({ callerId: user1, body: { name: "User1 Agent", scope: "personal" } }));

    const res = await GET(makeGetReq({ callerId: user2 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const user1Agents = body.agents.filter((a: { ownerUserId: string | null }) => a.ownerUserId === user1);
    expect(user1Agents).toHaveLength(0);
  });

  it("returns team agents where caller is OWNER", async () => {
    const { GET, POST } = await import("./route");
    const { userId, teamId } = await makeUser("OWNER");

    await POST(makePostReq({ callerId: userId, body: { name: "Team Agent", scope: "team", teamId } }));

    const res = await GET(makeGetReq({ callerId: userId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents.some((a: { name: string }) => a.name === "Team Agent")).toBe(true);
  });

  it("does not return team agents where caller is only MEMBER", async () => {
    const { GET, POST } = await import("./route");
    const { userId: ownerId, teamId } = await makeUser("OWNER");
    const { userId: memberId } = await makeUser("MEMBER");
    // Add member to the owner's team
    await prisma.teamMember.create({ data: { teamId, userId: memberId, role: "MEMBER" } });

    await POST(makePostReq({ callerId: ownerId, body: { name: "Owner's Agent", scope: "team", teamId } }));

    const res = await GET(makeGetReq({ callerId: memberId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const teamAgents = body.agents.filter((a: { scope: string }) => a.scope === "team");
    expect(teamAgents).toHaveLength(0);
  });

  it("scope=personal query param returns only personal agents", async () => {
    const { GET, POST } = await import("./route");
    const { userId, teamId } = await makeUser("OWNER");

    await POST(makePostReq({ callerId: userId, body: { name: "Personal", scope: "personal" } }));
    await POST(makePostReq({ callerId: userId, body: { name: "Team", scope: "team", teamId } }));

    const res = await GET(makeGetReq({ callerId: userId, scope: "personal" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const scopes = body.agents.map((a: { scope: string }) => a.scope);
    expect(scopes).not.toContain("team");
  });

  it("scope=team query param returns only team agents", async () => {
    const { GET, POST } = await import("./route");
    const { userId, teamId } = await makeUser("OWNER");

    await POST(makePostReq({ callerId: userId, body: { name: "Personal", scope: "personal" } }));
    await POST(makePostReq({ callerId: userId, body: { name: "Team", scope: "team", teamId } }));

    const res = await GET(makeGetReq({ callerId: userId, scope: "team" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const scopes = body.agents.map((a: { scope: string }) => a.scope);
    expect(scopes).not.toContain("personal");
  });

  it("teamId query param filters team agents to only that team", async () => {
    const { GET, POST } = await import("./route");
    const { userId, teamId } = await makeUser("OWNER");
    const { teamId: otherTeamId } = await makeUser("ADMIN");

    // Caller is admin of otherTeamId so they can create agents there
    await POST(makePostReq({ callerId: userId, body: { name: "Agent In My Team", scope: "team", teamId } }));
    // Create an agent in otherTeamId — caller is ADMIN there
    await POST(makePostReq({ callerId: userId, body: { name: "Agent In Other Team", scope: "team", teamId: otherTeamId } }));

    // Filter by teamId=teamId should return only "Agent In My Team"
    const res = await GET(makeGetReq({ callerId: userId, teamId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.agents.map((a: { name: string }) => a.name);
    expect(names).toContain("Agent In My Team");
    expect(names).not.toContain("Agent In Other Team");
  });
});
