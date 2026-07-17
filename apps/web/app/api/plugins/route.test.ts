/**
 * app/api/plugins/route.test.ts
 *
 * Task 5.3 — /api/plugins scope filtering + tenant isolation.
 *
 * The endpoint keeps its legacy filesystem behavior when called with `cwd`
 * (and no `scope`). When called with `scope=global|team|user|agent`, it
 * switches to a DB-backed, tenant-filtered listing of skill / MCP plugins.
 *
 * Tenant isolation rules under test:
 *   - global : global skills + global MCP (credentialed global MCP excluded)
 *   - team   : only teams the caller belongs to; a foreign tenantId is rejected
 *   - user   : always forced to the caller's own userId (client tenantId ignored)
 *   - agent  : four-layer resolution; caller must be able to access the agent
 *
 * Uses real Postgres via prisma. Test rows are cleaned in beforeEach/afterAll.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-plugins-";

function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now().toString(36)}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

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
  await prisma.skillPackage.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.mcpServer.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });

  const users = await prisma.user.findMany({
    where: { username: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.userSkillBinding.deleteMany({ where: { userId: { in: userIds } } });
  }

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
  await prisma.teamMember.create({ data: { teamId: team.id, userId: user.id, role } });
  return { userId: user.id, teamId: team.id };
}

function makeGetReq(opts: {
  callerId?: string | null;
  scope?: string;
  tenantId?: string;
  agentId?: string;
  cwd?: string;
}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  const url = new URL("http://localhost:30141/api/plugins");
  if (opts.scope) url.searchParams.set("scope", opts.scope);
  if (opts.tenantId) url.searchParams.set("tenantId", opts.tenantId);
  if (opts.agentId) url.searchParams.set("agentId", opts.agentId);
  if (opts.cwd) url.searchParams.set("cwd", opts.cwd);
  return new NextRequest(url.toString(), { method: "GET", headers });
}

describe("GET /api/plugins — scope filtering (T5.3)", () => {
  it("returns 400 when neither cwd nor scope is provided", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 401 when scope filtering requested without x-user-id", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetReq({ scope: "global" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid scope value", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const res = await GET(makeGetReq({ callerId: userId, scope: "bogus" }));
    expect(res.status).toBe(400);
  });

  it("global scope returns global skills + global MCP but excludes credentialed global MCP", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const skill = await prisma.skillPackage.create({
      data: { slug: uniqueName("gs"), name: uniqueName("gskill"), scope: "global" },
    });
    const cleanMcp = await prisma.mcpServer.create({
      data: { name: uniqueName("gmcp"), scope: "global", configEnc: "" },
    });
    await prisma.mcpServer.create({
      data: { name: uniqueName("gmcp-cred"), scope: "global", configEnc: "CIPHERTEXT" },
    });

    const res = await GET(makeGetReq({ callerId: userId, scope: "global" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    const ids = json.plugins.map((p: { id: string }) => p.id);
    expect(ids).toContain(skill.id);
    expect(ids).toContain(cleanMcp.id);
    // credentialed global MCP must not leak
    expect(json.plugins.some((p: { name: string }) => p.name.includes("gmcp-cred"))).toBe(false);
    // configEnc never returned
    expect(JSON.stringify(json)).not.toContain("CIPHERTEXT");
  });

  it("team scope returns only the caller's team plugins, not another team's", async () => {
    const { GET } = await import("./route");
    const { userId, teamId } = await makeUser("MEMBER");
    const { teamId: otherTeamId } = await makeUser("MEMBER");
    const mine = await prisma.skillPackage.create({
      data: { slug: uniqueName("ts"), name: uniqueName("tskill"), scope: "team", teamId },
    });
    const theirs = await prisma.skillPackage.create({
      data: { slug: uniqueName("ts2"), name: uniqueName("tskill2"), scope: "team", teamId: otherTeamId },
    });

    const res = await GET(makeGetReq({ callerId: userId, scope: "team" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    const ids = json.plugins.map((p: { id: string }) => p.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  it("team scope with a foreign tenantId is rejected (403)", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const { teamId: otherTeamId } = await makeUser("MEMBER");
    const res = await GET(makeGetReq({ callerId: userId, scope: "team", tenantId: otherTeamId }));
    expect(res.status).toBe(403);
  });

  it("user scope is forced to the caller and ignores a client-supplied tenantId", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const { userId: otherUserId } = await makeUser("MEMBER");
    const mine = await prisma.skillPackage.create({
      data: { slug: uniqueName("us"), name: uniqueName("uskill"), scope: "user", userId },
    });
    const theirs = await prisma.skillPackage.create({
      data: { slug: uniqueName("us2"), name: uniqueName("uskill2"), scope: "user", userId: otherUserId },
    });

    // Attempt to read another user's plugins by passing their id as tenantId.
    const res = await GET(makeGetReq({ callerId: userId, scope: "user", tenantId: otherUserId }));
    expect(res.status).toBe(200);
    const json = await res.json();
    const ids = json.plugins.map((p: { id: string }) => p.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  it("agent scope resolves four-layer skills for an accessible agent", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const globalSkill = await prisma.skillPackage.create({
      data: { slug: uniqueName("ags"), name: uniqueName("agskill"), scope: "global" },
    });
    const agent = await prisma.agent.create({
      data: { name: uniqueName("agent"), scope: "personal", ownerUserId: userId },
    });

    const res = await GET(makeGetReq({ callerId: userId, scope: "agent", agentId: agent.id }));
    expect(res.status).toBe(200);
    const json = await res.json();
    const slugs = json.plugins.map((p: { slug?: string }) => p.slug);
    expect(slugs).toContain(globalSkill.slug);
  });

  it("agent scope rejects access to an agent the caller cannot see (403)", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const { userId: otherUserId } = await makeUser("MEMBER");
    const foreignAgent = await prisma.agent.create({
      data: { name: uniqueName("foreign"), scope: "personal", ownerUserId: otherUserId },
    });

    const res = await GET(makeGetReq({ callerId: userId, scope: "agent", agentId: foreignAgent.id }));
    expect(res.status).toBe(403);
  });

  it("agent scope returns 400 when agentId is missing", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const res = await GET(makeGetReq({ callerId: userId, scope: "agent" }));
    expect(res.status).toBe(400);
  });
});
