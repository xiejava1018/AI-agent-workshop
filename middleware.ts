import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SECRET = process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod";

export const config = {
  matcher: [
    // 拦截 /api/*, 但放过:
    //  - user-login, user-logout
    //  - fork 现有 model provider auth: providers/login/logout/api-key/all-providers
    //  - 静态资源
    "/((?!_next/|favicon|api/auth/(user-login|user-logout)|api/auth/(providers|login|logout|all-providers|api-key)).*)",
    // 显式拦 /api/* 一律
    "/api/((?!auth/(user-login|user-logout|providers|login|logout|all-providers|api-key)).*)",
  ],
};

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get("pw_at")?.value;
  if (!cookie) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }
  try {
    const { payload } = await jwtVerify(cookie, new TextEncoder().encode(SECRET));
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-user-id", String(payload.sub));
    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    return NextResponse.json({ error: "invalid session" }, { status: 401 });
  }
}