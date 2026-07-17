/**
 * app/api/admin/models/route.test.ts
 *
 * Task 4.4 — model config admin API tests.
 *
 * Covers:
 *   GET  /api/admin/models
 *     - 401 when x-user-id missing
 *     - 403 for MEMBER
 *     - returns config shape + platformKeys status (no secretEnc leak) for ADMIN
 *   POST /api/admin/models/platform-key
 *     - 401 / 403 gating (OWNER-only)
 *     - 400 on missing provider / apiKey
 *     - upsert stores encrypted key, decrypts back, NEVER returns key material
 *   GET  /api/admin/models/platform-keys
 *     - OWNER-only, returns status without key material
 *   DELETE /api/admin/models/platform-key/[provider]
 *     - OWNER-only, 404 when absent, 204 on delete
 *
 * Uses the real DB via prisma. Test rows use a provider prefix for cleanup.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const TEST_KEY = "0".repeat(64);
const PROVIDER_PREFIX = "test-t44-";
const USER_PREFIX = "test-t44-user-";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = TEST_KEY;
});

function uniqueProvider(label: string): string {
  return `${PROVIDER_PREFIX}${label}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanTestRows(): Promise<void> {
  await prisma.platformApiKey.deleteMany({ where: { provider: { startsWith: PROVIDER_PREFIX } } });
  const users = await prisma.user.findMany({
    where: { username: { startsWith: USER_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    const teams = await prisma.team.findMany({
      where: { ownerUserId: { in: userIds } },
      select: { id: true },
    });
    const teamIds = teams.map((t) => t.id);
    if (teamIds.length > 0) {
      await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } });
      await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    }
  }
  await prisma.user.deleteMany({ where: { username: { startsWith: USER_PREFIX } } });
}

beforeEach(async () => {
  await cleanTestRows();
});

afterAll(async () => {
  await cleanTestRows();
  await prisma.$disconnect();
});

/** M4:resolve platform_admin SysRole(由 seed 提供);不存在则失败。 */
async function getPlatformAdminRoleId(): Promise<string> {
  const r = await prisma.sysRole.findUnique({
    where: { code: "platform_admin" },
    select: { id: true },
  });
  if (!r) {
    throw new Error(
      "platform_admin SysRole not seeded; run `pnpm tsx prisma/seed/roles.ts` first"
    );
  }
  return r.id;
}

