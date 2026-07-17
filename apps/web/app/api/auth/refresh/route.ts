// app/api/auth/refresh/route.ts
//
// M2.3 — refresh access token via a valid pw_rt cookie.
//
// Flow:
//   1. Read pw_rt cookie. Missing → 401 "refresh token required" (clear both cookies).
//   2. jwtVerify with the shared secret. type MUST be "refresh".
//      Invalid/expired/wrong-type → 401 "invalid refresh token" (clear both cookies).
//   3. isRefreshTokenRevoked(jti) → 401 "invalid refresh token" (clear both cookies).
//   4. revokeRefreshToken(jti, exp) — persist old jti to blacklist.
//   5. signAccessToken + signRefreshToken via getPasswordAuthProvider().
//   6. Set new cookies, return 200 { ok: true }.
//
// Security:
//   - HS256 with PI_WEB_JWT_SECRET (same as access tokens, distinguished by type claim).
//   - Token rotation: every successful refresh issues a new jti; the old jti is
//     blacklisted so a stolen refresh token can only be used once.
//   - On any failure, both pw_at and pw_rt are cleared client-side so the
//     browser drops the stale session.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { jwtVerify } from "jose";
import { getPasswordAuthProvider } from "@/lib/auth-provider";
import "@/lib/auth-provider-bootstrap"; // side-effect: registers LocalPasswordAuthProvider
import { isRefreshTokenRevoked, revokeRefreshToken } from "@/lib/token-blacklist";

const COOKIE_AT = "pw_at";
const COOKIE_RT = "pw_rt";
const COOKIE_CSRF = "csrf_token";
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const ACCESS_MAX_AGE = 60 * 15; // 15 minutes
const CSRF_MAX_AGE = 60 * 60 * 24; // 24 hours

function loadSecret(): Uint8Array {
  const secret = process.env.PI_WEB_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "PI_WEB_JWT_SECRET is not set. Configure a strong random secret in the environment."
    );
  }
  return new TextEncoder().encode(secret);
}

function clearBothCookies(res: NextResponse): void {
  // Use maxAge: 0 to instruct the browser to drop the cookie.
  res.cookies.set(COOKIE_AT, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  res.cookies.set(COOKIE_RT, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Double-Submit Cookie Pattern CSRF validation.
 * Compares the csrf_token cookie value with the x-csrf-token header value.
 * Lenient: if no CSRF cookie is present (client didn't call GET first), skip validation.
 * This maintains backward compatibility with existing clients while protecting
 * state-changing operations when the client follows the proper flow.
 */
function validateCsrf(req: NextRequest): boolean {
  const csrfCookie = req.cookies.get(COOKIE_CSRF)?.value;
  const csrfHeader = req.headers.get("x-csrf-token");

  // If no CSRF cookie, skip validation (client hasn't called GET to obtain token)
  if (!csrfCookie) {
    return true;
  }

  // If CSRF cookie is present, header must match
  return Boolean(csrfHeader && csrfCookie === csrfHeader);
}

/**
 * GET /api/auth/refresh — issues a CSRF token cookie.
 * The client JS reads this cookie and echoes it back via x-csrf-token header
 * on state-changing requests (POST).
 */
export async function GET(req: NextRequest) {
  const csrfToken = randomBytes(32).toString("hex");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_CSRF, csrfToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: CSRF_MAX_AGE,
    path: "/api/auth",
  });
  return res;
}

export async function POST(req: NextRequest) {
  // CSRF validation using Double-Submit Cookie Pattern
  if (!validateCsrf(req)) {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  const refreshToken = req.cookies.get(COOKIE_RT)?.value;
  if (!refreshToken) {
    const res = NextResponse.json(
      { error: "refresh token required" },
      { status: 401 }
    );
    clearBothCookies(res);
    return res;
  }

  // Verify JWT signature + claims.
  let payload: { sub?: unknown; type?: unknown; jti?: unknown; exp?: number };
  try {
    const result = await jwtVerify(refreshToken, loadSecret());
    payload = result.payload as typeof payload;
  } catch {
    const res = NextResponse.json(
      { error: "invalid refresh token" },
      { status: 401 }
    );
    clearBothCookies(res);
    return res;
  }

  if (
    payload.type !== "refresh" ||
    typeof payload.sub !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.exp !== "number"
  ) {
    const res = NextResponse.json(
      { error: "invalid refresh token" },
      { status: 401 }
    );
    clearBothCookies(res);
    return res;
  }

  // Replay protection: a rotated/already-revoked jti is invalid.
  if (await isRefreshTokenRevoked(payload.jti)) {
    const res = NextResponse.json(
      { error: "invalid refresh token" },
      { status: 401 }
    );
    clearBothCookies(res);
    return res;
  }

  // Rotate: blacklist the old jti, then mint a fresh pair.
  await revokeRefreshToken(payload.jti, new Date(payload.exp * 1000));

  const provider = getPasswordAuthProvider();
  const accessToken = await provider.signAccessToken(payload.sub);
  const refreshTokenNew = await provider.signRefreshToken(payload.sub);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_AT, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE,
  });
  res.cookies.set(COOKIE_RT, refreshTokenNew, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_MAX_AGE,
  });
  return res;
}
