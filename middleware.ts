import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma"; // M2.2 NEW: now possible with runtime:'nodejs'

const SECRET = process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod";

export const config = {
  runtime: "nodejs", // M2.2 NEW: required for Prisma in middleware (edge runtime can't run Prisma)
  matcher: [
    // 拦截 /api/*, 但放过:
    //  - user-login, user-logout
    //  - fork 现有 model provider auth: providers/login/logout/api-key/all-providers
    //  - 静态资源
    // M1 preserved verbatim - non-capturing groups (?:...) required by path-to-regexp v8
    "/((?!_next/|favicon|api/auth/(?:user-login|user-logout)|api/auth/(?:providers|login|logout|all-providers|api-key)).*)",
    // 显式拦 /api/* 一律
    "/api/((?!auth/(?:user-login|user-logout|providers|login|logout|all-providers|api-key)).*)",
  ],
};

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get("pw_at")?.value;
  if (!cookie) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }
  try {
    const { payload } = await jwtVerify(cookie, new TextEncoder().encode(SECRET));
    const userId = String(payload.sub);

    // M2.2 NEW: query mustChangePassword from DB (now possible with runtime:'nodejs')
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mustChangePassword: true },
    });
    if (!user) {
      // JWT is valid but user was deleted - treat as invalid session
      return NextResponse.json({ error: "invalid session" }, { status: 401 });
    }

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-user-id", userId);
    requestHeaders.set("x-must-change-password", String(user.mustChangePassword)); // M2.2 NEW

    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    return NextResponse.json({ error: "invalid session" }, { status: 401 });
  }
}