async function makeUser(role: "OWNER" | "ADMIN" | "MEMBER"): Promise<string> {
  const username = `${USER_PREFIX}${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash("pass-1234", 10),
      mustChangePassword: false,
    },
  });
  const team = await prisma.team.create({
    data: { name: `${USER_PREFIX}team-${Math.random().toString(36).slice(2, 8)}`, ownerUserId: user.id },
  });
  await prisma.teamMember.create({ data: { teamId: team.id, userId: user.id, role } });
  // M4 RBAC 平台中台:OWNER/ADMIN 测试用例需要绑 platform_admin 才能通过鉴权
  if (role === "OWNER" || role === "ADMIN") {
    const roleId = await getPlatformAdminRoleId();
    await prisma.userRole.create({ data: { userId: user.id, roleId } });
  }
  return user.id;
}

function jsonReq(url: string, method: string, opts: { callerId?: string | null; body?: unknown }): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.callerId != null) headers["x-user-id"] = opts.callerId;
  return new NextRequest(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

function getReq(url: string, callerId?: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (callerId != null) headers["x-user-id"] = callerId;
  return new NextRequest(url, { method: "GET", headers });
}

const BASE = "http://localhost:30141/api/admin/models";

describe("GET /api/admin/models", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { GET } = await import("./route");
    const res = await GET(getReq(BASE, null));
    expect(res.status).toBe(401);
  });

  it("returns 403 for MEMBER", async () => {
    const { GET } = await import("./route");
    const userId = await makeUser("MEMBER");
    const res = await GET(getReq(BASE, userId));
    expect(res.status).toBe(403);
  });

  it("returns config shape + platformKeys status for ADMIN, without secretEnc", async () => {
    const { GET } = await import("./route");
    const userId = await makeUser("ADMIN");
    const provider = uniqueProvider("openai");
    await prisma.platformApiKey.create({ data: { provider, secretEnc: "LEAK-CIPHERTEXT" } });

    const res = await GET(getReq(BASE, userId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("providers");
    expect(json).toHaveProperty("defaultModel");
    expect(json).toHaveProperty("fallbackOrder");
    expect(Array.isArray(json.platformKeys)).toBe(true);
    const entry = json.platformKeys.find((k: { provider: string }) => k.provider === provider);
    expect(entry).toBeTruthy();
    expect(entry.hasKey).toBe(true);
    expect(JSON.stringify(json)).not.toContain("LEAK-CIPHERTEXT");
    expect(JSON.stringify(json)).not.toContain("secretEnc");
  });
});

describe("POST /api/admin/models/platform-key", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { POST } = await import("./platform-key/route");
    const res = await POST(jsonReq(`${BASE}/platform-key`, "POST", { callerId: null, body: { provider: uniqueProvider("p"), apiKey: "k" } }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when ADMIN tries to set (OWNER-only)", async () => {
    const { POST } = await import("./platform-key/route");
    const userId = await makeUser("ADMIN");
    const res = await POST(jsonReq(`${BASE}/platform-key`, "POST", { callerId: userId, body: { provider: uniqueProvider("p"), apiKey: "k" } }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when provider is missing", async () => {
    const { POST } = await import("./platform-key/route");
    const userId = await makeUser("OWNER");
    const res = await POST(jsonReq(`${BASE}/platform-key`, "POST", { callerId: userId, body: { apiKey: "k" } }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when apiKey is missing", async () => {
    const { POST } = await import("./platform-key/route");
    const userId = await makeUser("OWNER");
    const res = await POST(jsonReq(`${BASE}/platform-key`, "POST", { callerId: userId, body: { provider: uniqueProvider("p") } }));
    expect(res.status).toBe(400);
  });

  it("upserts an encrypted key, never returns key material, and decrypts back", async () => {
    const { POST } = await import("./platform-key/route");
    const { decryptSecret } = await import("@/lib/secret-crypto");
    const userId = await makeUser("OWNER");
    const provider = uniqueProvider("anthropic");
    const apiKey = "sk-ant-secret-value-123";

    const res = await POST(jsonReq(`${BASE}/platform-key`, "POST", { callerId: userId, body: { provider, apiKey } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.provider).toBe(provider);
    expect(json.hasKey).toBe(true);
    expect(JSON.stringify(json)).not.toContain(apiKey);
    expect(json.secretEnc).toBeUndefined();

    const row = await prisma.platformApiKey.findUnique({ where: { provider } });
    expect(row).toBeTruthy();
    expect(row!.secretEnc).not.toContain(apiKey);
    expect(decryptSecret(row!.secretEnc)).toBe(apiKey);

    // Upsert (one key per provider): second call replaces, no duplicate.
    const res2 = await POST(jsonReq(`${BASE}/platform-key`, "POST", { callerId: userId, body: { provider, apiKey: "new-key" } }));
    expect(res2.status).toBe(200);
    const count = await prisma.platformApiKey.count({ where: { provider } });
    expect(count).toBe(1);
    const row2 = await prisma.platformApiKey.findUnique({ where: { provider } });
    expect(decryptSecret(row2!.secretEnc)).toBe("new-key");
  });
});

describe("GET /api/admin/models/platform-keys", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { GET } = await import("./platform-keys/route");
    const res = await GET(getReq(`${BASE}/platform-keys`, null));
    expect(res.status).toBe(401);
  });

  it("returns 403 for ADMIN (OWNER-only)", async () => {
    const { GET } = await import("./platform-keys/route");
    const userId = await makeUser("ADMIN");
    const res = await GET(getReq(`${BASE}/platform-keys`, userId));
    expect(res.status).toBe(403);
  });

  it("returns status list without key material for OWNER", async () => {
    const { GET } = await import("./platform-keys/route");
    const userId = await makeUser("OWNER");
    const provider = uniqueProvider("google");
    await prisma.platformApiKey.create({ data: { provider, secretEnc: "SECRET-XYZ" } });

    const res = await GET(getReq(`${BASE}/platform-keys`, userId));
    expect(res.status).toBe(200);
    const json = await res.json();
    const entry = json.platformKeys.find((k: { provider: string }) => k.provider === provider);
    expect(entry.hasKey).toBe(true);
    expect(JSON.stringify(json)).not.toContain("SECRET-XYZ");
  });
});

describe("DELETE /api/admin/models/platform-key/[provider]", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const { DELETE } = await import("./platform-key/[provider]/route");
    const provider = uniqueProvider("d");
    const res = await DELETE(jsonReq(`${BASE}/platform-key/${provider}`, "DELETE", { callerId: null }), {
      params: Promise.resolve({ provider }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for ADMIN (OWNER-only)", async () => {
    const { DELETE } = await import("./platform-key/[provider]/route");
    const userId = await makeUser("ADMIN");
    const provider = uniqueProvider("d");
    const res = await DELETE(jsonReq(`${BASE}/platform-key/${provider}`, "DELETE", { callerId: userId }), {
      params: Promise.resolve({ provider }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when the provider has no key", async () => {
    const { DELETE } = await import("./platform-key/[provider]/route");
    const userId = await makeUser("OWNER");
    const provider = uniqueProvider("missing");
    const res = await DELETE(jsonReq(`${BASE}/platform-key/${provider}`, "DELETE", { callerId: userId }), {
      params: Promise.resolve({ provider }),
    });
    expect(res.status).toBe(404);
  });

  it("deletes the key and returns 204 for OWNER", async () => {
    const { DELETE } = await import("./platform-key/[provider]/route");
    const userId = await makeUser("OWNER");
    const provider = uniqueProvider("todelete");
    await prisma.platformApiKey.create({ data: { provider, secretEnc: "enc" } });

    const res = await DELETE(jsonReq(`${BASE}/platform-key/${provider}`, "DELETE", { callerId: userId }), {
      params: Promise.resolve({ provider }),
    });
    expect(res.status).toBe(204);
    const row = await prisma.platformApiKey.findUnique({ where: { provider } });
    expect(row).toBeNull();
  });
});
