// app/api/auth/user-logout/route.ts
//
// M2.3 — invalidate the current refresh token and clear both auth cookies.
//
// Flow:
//   1. Read pw_rt cookie. If valid refresh JWT (type=refresh, jti present),
//      persist the jti to RefreshTokenBlacklist so it can never be reused.
//   2. Always clear pw_at + pw_rt cookies (maxAge=0).
//   3. Return 200 { ok: true }.
//
// Note: Logout is intentionally idempotent and best-effort — a missing or
// malformed cookie is not an error. The goal is to leave the client without
// a usable session, regardless of what the client sent.

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { revokeRefreshToken } from "@/lib/token-blacklist";

const COOKIE_AT = "pw_at";
const COOKIE_RT = "pw_rt";

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

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(COOKIE_RT)?.value;

  if (refreshToken) {
    try {
      const { payload } = await jwtVerify(refreshToken, loadSecret());
      if (
        payload.type === "refresh" &&
        typeof payload.jti === "string" &&
        typeof payload.exp === "number"
      ) {
        await revokeRefreshToken(payload.jti, new Date(payload.exp * 1000));
      }
    } catch {
      // Invalid/expired token — nothing to revoke, but still clear cookies.
    }
  }

  const res = NextResponse.json({ ok: true });
  clearBothCookies(res);
  return res;
}
