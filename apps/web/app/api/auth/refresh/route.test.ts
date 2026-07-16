// app/api/auth/refresh/route.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { prisma } from "../../../../lib/prisma";
import { revokeRefreshToken, isRefreshTokenRevoked } from "../../../../lib/token-blacklist";

const TEST_JTI_PREFIX = "test-refresh-jti-";
const TEST_USERNAME_PREFIX = "test-refresh-user-";

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
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USERNAME_PREFIX } },
  });
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
  const url = "http://localhost:30141/api/auth/refresh";
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
      passwordHash: "x", // not relevant for refresh
      mustChangePassword: false,
    },
  });
  return user.id;
}

describe("POST /api/auth/refresh", () => {
  it("returns 401 with refresh-token-required when pw_rt cookie is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "refresh token required" });
    // both cookies cleared
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/pw_at=/);
    expect(setCookie).toMatch(/pw_rt=/);
  });

  it("returns 401 with invalid-token when pw_rt is not a valid JWT", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq("not-a-real-jwt"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "invalid refresh token" });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/pw_at=/);
    expect(setCookie).toMatch(/pw_rt=/);
  });

  it("returns 401 with invalid-token when JWT type is not 'refresh'", async () => {
    const userId = await createTestUser();
    const accessLikeToken = await makeRefreshToken({
      sub: userId,
      jti: `${TEST_JTI_PREFIX}access-typed-1`,
      type: "access",
    });
    const { POST } = await import("./route");
    const res = await POST(makeReq(accessLikeToken));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "invalid refresh token" });
  });

  it("returns 401 with invalid-token when jti is already revoked (replay)", async () => {
    const userId = await createTestUser();
    const jti = `${TEST_JTI_PREFIX}revoked-1`;
    const expiresAt = new Date(Date.now() + 60_000);
    await revokeRefreshToken(jti, expiresAt);

    const token = await makeRefreshToken({ sub: userId, jti });
    const { POST } = await import("./route");
    const res = await POST(makeReq(token));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "invalid refresh token" });
    // both cookies cleared on revoked replay
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/pw_at=/);
    expect(setCookie).toMatch(/pw_rt=/);
  });

  it("rotates tokens on a valid refresh: 200, new pw_at and pw_rt, old jti revoked", async () => {
    const userId = await createTestUser();
    const oldJti = `${TEST_JTI_PREFIX}valid-1`;
    const oldToken = await makeRefreshToken({ sub: userId, jti: oldJti });

    const { POST } = await import("./route");
    const res = await POST(makeReq(oldToken));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    // old jti now in blacklist
    expect(await isRefreshTokenRevoked(oldJti)).toBe(true);

    // new cookies set
    const setCookie = res.headers.get("set-cookie") ?? "";
    const pwAtMatch = setCookie.match(/pw_at=([^;]+)/);
    const pwRtMatch = setCookie.match(/pw_rt=([^;]+)/);
    expect(pwAtMatch).not.toBeNull();
    expect(pwRtMatch).not.toBeNull();
    expect(pwAtMatch![1]).not.toBe("");
    expect(pwRtMatch![1]).not.toBe("");
    // maxAge encoded in Set-Cookie (15min for at, 7d for rt)
    expect(setCookie).toMatch(/pw_at=.*[Mm]ax-[Aa]ge=\s*900/);
    expect(setCookie).toMatch(/pw_rt=.*[Mm]ax-[Aa]ge=\s*604800/);
  });

  it("the new refresh token has a different jti and is not pre-revoked", async () => {
    const userId = await createTestUser();
    const oldJti = `${TEST_JTI_PREFIX}rotation-jti-1`;
    const oldToken = await makeRefreshToken({ sub: userId, jti: oldJti });

    const { POST } = await import("./route");
    const res = await POST(makeReq(oldToken));
    expect(res.status).toBe(200);

    // Decode the new refresh token and confirm it has a fresh jti + sub matches
    const setCookie = res.headers.get("set-cookie") ?? "";
    const newRt = setCookie.match(/pw_rt=([^;]+)/)![1];
    const { jwtVerify } = await import("jose");
    const { payload } = await jwtVerify(newRt, loadSecret());
    expect(payload.type).toBe("refresh");
    expect(payload.sub).toBe(userId);
    expect(payload.jti).toBeTruthy();
    expect(payload.jti).not.toBe(oldJti);
    expect(await isRefreshTokenRevoked(String(payload.jti))).toBe(false);
  });
});
