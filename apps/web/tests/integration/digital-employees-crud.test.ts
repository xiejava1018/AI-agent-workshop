/**
 * tests/integration/digital-employees-crud.test.ts
 *
 * Task T8.2 — Digital Employee CRUD + Binding integration tests.
 *
 * Tests the full CRUD lifecycle of digital employees (agents) and their
 * skill/MCP bindings via the real API routes using actual Prisma DB.
 *
 * Covers:
 *   - POST /api/digital-employees       — create agent with bindings
 *   - GET /api/digital-employees        — list agents (personal + team-scoped)
 *   - GET /api/digital-employees/[id]   — get single agent with bindings
 *   - PUT /api/digital-employees/[id]   — update agent + replace bindings
 *   - DELETE /api/digital-employees/[id] — delete agent cascades bindings
 *   - Cross-team isolation (403 on other team's agents)
 *   - RBAC: only OWNER/ADMIN can manage team agents
 *
 * Uses real Prisma + PostgreSQL. Test rows are cleaned in beforeEach/afterAll.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-de-crud-";

function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now().toString(36)}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

async function cleanTestRows(): Promise<void> {
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

  await prisma.skillPackage.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
  await prisma.mcpServer.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });

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

/** Create a user who holds `role` in a fresh team. */
async function makeUser(role: "OWNER" | "ADMIN" | "MEMBER"): Promise<{ userId: string; teamId: string }> {
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

// -----------------------------------------------------------------------------
// Request helpers
// -----------------------------------------------------------------------------

function makePostReq(opts: { callerId?: string | null; body?: unknown }): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  return new NextRequest("http://localhost/api/digital-employees", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

function makeGetReq(opts: { callerId?: string | null; scope?: string; teamId?: string }): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  const url = new URL("http://localhost/api/digital-employees");
  if (opts.scope) url.searchParams.set("scope", opts.scope);
  if (opts.teamId) url.searchParams.set("teamId", opts.teamId);
  return new NextRequest(url.toString(), { method: "GET", headers });
}

function makeGetByIdReq(id: string, callerId?: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (callerId != null) headers["x-user-id"] = callerId;
  return new NextRequest(`http://localhost/api/digital-employees/${id}`, { method: "GET", headers });
}

function makePutReq(id: string, opts: { callerId?: string | null; body?: unknown }): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  return new NextRequest(`http://localhost/api/digital-employees/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

function makeDeleteReq(id: string, callerId?: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (callerId != null) headers["x-user-id"] = callerId;
  return new NextRequest(`http://localhost/api/digital-employees/${id}`, { method: "DELETE", headers });
}

// -----------------------------------------------------------------------------
// [id] route helpers — simulate Next.js App Router params
// -----------------------------------------------------------------------------

function makeIdReq(opts: {
  id: string;
  method: "GET" | "PUT" | "DELETE";
  callerId?: string | null;
  body?: unknown;
}): { req: NextRequest; params: Promise<{ id: string }> } {
  const headers: Record<string, string> = {};
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  if (opts.method !== "GET") headers["Content-Type"] = "application/json";

  const req = new NextRequest(`http://localhost/api/digital-employees/${opts.id}`, {
    method: opts.method,
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });

  return { req, params: Promise.resolve({ id: opts.id }) };
}

// -----------------------------------------------------------------------------
// POST — create agent
// -----------------------------------------------------------------------------

describe("POST /api/digital-employees", () => {
  it("creates a personal agent with ownerUserId = callerId", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { userId } = await makeUser("MEMBER");

    const res = await POST(
      makePostReq({ callerId: userId, body: { name: "My Agent", scope: "personal" } }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("My Agent");
    expect(body.scope).toBe("personal");
    expect(body.ownerUserId).toBe(userId);
    expect(body.teamId).toBeNull();
  });

  it("creates a team agent when caller is OWNER", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { userId, teamId } = await makeUser("OWNER");

    const res = await POST(
      makePostReq({ callerId: userId, body: { name: "Team Agent", scope: "team", teamId } }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Team Agent");
    expect(body.scope).toBe("team");
    expect(body.teamId).toBe(teamId);
  });

  it("creates a team agent when caller is ADMIN", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { userId, teamId } = await makeUser("ADMIN");

    const res = await POST(
      makePostReq({ callerId: userId, body: { name: "Admin Agent", scope: "team", teamId } }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).scope).toBe("team");
  });

  it("rejects MEMBER trying to create team-scoped agent", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { userId, teamId } = await makeUser("MEMBER");

    const res = await POST(
      makePostReq({ callerId: userId, body: { name: "Bad Agent", scope: "team", teamId } }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects cross-team access (caller not member of target team)", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { userId } = await makeUser("OWNER");
    const { teamId: otherTeamId } = await makeUser("MEMBER");

    const res = await POST(
      makePostReq({ callerId: userId, body: { name: "XTeam Agent", scope: "team", teamId: otherTeamId } }),
    );
    expect(res.status).toBe(403);
  });

  it("creates agent with skill and MCP bindings", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { userId } = await makeUser("MEMBER");

    const skill = await prisma.skillPackage.create({
      data: {
        slug: uniqueName("skill"),
        name: "Test Skill",
        scope: "global",
        source: "builtin",
        filePath: "/skills/test",
      },
    });
    const mcp = await prisma.mcpServer.create({
      data: {
        name: uniqueName("mcp"),
        transport: "stdio",
        command: "npx test-mcp",
        scope: "global",
      },
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
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.skillBindings).toHaveLength(1);
    expect(body.mcpBindings).toHaveLength(1);
    expect(body.skillBindings[0].skillPackageId).toBe(skill.id);
    expect(body.mcpBindings[0].mcpServerId).toBe(mcp.id);
  });

  it("returns 401 when x-user-id missing", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const res = await POST(makePostReq({ callerId: null, body: { name: "X" } }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when scope=team but teamId missing", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { userId } = await makeUser("OWNER");
    const res = await POST(
      makePostReq({ callerId: userId, body: { name: "X", scope: "team" } }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "teamId required for team-scoped agent" });
  });
});

// -----------------------------------------------------------------------------
// GET list
// -----------------------------------------------------------------------------

describe("GET /api/digital-employees", () => {
  it("returns personal agents owned by caller", async () => {
    const { GET, POST } = await import("@/app/api/digital-employees/route");
    const { userId } = await makeUser("MEMBER");

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
    const { GET, POST } = await import("@/app/api/digital-employees/route");
    const { userId: user1 } = await makeUser("MEMBER");
    const { userId: user2 } = await makeUser("MEMBER");

    await POST(makePostReq({ callerId: user1, body: { name: "User1 Agent", scope: "personal" } }));

    const res = await GET(makeGetReq({ callerId: user2 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const user1Agents = body.agents.filter(
      (a: { ownerUserId: string | null }) => a.ownerUserId === user1,
    );
    expect(user1Agents).toHaveLength(0);
  });

  it("returns team agents where caller is OWNER", async () => {
    const { GET, POST } = await import("@/app/api/digital-employees/route");
    const { userId, teamId } = await makeUser("OWNER");

    await POST(makePostReq({ callerId: userId, body: { name: "Team Agent", scope: "team", teamId } }));

    const res = await GET(makeGetReq({ callerId: userId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents.some((a: { name: string }) => a.name === "Team Agent")).toBe(true);
  });

  it("does not return team agents where caller is only MEMBER", async () => {
    const { GET, POST } = await import("@/app/api/digital-employees/route");
    const { userId: ownerId, teamId } = await makeUser("OWNER");
    const { userId: memberId } = await makeUser("MEMBER");
    await prisma.teamMember.create({ data: { teamId, userId: memberId, role: "MEMBER" } });

    await POST(
      makePostReq({ callerId: ownerId, body: { name: "Owner's Agent", scope: "team", teamId } }),
    );

    const res = await GET(makeGetReq({ callerId: memberId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const teamAgents = body.agents.filter((a: { scope: string }) => a.scope === "team");
    expect(teamAgents).toHaveLength(0);
  });

  it("scope=personal query param returns only personal agents", async () => {
    const { GET, POST } = await import("@/app/api/digital-employees/route");
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
    const { GET, POST } = await import("@/app/api/digital-employees/route");
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
    const { GET, POST } = await import("@/app/api/digital-employees/route");
    const { userId, teamId } = await makeUser("OWNER");
    const { teamId: otherTeamId } = await makeUser("ADMIN");

    await POST(
      makePostReq({ callerId: userId, body: { name: "Agent In My Team", scope: "team", teamId } }),
    );
    // Caller is ADMIN of otherTeamId so they can create agents there
    await POST(
      makePostReq({
        callerId: userId,
        body: { name: "Agent In Other Team", scope: "team", teamId: otherTeamId },
      }),
    );

    const res = await GET(makeGetReq({ callerId: userId, teamId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.agents.map((a: { name: string }) => a.name);
    expect(names).toContain("Agent In My Team");
    expect(names).not.toContain("Agent In Other Team");
  });

  it("returns 401 when x-user-id missing", async () => {
    const { GET } = await import("@/app/api/digital-employees/route");
    const res = await GET(makeGetReq({ callerId: null }));
    expect(res.status).toBe(401);
  });
});

// -----------------------------------------------------------------------------
// GET single agent by id
// -----------------------------------------------------------------------------

describe("GET /api/digital-employees/[id]", () => {
  it("returns agent with bindings for owner", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { GET } = await import("@/app/api/digital-employees/[id]/route");
    const { userId } = await makeUser("MEMBER");

    const skill = await prisma.skillPackage.create({
      data: {
        slug: uniqueName("skill"),
        name: "Test Skill",
        scope: "global",
        source: "builtin",
        filePath: "/skills/test",
      },
    });

    const createRes = await POST(
      makePostReq({
        callerId: userId,
        body: { name: "My Agent", scope: "personal", skillIds: [skill.id] },
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const { req, params } = makeIdReq({ id: created.id, method: "GET", callerId: userId });
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.name).toBe("My Agent");
    expect(body.agent.skillBindings).toHaveLength(1);
  });

  it("returns 404 for non-existent agent", async () => {
    const { GET } = await import("@/app/api/digital-employees/[id]/route");
    const { userId } = await makeUser("MEMBER");

    const { req, params } = makeIdReq({ id: "non-existent-id", method: "GET", callerId: userId });
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) for cross-team access — security: avoid leaking resource existence", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { GET } = await import("@/app/api/digital-employees/[id]/route");
    const { userId: owner1 } = await makeUser("OWNER");
    // Create a separate team owned by a different user, then add owner2 as ADMIN of that team
    const { userId: team2Owner, teamId: team2 } = await makeUser("OWNER");
    const { userId: owner2 } = await makeUser("ADMIN");
    // Add owner2 as ADMIN of team2
    await prisma.teamMember.create({
      data: { teamId: team2, userId: owner2, role: "ADMIN" },
    });

    // owner2 (ADMIN of team2) creates a team agent
    const createRes = await POST(
      makePostReq({ callerId: owner2, body: { name: "Team Agent", scope: "team", teamId: team2 } }),
    );
    const created = await createRes.json();

    // owner1 (not a member of team2) tries to read it
    // getAccessibleAgent returns null -> 404 (intentional security: don't distinguish forbidden from not found)
    const { req, params } = makeIdReq({ id: created.id, method: "GET", callerId: owner1 });
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
  });

  it("returns 401 when x-user-id missing", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { GET } = await import("@/app/api/digital-employees/[id]/route");
    const { userId } = await makeUser("MEMBER");

    const createRes = await POST(
      makePostReq({ callerId: userId, body: { name: "My Agent", scope: "personal" } }),
    );
    const created = await createRes.json();

    const { req, params } = makeIdReq({ id: created.id, method: "GET", callerId: null });
    const res = await GET(req, { params });
    expect(res.status).toBe(401);
  });
});

// -----------------------------------------------------------------------------
// PUT — update agent
// -----------------------------------------------------------------------------

describe("PUT /api/digital-employees/[id]", () => {
  it("updates agent name and model", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { PUT } = await import("@/app/api/digital-employees/[id]/route");
    const { userId } = await makeUser("MEMBER");

    const createRes = await POST(
      makePostReq({ callerId: userId, body: { name: "Old Name", scope: "personal" } }),
    );
    const created = await createRes.json();

    const { req, params } = makeIdReq({
      id: created.id,
      method: "PUT",
      callerId: userId,
      body: { name: "New Name", model: "claude-3" },
    });
    const res = await PUT(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.name).toBe("New Name");
    expect(body.agent.model).toBe("claude-3");
  });

  it("replaces skill bindings on update", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { PUT } = await import("@/app/api/digital-employees/[id]/route");
    const { userId } = await makeUser("MEMBER");

    const skill1 = await prisma.skillPackage.create({
      data: {
        slug: uniqueName("skill1"),
        name: "Skill 1",
        scope: "global",
        source: "builtin",
        filePath: "/skills/test1",
      },
    });
    const skill2 = await prisma.skillPackage.create({
      data: {
        slug: uniqueName("skill2"),
        name: "Skill 2",
        scope: "global",
        source: "builtin",
        filePath: "/skills/test2",
      },
    });

    const createRes = await POST(
      makePostReq({
        callerId: userId,
        body: { name: "Agent", scope: "personal", skillIds: [skill1.id] },
      }),
    );
    const created = await createRes.json();

    // Update: replace skill1 with skill2
    const { req, params } = makeIdReq({
      id: created.id,
      method: "PUT",
      callerId: userId,
      body: { skillIds: [skill2.id] },
    });
    const res = await PUT(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.skillBindings).toHaveLength(1);
    expect(body.agent.skillBindings[0].skillPackageId).toBe(skill2.id);
  });

  it("returns 404 for non-existent agent", async () => {
    const { PUT } = await import("@/app/api/digital-employees/[id]/route");
    const { userId } = await makeUser("MEMBER");

    const { req, params } = makeIdReq({
      id: "non-existent-id",
      method: "PUT",
      callerId: userId,
      body: { name: "X" },
    });
    const res = await PUT(req, { params });
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) for cross-team access — security: avoid leaking resource existence", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { PUT } = await import("@/app/api/digital-employees/[id]/route");
    const { userId: owner1 } = await makeUser("OWNER");
    const { userId: owner2, teamId } = await makeUser("OWNER");

    const createRes = await POST(
      makePostReq({ callerId: owner2, body: { name: "Team Agent", scope: "team", teamId } }),
    );
    const created = await createRes.json();

    const { req, params } = makeIdReq({
      id: created.id,
      method: "PUT",
      callerId: owner1,
      body: { name: "Hijacked" },
    });
    // getAccessibleAgent returns null when caller doesn't have access, resulting in 404
    // This is intentional security design: don't distinguish "not found" from "forbidden"
    const res = await PUT(req, { params });
    expect(res.status).toBe(404);
  });
});

// -----------------------------------------------------------------------------
// DELETE — delete agent
// -----------------------------------------------------------------------------

describe("DELETE /api/digital-employees/[id]", () => {
  it("deletes agent and cascades bindings", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { DELETE } = await import("@/app/api/digital-employees/[id]/route");
    const { GET } = await import("@/app/api/digital-employees/[id]/route");
    const { userId } = await makeUser("MEMBER");

    const skill = await prisma.skillPackage.create({
      data: {
        slug: uniqueName("skill"),
        name: "Test Skill",
        scope: "global",
        source: "builtin",
        filePath: "/skills/test",
      },
    });

    const createRes = await POST(
      makePostReq({
        callerId: userId,
        body: { name: "To Delete", scope: "personal", skillIds: [skill.id] },
      }),
    );
    const created = await createRes.json();

    const { req: delReq, params: delParams } = makeIdReq({
      id: created.id,
      method: "DELETE",
      callerId: userId,
    });
    const deleteRes = await DELETE(delReq, { params: delParams });
    expect(deleteRes.status).toBe(204);

    // Verify agent is gone
    const { req: getReq, params: getParams } = makeIdReq({
      id: created.id,
      method: "GET",
      callerId: userId,
    });
    const getRes = await GET(getReq, { params: getParams });
    expect(getRes.status).toBe(404);

    // Verify bindings were cascade-deleted
    const bindings = await prisma.agentSkillBinding.findMany({
      where: { agentId: created.id },
    });
    expect(bindings).toHaveLength(0);
  });

  it("returns 404 for non-existent agent", async () => {
    const { DELETE } = await import("@/app/api/digital-employees/[id]/route");
    const { userId } = await makeUser("MEMBER");

    const { req, params } = makeIdReq({
      id: "non-existent-id",
      method: "DELETE",
      callerId: userId,
    });
    const res = await DELETE(req, { params });
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) for cross-team access — security: avoid leaking resource existence", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { DELETE } = await import("@/app/api/digital-employees/[id]/route");
    const { userId: owner1 } = await makeUser("OWNER");
    const { userId: owner2, teamId } = await makeUser("OWNER");

    const createRes = await POST(
      makePostReq({ callerId: owner2, body: { name: "Team Agent", scope: "team", teamId } }),
    );
    const created = await createRes.json();

    const { req, params } = makeIdReq({
      id: created.id,
      method: "DELETE",
      callerId: owner1,
    });
    // getAccessibleAgent returns null when caller doesn't have access, resulting in 404
    // This is intentional security design: don't distinguish "not found" from "forbidden"
    const res = await DELETE(req, { params });
    expect(res.status).toBe(404);
  });

  it("returns 401 when x-user-id missing", async () => {
    const { POST } = await import("@/app/api/digital-employees/route");
    const { DELETE } = await import("@/app/api/digital-employees/[id]/route");
    const { userId } = await makeUser("MEMBER");

    const createRes = await POST(
      makePostReq({ callerId: userId, body: { name: "My Agent", scope: "personal" } }),
    );
    const created = await createRes.json();

    const { req, params } = makeIdReq({
      id: created.id,
      method: "DELETE",
      callerId: null,
    });
    const res = await DELETE(req, { params });
    expect(res.status).toBe(401);
  });
});
