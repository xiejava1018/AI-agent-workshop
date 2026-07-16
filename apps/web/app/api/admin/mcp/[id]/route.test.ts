/**
 * app/api/admin/mcp/[id]/route.test.ts
 *
 * Task 4.5 — MCP Server single-record CRUD tests.
 *
 * Covers:
 *   GET /api/admin/mcp/[id]   — admin read, configEnc stripped, 404
 *   PUT /api/admin/mcp/[id]   — OWNER-only update, configEnc replacement, 403 for ADMIN
 *   DELETE /api/admin/mcp/[id]— OWNER-only hard delete with binding cascade
 *
 * Uses real SQLite DB via prisma. Test rows are cleaned in beforeEach/afterEach.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-mcpid-";

function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now().toString(36)}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanTestRows(): Promise<void> {
  const servers = await prisma.mcpServer.findMany({
    where: { name: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const serverIds = servers.map((s) => s.id);
  if (serverIds.length > 0) {
    await prisma.agentMcpBinding.deleteMany({ where: { mcpServerId: { in: serverIds } } });
  }
  await prisma.mcpServer.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });

  const agents = await prisma.agent.findMany({
    where: { name: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const agentIds = agents.map((a) => a.id);
  if (agentIds.length > 0) {
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

async function makeUser(role: "OWNER" | "ADMIN" | "MEMBER"): Promise<{ userId: string; teamId: string }> {
  const username = uniqueName(role.toLowerCase());
  const user = await prisma.user.create({
    data: { username, passwordHash: await bcrypt.hash("pass-1234", 10), mustChangePassword: false },
  });
  const team = await prisma.team.create({
    data: { name: uniqueName(`team-${role.toLowerCase()}`), ownerUserId: user.id },
  });
  await prisma.teamMember.create({ data: { teamId: team.id, userId: user.id, role } });
  return { userId: user.id, teamId: team.id };
}

async function makeServer(opts: { configEnc?: string; scope?: string; teamId?: string | null } = {}): Promise<string> {
  const s = await prisma.mcpServer.create({
    data: {
      name: uniqueName("srv"),
      scope: opts.scope ?? "global",
      teamId: opts.teamId ?? null,
      configEnc: opts.configEnc ?? "",
    },
  });
  return s.id;
}

function makeReq(
  method: "GET" | "PUT" | "DELETE",
  id: string,
  opts: { callerId?: string | null; body?: unknown } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (method !== "GET" && method !== "DELETE") headers["Content-Type"] = "application/json";
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  return new NextRequest(`http://localhost:30141/api/admin/mcp/${id}`, {
    method,
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
}

describe("GET /api/admin/mcp/[id]", () => {
  it("returns 401 when x-user-id missing", async () => {
    const { GET } = await import("./route");
    const id = await makeServer();
    const res = await GET(makeReq("GET", id, { callerId: null }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown id", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("ADMIN");
    const res = await GET(makeReq("GET", "nonexistent-id", { callerId: userId }), {
      params: Promise.resolve({ id: "nonexistent-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns server with configEnc stripped for ADMIN", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("ADMIN");
    const id = await makeServer({ configEnc: "NEVER-LEAK" });
    const res = await GET(makeReq("GET", id, { callerId: userId }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.server.id).toBe(id);
    expect(json.server.configEnc).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("NEVER-LEAK");
  });
});

describe("PUT /api/admin/mcp/[id]", () => {
  it("returns 403 for ADMIN (write is OWNER-only)", async () => {
    const { PUT } = await import("./route");
    const { userId } = await makeUser("ADMIN");
    const id = await makeServer();
    const res = await PUT(makeReq("PUT", id, { callerId: userId, body: { name: "X" } }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(403);
  });

  it("updates fields and strips configEnc from response", async () => {
    const { PUT } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const id = await makeServer();
    const res = await PUT(
      makeReq("PUT", id, { callerId: userId, body: { name: uniqueName("renamed"), enabled: false } }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.server.name).toContain("renamed");
    expect(json.server.enabled).toBe(false);
    expect(json.server.configEnc).toBeUndefined();
  });

  it("replaces configEnc when provided in body", async () => {
    const { PUT } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const id = await makeServer({ configEnc: "OLD" });
    await PUT(makeReq("PUT", id, { callerId: userId, body: { configEnc: "NEW-CIPHER" } }), {
      params: Promise.resolve({ id }),
    });
    const stored = await prisma.mcpServer.findUnique({ where: { id } });
    expect(stored?.configEnc).toBe("NEW-CIPHER");
  });

  it("validates scope on update", async () => {
    const { PUT } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const id = await makeServer();
    const res = await PUT(makeReq("PUT", id, { callerId: userId, body: { scope: "bogus" } }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/mcp/[id]", () => {
  it("returns 403 for ADMIN (write is OWNER-only)", async () => {
    const { DELETE } = await import("./route");
    const { userId } = await makeUser("ADMIN");
    const id = await makeServer();
    const res = await DELETE(makeReq("DELETE", id, { callerId: userId }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(403);
  });

  it("hard-deletes the server and cascades agent bindings", async () => {
    const { DELETE } = await import("./route");
    const { userId, teamId } = await makeUser("OWNER");
    const id = await makeServer({ scope: "team", teamId });

    // Create an agent + a binding pointing at this server.
    const agent = await prisma.agent.create({
      data: { name: uniqueName("agent"), scope: "team", teamId },
    });
    await prisma.agentMcpBinding.create({ data: { agentId: agent.id, mcpServerId: id, mode: "inherit" } });

    const res = await DELETE(makeReq("DELETE", id, { callerId: userId }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(204);

    expect(await prisma.mcpServer.findUnique({ where: { id } })).toBeNull();
    const bindings = await prisma.agentMcpBinding.findMany({ where: { mcpServerId: id } });
    expect(bindings).toHaveLength(0);
  });

  it("returns 404 for unknown id", async () => {
    const { DELETE } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const res = await DELETE(makeReq("DELETE", "nope", { callerId: userId }), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });
});
