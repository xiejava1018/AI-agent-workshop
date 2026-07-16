/**
 * app/api/admin/audit/route.test.ts
 *
 * Task 4.6 — Audit log query & append API tests.
 *
 * Covers:
 *   GET /api/admin/audit
 *     - 401 when x-user-id missing
 *     - 403 for MEMBER
 *     - returns paginated entries newest-first for ADMIN
 *     - filters by userId / action / resourceType / resourceId
 *     - filters by from/to date range
 *     - respects page/limit, caps limit at 100
 *   POST /api/admin/audit
 *     - 401 when x-user-id missing
 *     - 400 when action / resourceType missing
 *     - any authenticated user (MEMBER) may append
 *     - defaults userId to caller when body omits it
 *
 * Uses the real SQLite DB via prisma. Test rows are cleaned in beforeEach/afterAll.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-audit-";
// resourceType marker so we can isolate this suite's rows from any real logs.
const RT = `${TEST_PREFIX}rt`;

function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now().toString(36)}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanTestRows(): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { resourceType: { startsWith: TEST_PREFIX } } });

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

async function seedLog(opts: {
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  createdAt?: Date;
}): Promise<string> {
  const row = await prisma.auditLog.create({
    data: {
      userId: opts.userId ?? null,
      action: opts.action,
      resourceType: opts.resourceType ?? RT,
      resourceId: opts.resourceId ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
  return row.id;
}

function makeGetReq(opts: {
  callerId?: string | null;
  params?: Record<string, string>;
}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  const url = new URL("http://localhost:30141/api/admin/audit");
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString(), { method: "GET", headers });
}

function makePostReq(opts: { callerId?: string | null; body?: unknown }): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  return new NextRequest("http://localhost:30141/api/admin/audit", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

describe("GET /api/admin/audit", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetReq({ callerId: null }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "auth required" });
  });

  it("returns 403 for MEMBER", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const res = await GET(makeGetReq({ callerId: userId }));
    expect(res.status).toBe(403);
  });

  it("returns entries newest-first for ADMIN", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("ADMIN");
    await seedLog({ action: "a.older", createdAt: new Date("2020-01-01T00:00:00Z") });
    await seedLog({ action: "a.newer", createdAt: new Date("2021-01-01T00:00:00Z") });

    const res = await GET(makeGetReq({ callerId: userId, params: { resourceType: RT } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(2);
    expect(json.page).toBe(1);
    expect(json.limit).toBe(50);
    expect(json.entries[0].action).toBe("a.newer");
    expect(json.entries[1].action).toBe("a.older");
  });

  it("filters by action", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("ADMIN");
    await seedLog({ action: "skill.install" });
    await seedLog({ action: "mcp.credential_global_denied" });

    const res = await GET(makeGetReq({ callerId: userId, params: { resourceType: RT, action: "skill.install" } }));
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.entries[0].action).toBe("skill.install");
  });

  it("filters by userId and resourceId", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("ADMIN");
    await seedLog({ action: "agent.binding.change", userId, resourceId: "agent-1" });
    await seedLog({ action: "agent.binding.change", userId, resourceId: "agent-2" });

    const res = await GET(
      makeGetReq({ callerId: userId, params: { resourceType: RT, userId, resourceId: "agent-1" } }),
    );
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.entries[0].resourceId).toBe("agent-1");
  });

  it("filters by from/to date range", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("ADMIN");
    await seedLog({ action: "old", createdAt: new Date("2019-01-01T00:00:00Z") });
    await seedLog({ action: "mid", createdAt: new Date("2020-06-01T00:00:00Z") });
    await seedLog({ action: "new", createdAt: new Date("2022-01-01T00:00:00Z") });

    const res = await GET(
      makeGetReq({
        callerId: userId,
        params: { resourceType: RT, from: "2020-01-01T00:00:00Z", to: "2021-01-01T00:00:00Z" },
      }),
    );
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.entries[0].action).toBe("mid");
  });

  it("respects page/limit and caps limit at 100", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeUser("ADMIN");
    for (let i = 0; i < 5; i++) {
      await seedLog({ action: `p.${i}`, createdAt: new Date(2020, 0, 1, 0, 0, i) });
    }

    const res = await GET(makeGetReq({ callerId: userId, params: { resourceType: RT, page: "2", limit: "2" } }));
    const json = await res.json();
    expect(json.total).toBe(5);
    expect(json.page).toBe(2);
    expect(json.limit).toBe(2);
    expect(json.entries.length).toBe(2);

    const capped = await GET(makeGetReq({ callerId: userId, params: { resourceType: RT, limit: "9999" } }));
    const cappedJson = await capped.json();
    expect(cappedJson.limit).toBe(100);
  });
});

describe("POST /api/admin/audit", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makePostReq({ callerId: null, body: { action: "x", resourceType: RT } }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when action is missing", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const res = await POST(makePostReq({ callerId: userId, body: { resourceType: RT } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "action required" });
  });

  it("returns 400 when resourceType is missing", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const res = await POST(makePostReq({ callerId: userId, body: { action: "x" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "resourceType required" });
  });

  it("allows any authenticated user (MEMBER) to append and defaults userId to caller", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const res = await POST(
      makePostReq({
        callerId: userId,
        body: { action: "session.create", resourceType: RT, metadata: JSON.stringify({ ip: "127.0.0.1" }) },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.entry.action).toBe("session.create");
    expect(json.entry.userId).toBe(userId);
    expect(json.entry.metadata).toBe(JSON.stringify({ ip: "127.0.0.1" }));
  });

  it("uses an explicit body userId as the subject when provided", async () => {
    const { POST } = await import("./route");
    const { userId } = await makeUser("MEMBER");
    const subject = await makeUser("MEMBER");
    const res = await POST(
      makePostReq({
        callerId: userId,
        body: { userId: subject.userId, action: "user.disable", resourceType: RT },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.entry.userId).toBe(subject.userId);
  });
});
