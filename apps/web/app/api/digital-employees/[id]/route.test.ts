/**
 * app/api/digital-employees/[id]/route.test.ts
 *
 * Task 4.1 — digital employees CRUD: single-agent route tests.
 *
 * Covers:
 *   GET /api/digital-employees/[id]
 *     - 401 when x-user-id missing
 *     - 404 when agent not found
 *     - 404 when caller cannot access the agent
 *     - returns agent with skillBindings and mcpBindings
 *   PUT /api/digital-employees/[id]
 *     - 401 / 404 same as GET
 *     - updates name/description/systemPrompt/model
 *     - replaces skillBindings and mcpBindings
 *   DELETE /api/digital-employees/[id]
 *     - 401 / 404 same as GET
 *     - 204 with no body on success
 *     - cascades delete to skillBindings and mcpBindings
 *
 * Uses real SQLite DB via prisma. Test rows are cleaned in beforeEach/afterEach.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// -----------------------------------------------------------------------------
// Test fixtures
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

/** Create an agent directly in DB (bypasses API for setup). */
async function makeAgent(opts: {
  name: string;
  scope: "team" | "personal";
  ownerUserId?: string;
  teamId?: string;
  skillIds?: string[];
  mcpServerIds?: string[];
}) {
  const agent = await prisma.agent.create({
    data: {
      name: opts.name,
      scope: opts.scope,
      ownerUserId: opts.ownerUserId ?? null,
      teamId: opts.teamId ?? null,
      description: "",
      systemPrompt: "",
      model: "",
    },
  });
  const skillBindings = await Promise.all(
    (opts.skillIds ?? []).map((skillPackageId) =>
      prisma.agentSkillBinding.create({ data: { agentId: agent.id, skillPackageId, mode: "inherit" } }),
    ),
  );
  const mcpBindings = await Promise.all(
    (opts.mcpServerIds ?? []).map((mcpServerId) =>
      prisma.agentMcpBinding.create({ data: { agentId: agent.id, mcpServerId, mode: "inherit" } }),
    ),
  );
  return { ...agent, skillBindings, mcpBindings };
}

// -----------------------------------------------------------------------------
// Route call helpers — pass params as second arg to simulate Next.js App Router
// -----------------------------------------------------------------------------

function makeReq(opts: {
  method: "GET" | "PUT" | "DELETE";
  callerId?: string | null;
  id: string;
  body?: unknown;
}): { req: NextRequest; params: Promise<{ id: string }> } {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  if (opts.method === "GET") delete headers["Content-Type"];

  const req = new NextRequest(`http://localhost:30141/api/digital-employees/${opts.id}`, {
    method: opts.method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

  return { req, params: Promise.resolve({ id: opts.id }) };
}

// -----------------------------------------------------------------------------
// GET tests
// -----------------------------------------------------------------------------

describe("GET /api/digital-employees/[id]", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { GET } = await import("./route");
    const { req, params } = makeReq({ method: "GET", callerId: null, id: "any-id" });
    const res = await GET(req, { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent agent", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const { req, params } = makeReq({ method: "GET", callerId: userId, id: "non-existent-id" });
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
  });

  it("returns 404 when MEMBER tries to access another user's personal agent", async () => {
    const { GET } = await import("./route");
    const { userId: ownerId } = await makeUser("MEMBER");
    const { userId: otherId } = await makeUser("MEMBER");
    const agent = await makeAgent({ name: "Private", scope: "personal", ownerUserId: ownerId });

    const { req, params } = makeReq({ method: "GET", callerId: otherId, id: agent.id });
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
  });

  it("owner can get their own personal agent", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const agent = await makeAgent({ name: "My Agent", scope: "personal", ownerUserId: userId });

    const { req, params } = makeReq({ method: "GET", callerId: userId, id: agent.id });
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.name).toBe("My Agent");
    expect(body.agent.scope).toBe("personal");
  });

  it("team ADMIN/OWNER can get team agent", async () => {
    const { GET } = await import("./route");
    const { userId, teamId } = await makeUser("OWNER");
    const agent = await makeAgent({ name: "Team Agent", scope: "team", teamId });

    const { req, params } = makeReq({ method: "GET", callerId: userId, id: agent.id });
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.name).toBe("Team Agent");
  });

  it("team MEMBER cannot get team agent", async () => {
    const { GET } = await import("./route");
    const { teamId } = await makeUser("OWNER");
    const { userId: memberId } = await makeUser("MEMBER");
    await prisma.teamMember.create({ data: { teamId, userId: memberId, role: "MEMBER" } });

    const agent = await makeAgent({ name: "Team Agent", scope: "team", teamId });

    const { req, params } = makeReq({ method: "GET", callerId: memberId, id: agent.id });
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
  });

  it("returns skillBindings and mcpBindings with agent", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const skill = await prisma.skillPackage.create({
      data: { slug: "test", name: "Test", scope: "global", source: "builtin", filePath: "/skills/test" },
    });
    const mcp = await prisma.mcpServer.create({
      data: { name: "test-mcp", transport: "stdio", command: "npx test", scope: "global" },
    });
    const agent = await makeAgent({
      name: "With Bindings",
      scope: "personal",
      ownerUserId: userId,
      skillIds: [skill.id],
      mcpServerIds: [mcp.id],
    });

    const { req, params } = makeReq({ method: "GET", callerId: userId, id: agent.id });
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.skillBindings).toHaveLength(1);
    expect(body.agent.mcpBindings).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// PUT tests
