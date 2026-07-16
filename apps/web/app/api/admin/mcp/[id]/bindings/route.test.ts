/**
 * app/api/admin/mcp/[id]/bindings/route.test.ts
 *
 * Task 4.5 — MCP Server agent-binding replacement tests.
 *
 * Covers:
 *   PATCH /api/admin/mcp/[id]/bindings
 *     - 401 when x-user-id missing
 *     - 403 for ADMIN (OWNER-only)
 *     - 404 when server does not exist
 *     - replaces all bindings (delete + recreate) inside a transaction
 *     - validates binding entries (non-array body, missing agentId)
 *     - defaults mode to "inherit" when omitted
 *
 * Uses real SQLite DB via prisma. Test rows are cleaned in beforeEach/afterAll.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-mcpbind-";

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

async function makeServer(teamId?: string): Promise<string> {
  const s = await prisma.mcpServer.create({
    data: { name: uniqueName("srv"), scope: teamId ? "team" : "global", teamId: teamId ?? null },
  });
  return s.id;
}

function makePatchReq(id: string, opts: { callerId?: string | null; body?: unknown }): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  return new NextRequest(`http://localhost:30141/api/admin/mcp/${id}/bindings`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

describe("PATCH /api/admin/mcp/[id]/bindings", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { PATCH } = await import("./route");
    const id = await makeServer();
    const res = await PATCH(makePatchReq(id, { callerId: null, body: { bindings: [] } }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for ADMIN (OWNER-only)", async () => {
    const { PATCH } = await import("./route");
    const { userId } = await makeUser("ADMIN");
    const id = await makeServer();
    const res = await PATCH(makePatchReq(id, { callerId: userId, body: { bindings: [] } }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when server does not exist", async () => {
    const { PATCH } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const res = await PATCH(makePatchReq("nope", { callerId: userId, body: { bindings: [] } }), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when bindings is not an array", async () => {
    const { PATCH } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const id = await makeServer();
    const res = await PATCH(makePatchReq(id, { callerId: userId, body: { bindings: "nope" } }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when a binding entry lacks agentId", async () => {
    const { PATCH } = await import("./route");
    const { userId } = await makeUser("OWNER");
    const id = await makeServer();
    const res = await PATCH(makePatchReq(id, { callerId: userId, body: { bindings: [{ mode: "include" }] } }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(400);
  });

  it("replaces all bindings inside a transaction", async () => {
    const { PATCH } = await import("./route");
    const { userId, teamId } = await makeUser("OWNER");
    const id = await makeServer(teamId);

    const a1 = await prisma.agent.create({ data: { name: uniqueName("a1"), scope: "team", teamId } });
    const a2 = await prisma.agent.create({ data: { name: uniqueName("a2"), scope: "team", teamId } });

    // Seed an existing binding that must be cleared by the replace.
    await prisma.agentMcpBinding.create({ data: { agentId: a1.id, mcpServerId: id, mode: "exclude" } });

    const res = await PATCH(
      makePatchReq(id, {
        callerId: userId,
        body: { bindings: [{ agentId: a2.id, mode: "include" }] },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bindings).toHaveLength(1);
    expect(json.bindings[0].agentId).toBe(a2.id);
    expect(json.bindings[0].mode).toBe("include");

    const after = await prisma.agentMcpBinding.findMany({ where: { mcpServerId: id } });
    expect(after).toHaveLength(1);
    expect(after[0].agentId).toBe(a2.id);
  });

  it("defaults mode to inherit when omitted", async () => {
    const { PATCH } = await import("./route");
    const { userId, teamId } = await makeUser("OWNER");
    const id = await makeServer(teamId);
    const a1 = await prisma.agent.create({ data: { name: uniqueName("a1"), scope: "team", teamId } });

    const res = await PATCH(
      makePatchReq(id, { callerId: userId, body: { bindings: [{ agentId: a1.id }] } }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const after = await prisma.agentMcpBinding.findFirst({ where: { mcpServerId: id } });
    expect(after?.mode).toBe("inherit");
  });
});
