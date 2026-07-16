/**
 * app/api/admin/mcp/route.test.ts
 *
 * Task 4.5 — MCP Server CRUD API tests.
 *
 * Covers:
 *   POST /api/admin/mcp
 *     - 401 when x-user-id missing
 *     - 403 when ADMIN tries to create (OWNER-only)
 *     - 400 when name missing / scope invalid
 *     - 400 when team scope lacks teamId / user scope lacks userId
 *     - creates server, configEnc stored, NEVER returned in response
 *   GET /api/admin/mcp
 *     - 401 when x-user-id missing
 *     - 403 for MEMBER
 *     - returns all servers with configEnc stripped
 *     - scope / teamId query params filter results
 *
 * Uses real SQLite DB via prisma. Test rows are cleaned in beforeEach/afterEach.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-mcp-";

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

function makePostReq(opts: { callerId?: string | null; body?: unknown }): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  return new NextRequest("http://localhost:30141/api/admin/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

function makeGetReq(opts: { callerId?: string | null; scope?: string; teamId?: string }): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  const url = new URL("http://localhost:30141/api/admin/mcp");
  if (opts.scope) url.searchParams.set("scope", opts.scope);
  if (opts.teamId) url.searchParams.set("teamId", opts.teamId);
  return new NextRequest(url.toString(), { method: "GET", headers });
}

describe("POST /api/admin/mcp", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makePostReq({ callerId: null, body: { name: "X", scope: "global" } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "auth required" });
  });

  it("returns 403 when ADMIN tries to create (write is OWNER-only)", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("ADMIN");
    const res = await POST(makePostReq({ callerId: userId, body: { name: "X", scope: "global" } }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when name is missing", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const res = await POST(makePostReq({ callerId: userId, body: { scope: "global" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "name required" });
  });

  it("returns 400 when scope is invalid", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const res = await POST(makePostReq({ callerId: userId, body: { name: "X", scope: "bogus" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'scope must be "global" | "team" | "user"' });
  });

  it("returns 400 when scope=team but teamId is missing", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const res = await POST(makePostReq({ callerId: userId, body: { name: "X", scope: "team" } }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when scope=user but userId is missing", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const res = await POST(makePostReq({ callerId: userId, body: { name: "X", scope: "user" } }));
    expect(res.status).toBe(400);
  });

  it("creates a global server and NEVER returns configEnc", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const res = await POST(
      makePostReq({
        callerId: userId,
        body: { name: uniqueName("global"), transport: "stdio", configEnc: "SECRET-CIPHERTEXT", scope: "global" },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.server.scope).toBe("global");
    expect(json.server.transport).toBe("stdio");
    // configEnc must never be present in the response.
    expect(json.server.configEnc).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("SECRET-CIPHERTEXT");
  });

  it("creates a team-scoped server with teamId set", async () => {
    const { POST } = await import("./route");
    const { userId, teamId } = await makeUser("OWNER");
    const res = await POST(
      makePostReq({
        callerId: userId,
        body: { name: uniqueName("team"), scope: "team", teamId },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.server.scope).toBe("team");
    expect(json.server.teamId).toBe(teamId);
  });
});

describe("GET /api/admin/mcp", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetReq({ callerId: null }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for MEMBER", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const res = await GET(makeGetReq({ callerId: userId }));
    expect(res.status).toBe(403);
  });

  it("returns servers with configEnc stripped for ADMIN", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("ADMIN");
    await prisma.mcpServer.create({
      data: { name: uniqueName("list"), scope: "global", configEnc: "LEAK-ATTEMPT" },
    });
    const res = await GET(makeGetReq({ callerId: userId }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.servers.length).toBeGreaterThanOrEqual(1);
    for (const s of json.servers) {
      expect(s.configEnc).toBeUndefined();
    }
    expect(JSON.stringify(json)).not.toContain("LEAK-ATTEMPT");
  });

  it("filters by scope query param", async () => {
    const { GET } = await import("./route");
    const { userId, teamId } = await makeUser("ADMIN");
    await prisma.mcpServer.create({ data: { name: uniqueName("g"), scope: "global", teamId: null } });
    await prisma.mcpServer.create({ data: { name: uniqueName("t"), scope: "team", teamId } });

    const res = await GET(makeGetReq({ callerId: userId, scope: "team" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.servers.length).toBe(1);
    expect(json.servers[0].scope).toBe("team");
  });

  it("filters by teamId query param", async () => {
    const { GET } = await import("./route");
    const { userId, teamId } = await makeUser("ADMIN");
    await prisma.mcpServer.create({ data: { name: uniqueName("t1"), scope: "team", teamId } });
    await prisma.mcpServer.create({ data: { name: uniqueName("g1"), scope: "global" } });

    const res = await GET(makeGetReq({ callerId: userId, teamId }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.servers.every((s: { teamId?: string | null }) => s.teamId === teamId)).toBe(true);
    expect(json.servers.length).toBe(1);
  });
});