// -----------------------------------------------------------------------------

describe("PUT /api/digital-employees/[id]", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { PUT } = await import("./route");
    const { req, params } = makeReq({ method: "PUT", callerId: null, id: "any-id", body: {} });
    const res = await PUT(req, { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent agent", async () => {
    const { PUT } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const { req, params } = makeReq({ method: "PUT", callerId: userId, id: "non-existent-id", body: {} });
    const res = await PUT(req, { params });
    expect(res.status).toBe(404);
  });

  it("updates agent name, description, systemPrompt, model", async () => {
    const { PUT } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const agent = await makeAgent({ name: "Old Name", scope: "personal", ownerUserId: userId });

    const { req, params } = makeReq({
      method: "PUT",
      callerId: userId,
      id: agent.id,
      body: { name: "New Name", description: "New desc", systemPrompt: "New prompt", model: "new-model" },
    });
    const res = await PUT(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.name).toBe("New Name");
    expect(body.agent.description).toBe("New desc");
    expect(body.agent.systemPrompt).toBe("New prompt");
    expect(body.agent.model).toBe("new-model");
  });

  it("replaces skill bindings", async () => {
    const { PUT } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const skill1 = await prisma.skillPackage.create({
      data: { slug: "skill1", name: "Skill 1", scope: "global", source: "builtin", filePath: "/skills/skill1" },
    });
    const skill2 = await prisma.skillPackage.create({
      data: { slug: "skill2", name: "Skill 2", scope: "global", source: "builtin", filePath: "/skills/skill2" },
    });
    const agent = await makeAgent({
      name: "Agent",
      scope: "personal",
      ownerUserId: userId,
      skillIds: [skill1.id],
    });

    const { req, params } = makeReq({
      method: "PUT",
      callerId: userId,
      id: agent.id,
      body: { skillIds: [skill2.id] },
    });
    const res = await PUT(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.skillBindings).toHaveLength(1);
    expect(body.agent.skillBindings[0].skillPackageId).toBe(skill2.id);
  });

  it("replaces mcp bindings", async () => {
    const { PUT } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const mcp1 = await prisma.mcpServer.create({
      data: { name: "mcp1", transport: "stdio", command: "npx mcp1", scope: "global" },
    });
    const mcp2 = await prisma.mcpServer.create({
      data: { name: "mcp2", transport: "stdio", command: "npx mcp2", scope: "global" },
    });
    const agent = await makeAgent({
      name: "Agent",
      scope: "personal",
      ownerUserId: userId,
      mcpServerIds: [mcp1.id],
    });

    const { req, params } = makeReq({
      method: "PUT",
      callerId: userId,
      id: agent.id,
      body: { mcpServerIds: [mcp2.id] },
    });
    const res = await PUT(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.mcpBindings).toHaveLength(1);
    expect(body.agent.mcpBindings[0].mcpServerId).toBe(mcp2.id);
  });

  it("removes all bindings when skillIds/mcpServerIds are omitted", async () => {
    const { PUT } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const skill = await prisma.skillPackage.create({
      data: { slug: "skill", name: "Skill", scope: "global", source: "builtin", filePath: "/skills/skill" },
    });
    const mcp = await prisma.mcpServer.create({
      data: { name: "mcp", transport: "stdio", command: "npx mcp", scope: "global" },
    });
    const agent = await makeAgent({
      name: "Agent",
      scope: "personal",
      ownerUserId: userId,
      skillIds: [skill.id],
      mcpServerIds: [mcp.id],
    });

    const { req, params } = makeReq({
      method: "PUT",
      callerId: userId,
      id: agent.id,
      body: { name: "Updated" },
    });
    const res = await PUT(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.skillBindings).toHaveLength(0);
    expect(body.agent.mcpBindings).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// DELETE tests
// -----------------------------------------------------------------------------

describe("DELETE /api/digital-employees/[id]", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { DELETE } = await import("./route");
    const { req, params } = makeReq({ method: "DELETE", callerId: null, id: "any-id" });
    const res = await DELETE(req, { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent agent", async () => {
    const { DELETE } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const { req, params } = makeReq({ method: "DELETE", callerId: userId, id: "non-existent-id" });
    const res = await DELETE(req, { params });
    expect(res.status).toBe(404);
  });

  it("returns 204 and deletes agent", async () => {
    const { DELETE } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const agent = await makeAgent({ name: "To Delete", scope: "personal", ownerUserId: userId });

    const { req, params } = makeReq({ method: "DELETE", callerId: userId, id: agent.id });
    const res = await DELETE(req, { params });
    expect(res.status).toBe(204);

    const found = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(found).toBeNull();
  });

  it("cascades delete to skillBindings", async () => {
    const { DELETE } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const skill = await prisma.skillPackage.create({
      data: { slug: "skill", name: "Skill", scope: "global", source: "builtin", filePath: "/skills/skill" },
    });
    const agent = await makeAgent({
      name: "Agent",
      scope: "personal",
      ownerUserId: userId,
      skillIds: [skill.id],
    });

    const { req, params } = makeReq({ method: "DELETE", callerId: userId, id: agent.id });
    await DELETE(req, { params });

    const bindings = await prisma.agentSkillBinding.findMany({ where: { agentId: agent.id } });
    expect(bindings).toHaveLength(0);
  });

  it("cascades delete to mcpBindings", async () => {
    const { DELETE } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const mcp = await prisma.mcpServer.create({
      data: { name: "mcp", transport: "stdio", command: "npx mcp", scope: "global" },
    });
    const agent = await makeAgent({
      name: "Agent",
      scope: "personal",
      ownerUserId: userId,
      mcpServerIds: [mcp.id],
    });

    const { req, params } = makeReq({ method: "DELETE", callerId: userId, id: agent.id });
    await DELETE(req, { params });

    const bindings = await prisma.agentMcpBinding.findMany({ where: { agentId: agent.id } });
    expect(bindings).toHaveLength(0);
  });

  it("team ADMIN can delete team agent", async () => {
    const { DELETE } = await import("./route");
    const { userId, teamId } = await makeUser("ADMIN");
    const agent = await makeAgent({ name: "Team Agent", scope: "team", teamId });

    const { req, params } = makeReq({ method: "DELETE", callerId: userId, id: agent.id });
    const res = await DELETE(req, { params });
    expect(res.status).toBe(204);
  });

  it("team MEMBER cannot delete team agent", async () => {
    const { DELETE } = await import("./route");
    const { teamId } = await makeUser("OWNER");
    const { userId: memberId } = await makeUser("MEMBER");
    await prisma.teamMember.create({ data: { teamId, userId: memberId, role: "MEMBER" } });

    const agent = await makeAgent({ name: "Team Agent", scope: "team", teamId });

    const { req, params } = makeReq({ method: "DELETE", callerId: memberId, id: agent.id });
    const res = await DELETE(req, { params });
    expect(res.status).toBe(404);
  });
});
