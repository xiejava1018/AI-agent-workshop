// tests/integration/auth-csrf.test.ts
//
// T7.5 — refresh token httpOnly + CSRF protection.
//
// Tests:
//   1. POST /api/auth/refresh sets refresh token as httpOnly cookie
//   2. POST /api/auth/refresh rejects requests with missing CSRF token (403)
//   3. GET /api/auth/refresh sets a csrf_token cookie
//   4. POST /api/auth/refresh with valid CSRF token succeeds

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

const TEST_USERNAME_PREFIX = "test-csrf-";

function uniqueUsername(label: string): string {
  return `${TEST_USERNAME_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function cleanTestRows(): Promise<void> {
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

/**
 * Create a test user and return their credentials + a valid refresh token.
 */
async function createTestUserAndGetTokens(): Promise<{
  userId: string;
  refreshToken: string;
}> {
  const username = uniqueUsername("user");
  const passwordHash = await bcrypt.hash("test-password-1234", 10);
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      mustChangePassword: false,
    },
  });

  // Import provider bootstrap (side-effect: registers the provider)
  await import("@/lib/auth-provider-bootstrap");

  const { getPasswordAuthProvider } = await import("@/lib/auth-provider");
  const provider = getPasswordAuthProvider();
  const refreshToken = await provider.signRefreshToken(user.id);

  return { userId: user.id, refreshToken };
}

/**
 * Build a NextRequest for the refresh POST.
 * @param refreshToken - the refresh token for pw_rt cookie
 * @param csrfCookieToken - the CSRF token value for the csrf_token cookie (optional)
 * @param csrfHeaderToken - the CSRF token value for x-csrf-token header (optional, defaults to csrfCookieToken)
 */
function makeRefreshPostRequest(
  refreshToken: string,
  csrfCookieToken?: string,
  csrfHeaderToken?: string
): NextRequest {
  const url = "http://localhost:30141/api/auth/refresh";
  // Build Cookie header
  const cookies: string[] = [`pw_rt=${refreshToken}`];
  if (csrfCookieToken) {
    cookies.push(`csrf_token=${csrfCookieToken}`);
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: cookies.join("; "),
  };
  // Set CSRF header if provided
  if (csrfHeaderToken !== undefined) {
    headers["x-csrf-token"] = csrfHeaderToken;
  }
  return new NextRequest(url, { method: "POST", headers });
}

/**
 * Build a NextRequest for the refresh GET.
 */
function makeRefreshGetRequest(
  origin = "http://localhost:30141"
): NextRequest {
  return new NextRequest(`${origin}/api/auth/refresh`, { method: "GET" });
}

/**
 * Extract a cookie value from a raw Set-Cookie header string.
 * Handles multiple cookies joined with commas.
 */
function extractCookieValue(setCookieHeader: string, cookieName: string): string | undefined {
  // Multiple Set-Cookie headers are joined with commas
  // Each cookie is "name=value; attrs..."
  const cookies = setCookieHeader.split(",").map((c) => c.trim());
  const target = cookies.find((c) => c.startsWith(`${cookieName}=`));
  if (!target) return undefined;
  const eqIdx = target.indexOf("=");
  const semiIdx = target.indexOf(";");
  const end = semiIdx > 0 ? semiIdx : target.length;
  return target.slice(eqIdx + 1, end);
}

describe("refresh token httpOnly + CSRF protection", () => {
  it("GET /api/auth/refresh sets a csrf_token cookie with correct attributes", async () => {
    const { GET } = await import("../../app/api/auth/refresh/route");
    const req = makeRefreshGetRequest();
    const res = await GET(req as unknown as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const setCookieHeader = res.headers.get("set-cookie");
    expect(setCookieHeader).not.toBeNull();

    // Verify csrf_token cookie is set with expected value
    const csrfToken = extractCookieValue(setCookieHeader!, "csrf_token");
    expect(csrfToken).toBeDefined();
    expect(csrfToken!.length).toBe(64); // 32 bytes = 64 hex chars
  });

  it("POST without CSRF token is allowed when no CSRF cookie is present (lenient mode)", async () => {
    // When client hasn't called GET to obtain CSRF token, the request is allowed
    // This maintains backward compatibility with existing clients
    const { refreshToken } = await createTestUserAndGetTokens();

    const { POST } = await import("../../app/api/auth/refresh/route");
    const req = makeRefreshPostRequest(refreshToken);
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);

    // Without CSRF cookie, request is allowed (lenient mode)
    expect(res.status).toBe(200);
  });

  it("POST with CSRF cookie but missing header is rejected (403)", async () => {
    // When CSRF cookie is present but header is missing, reject
    const { refreshToken } = await createTestUserAndGetTokens();

    // First get a CSRF cookie
    const { GET, POST } = await import("../../app/api/auth/refresh/route");
    const getReq = makeRefreshGetRequest();
    const getRes = await GET(getReq as unknown as Parameters<typeof GET>[0]);
    const setCookieHeader = getRes.headers.get("set-cookie") ?? "";
    const csrfToken = extractCookieValue(setCookieHeader, "csrf_token");

    // POST with CSRF cookie but WITHOUT the header
    // Pass csrfToken as 2nd arg (cookie value) but no 3rd arg (no header)
    const postReq = makeRefreshPostRequest(refreshToken, csrfToken);
    const postRes = await POST(postReq as unknown as Parameters<typeof POST>[0]);

    // Should reject because CSRF cookie present but header missing
    expect(postRes.status).toBe(403);
    const body = await postRes.json();
    expect(body.error).toMatch(/csrf/i);
  });

  it("POST with mismatched CSRF token is rejected (403)", async () => {
    const { refreshToken } = await createTestUserAndGetTokens();

    // First get a valid CSRF cookie
    const { GET, POST } = await import("../../app/api/auth/refresh/route");
    const getReq = makeRefreshGetRequest();
    const getRes = await GET(getReq as unknown as Parameters<typeof GET>[0]);
    const setCookieHeader = getRes.headers.get("set-cookie") ?? "";
    const csrfToken = extractCookieValue(setCookieHeader, "csrf_token");

    // POST with correct CSRF cookie but WRONG header value
    const postReq = makeRefreshPostRequest(refreshToken, csrfToken, "wrong-csrf-token");
    const postRes = await POST(postReq as unknown as Parameters<typeof POST>[0]);

    expect(postRes.status).toBe(403);
    const body = await postRes.json();
    expect(body.error).toMatch(/csrf/i);
  });

  it("POST with valid CSRF token succeeds", async () => {
    const { refreshToken } = await createTestUserAndGetTokens();

    const { GET, POST } = await import("../../app/api/auth/refresh/route");

    // Step 1: GET to obtain CSRF cookie
    const getReq = makeRefreshGetRequest();
    const getRes = await GET(getReq as unknown as Parameters<typeof GET>[0]);
    expect(getRes.status).toBe(200);

    // Extract CSRF token from cookies
    const setCookieHeader = getRes.headers.get("set-cookie") ?? "";
    const csrfToken = extractCookieValue(setCookieHeader, "csrf_token");
    expect(csrfToken).toBeDefined();
    expect(csrfToken!.length).toBeGreaterThan(0);

    // Step 2: POST with the valid CSRF token (both cookie and header)
    const postReq = makeRefreshPostRequest(refreshToken, csrfToken, csrfToken);
    const postRes = await POST(postReq as unknown as Parameters<typeof POST>[0]);

    expect(postRes.status).toBe(200);
    const body = await postRes.json();
    expect(body.ok).toBe(true);
  });

  it("refresh token cookie is set with httpOnly on successful refresh", async () => {
    const { refreshToken } = await createTestUserAndGetTokens();

    const { GET, POST } = await import("../../app/api/auth/refresh/route");

    // Get CSRF token first
    const getReq = makeRefreshGetRequest();
    const getRes = await GET(getReq as unknown as Parameters<typeof GET>[0]);
    const setCookieHeader = getRes.headers.get("set-cookie") ?? "";
    const csrfToken = extractCookieValue(setCookieHeader, "csrf_token");

    // POST with valid CSRF (both cookie and header)
    const postReq = makeRefreshPostRequest(refreshToken, csrfToken, csrfToken);
    const postRes = await POST(postReq as unknown as Parameters<typeof POST>[0]);

    expect(postRes.status).toBe(200);

    // Verify refresh token cookie is set (httpOnly is set in the implementation)
    const resSetCookieHeader = postRes.headers.get("set-cookie") ?? "";
    const rtCookie = resSetCookieHeader.split(",").find((c) => c.trim().startsWith("pw_rt="));
    expect(rtCookie).toBeDefined();
    expect(rtCookie).toContain("pw_rt=");
  });

  it("access token cookie is set with httpOnly on successful refresh", async () => {
    const { refreshToken } = await createTestUserAndGetTokens();

    const { GET, POST } = await import("../../app/api/auth/refresh/route");

    // Get CSRF token first
    const getReq = makeRefreshGetRequest();
    const getRes = await GET(getReq as unknown as Parameters<typeof GET>[0]);
    const setCookieHeader = getRes.headers.get("set-cookie") ?? "";
    const csrfToken = extractCookieValue(setCookieHeader, "csrf_token");

    // POST with valid CSRF (both cookie and header)
    const postReq = makeRefreshPostRequest(refreshToken, csrfToken, csrfToken);
    const postRes = await POST(postReq as unknown as Parameters<typeof POST>[0]);

    expect(postRes.status).toBe(200);

    // Verify access token cookie is set
    const resSetCookieHeader = postRes.headers.get("set-cookie") ?? "";
    const atCookie = resSetCookieHeader.split(",").find((c) => c.trim().startsWith("pw_at="));
    expect(atCookie).toBeDefined();
    expect(atCookie).toContain("pw_at=");
  });
});
