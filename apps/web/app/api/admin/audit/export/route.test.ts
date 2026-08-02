/**
 * app/api/admin/audit/export/route.test.ts + [id]/route.ts tests
 *
 * XIE-23 — CSV export and single-row detail for the audit log.
 *
 * Covers:
 *   GET /api/admin/audit/export
 *     - 401 when x-user-id missing
 *     - 403 for MEMBER
 *     - admin downloads a CSV with the right headers + a seeded row
 *     - filters limit the exported rows
 *   GET /api/admin/audit/[id]
 *     - 403 for MEMBER
 *     - 404 for unknown id
 *     - returns the entry for a known id
 *
 * Uses the real Postgres DB via prisma.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_PREFIX = "test-audit-export-";
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

async function getPlatformAdminRoleId(): Promise<string> {
  const r = await prisma.sysRole.findUnique({
    where: { code: "platform_admin" },
    select: { id: true },
  });
  if (!r) {
    throw new Error(
      "platform_admin SysRole not seeded; run `pnpm tsx prisma/seed/roles.ts` first",
    );
  }
  return r.id;
}

async function makeAdmin(): Promise<{ userId: string }> {
  const username = uniqueName("admin");
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash("pass-1234", 10),
      mustChangePassword: false,
    },
  });
  const team = await prisma.team.create({
    data: { name: uniqueName("team"), ownerUserId: user.id },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: user.id, role: "OWNER" },
  });
  const roleId = await getPlatformAdminRoleId();
  await prisma.userRole.create({ data: { userId: user.id, roleId } });
  return { userId: user.id };
}

async function makeMember(): Promise<{ userId: string }> {
  const username = uniqueName("member");
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash("pass-1234", 10),
      mustChangePassword: false,
    },
  });
  const team = await prisma.team.create({
    data: { name: uniqueName("team"), ownerUserId: user.id },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, userId: user.id, role: "MEMBER" },
  });
  return { userId: user.id };
}

async function seedLog(opts: {
  userId?: string;
  action: string;
  resourceId?: string;
}): Promise<string> {
  const row = await prisma.auditLog.create({
    data: {
      userId: opts.userId ?? null,
      action: opts.action,
      resourceType: RT,
      resourceId: opts.resourceId ?? null,
      metadata: JSON.stringify({ ok: true }),
    },
  });
  return row.id;
}

function makeExportReq(opts: {
  callerId?: string | null;
  params?: Record<string, string>;
}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  const url = new URL("http://localhost:30141/api/admin/audit/export");
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString(), { method: "GET", headers });
}

function makeDetailReq(opts: { callerId?: string | null; id: string }): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  return new NextRequest(
    `http://localhost:30141/api/admin/audit/${opts.id}`,
    { method: "GET", headers },
  );
}

describe("GET /api/admin/audit/export", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeExportReq({ callerId: null }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for MEMBER", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeMember();
    const res = await GET(makeExportReq({ callerId: userId }));
    expect(res.status).toBe(403);
  });

  it("exports a CSV with headers and seeded rows for admin", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeAdmin();
    const id = await seedLog({ action: "user.create", userId, resourceId: "u-1" });

    const res = await GET(
      makeExportReq({ callerId: userId, params: { resourceType: RT } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="audit_logs_.*\.csv"/);

    const body = await res.text();
    const lines = body.split("\r\n");
    // tolerate an optional leading UTF-8 BOM emitted for Excel compatibility
    const header = lines[0].replace(/^﻿/, "");
    expect(header).toBe(
      "id,created_at,user_id,action,resource_type,resource_id,metadata",
    );
    const dataLine = lines.find((l) => l.includes(id));
    expect(dataLine).toBeTruthy();
    expect(dataLine!).toContain("user.create");
    expect(dataLine!).toContain(RT);
    expect(dataLine!).toContain("u-1");
  });

  it("respects the action filter", async () => {
    const { GET } = await import("./route");
    const { userId } = await makeAdmin();
    await seedLog({ action: "user.create", userId });
    await seedLog({ action: "role.create", userId });

    const res = await GET(
      makeExportReq({ callerId: userId, params: { resourceType: RT, action: "role.create" } }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("role.create");
    expect(body).not.toContain("user.create");
  });
});

describe("GET /api/admin/audit/[id]", () => {
  it("returns 403 for MEMBER", async () => {
    const { GET } = await import("../[id]/route");
    const { userId } = await makeMember();
    const id = await seedLog({ action: "user.create" });
    const res = await GET(makeDetailReq({ callerId: userId, id }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown id", async () => {
    const { GET } = await import("../[id]/route");
    const { userId } = await makeAdmin();
    const res = await GET(
      makeDetailReq({ callerId: userId, id: "nonexistent-cuid" }),
      { params: Promise.resolve({ id: "nonexistent-cuid" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns the entry for a known id", async () => {
    const { GET } = await import("../[id]/route");
    const { userId } = await makeAdmin();
    const id = await seedLog({ action: "user.create", userId, resourceId: "u-1" });

    const res = await GET(makeDetailReq({ callerId: userId, id }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entry.id).toBe(id);
    expect(json.entry.action).toBe("user.create");
    expect(json.entry.userId).toBe(userId);
    expect(json.entry.resourceId).toBe("u-1");
  });
});
