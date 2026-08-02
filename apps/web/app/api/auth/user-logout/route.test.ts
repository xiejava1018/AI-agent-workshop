// app/api/auth/user-logout/route.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { prisma } from "../../../../lib/prisma";
import { isRefreshTokenRevoked } from "../../../../lib/token-blacklist";

const TEST_JTI_PREFIX = "test-logout-jti-";
const TEST_USERNAME_PREFIX = "test-logout-user-";
const createdUserIds: string[] = [];

function loadSecret(): Uint8Array {
  const secret = process.env.PI_WEB_JWT_SECRET;
  if (!secret) {
    throw new Error("PI_WEB_JWT_SECRET is not set in test env");
  }
  return new TextEncoder().encode(secret);
}

async function cleanTestRows(): Promise<void> {
  await prisma.refreshTokenBlacklist.deleteMany({
    where: { jti: { startsWith: TEST_JTI_PREFIX } },
  });
  if (createdUserIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [...createdUserIds] } },
    });
  }
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USERNAME_PREFIX } },
  });
  createdUserIds.length = 0;
}

beforeEach(async () => {
  await cleanTestRows();
});

afterAll(async () => {
  await cleanTestRows();
  await prisma.$disconnect();
});

async function makeRefreshToken(opts: {
  sub: string;
  jti: string;
  expiresInSeconds?: number;
  type?: "refresh" | "access";
}): Promise<string> {
  const expiresIn = opts.expiresInSeconds ?? 60 * 60 * 24 * 7;
  return await new SignJWT({ sub: opts.sub, type: opts.type ?? "refresh", jti: opts.jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(loadSecret());
}

function makeReq(refreshToken: string | null): NextRequest {
  const url = "http://localhost:30141/api/auth/user-logout";
  const headers: Record<string, string> = {};
  if (refreshToken !== null) {
    headers["cookie"] = `pw_rt=${refreshToken}`;
  }
  return new NextRequest(url, { method: "POST", headers });
}

async function createTestUser(): Promise<string> {
  const username = `${TEST_USERNAME_PREFIX}${Math.random().toString(36).slice(2, 10)}`;
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: "x",
      mustChangePassword: false,
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

describe("POST /api/auth/user-logout", () => {
  it("returns 200 with cleared cookies when no pw_rt cookie is present", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(null));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    // both cookies cleared (maxAge=0 or expired)
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/pw_at=/);
    expect(setCookie).toMatch(/pw_rt=/);
    // Browser cookie-clearing: maxAge=0 or empty value
    expect(setCookie).toMatch(/(?:Max-Age=0|max-age=0)/);
  });

  it("returns 200 and revokes the refresh token's jti when pw_rt is a valid refresh JWT", async () => {
    const userId = await createTestUser();
    const jti = `${TEST_JTI_PREFIX}revoke-1`;
    const refreshToken = await makeRefreshToken({ sub: userId, jti });

    const { POST } = await import("./route");
    const res = await POST(makeReq(refreshToken));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    // jti is now in the blacklist
    expect(await isRefreshTokenRevoked(jti)).toBe(true);
    // both cookies cleared
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/pw_at=/);
    expect(setCookie).toMatch(/pw_rt=/);
    expect(setCookie).toMatch(/(?:Max-Age=0|max-age=0)/);

    // XIE-23: logout records an auth.logout audit entry for the user.
    const auditRow = await prisma.auditLog.findFirst({
      where: { userId, action: "auth.logout", resourceType: "user" },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).not.toBeNull();
  });

  it("returns 200 and clears cookies but does NOT persist anything when pw_rt is garbage", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq("definitely-not-a-jwt"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    // No jti starting with our prefix is in blacklist
    const all = await prisma.refreshTokenBlacklist.findMany({
      where: { jti: { startsWith: TEST_JTI_PREFIX } },
    });
    expect(all).toHaveLength(0);
    // cookies still cleared
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/pw_at=/);
    expect(setCookie).toMatch(/pw_rt=/);
  });

  it("returns 200 and clears cookies when pw_rt is a valid JWT but type=access (treat as no refresh)", async () => {
    const userId = await createTestUser();
    const jti = `${TEST_JTI_PREFIX}access-typed-logout-1`;
    // Sign an access token (type=access) — should not be revoked
    const accessLike = await makeRefreshToken({
      sub: userId,
      jti,
      type: "access",
    });
    const { POST } = await import("./route");
    const res = await POST(makeReq(accessLike));
    expect(res.status).toBe(200);
    // No jti starting with our prefix is in blacklist (logout only revokes refresh tokens)
    const all = await prisma.refreshTokenBlacklist.findMany({
      where: { jti: { startsWith: TEST_JTI_PREFIX } },
    });
    expect(all).toHaveLength(0);
  });
});
