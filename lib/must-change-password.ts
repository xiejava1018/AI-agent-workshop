// lib/must-change-password.ts
import { NextRequest, NextResponse } from "next/server";

const ALLOWLIST = new Set(["/api/auth/change-password"]);

export function enforceNotMustChange(req: NextRequest): NextResponse | null {
  // 白名单：change-password 自身 + 静态资源 (中间件已挡)
  if (ALLOWLIST.has(req.nextUrl.pathname)) return null;

  // 读 header
  const flag = req.headers.get("x-must-change-password");

  // 'true' (string from middleware) → 拦截
  if (flag === "true") {
    return NextResponse.json(
      { error: "password change required" },
      { status: 403 }
    );
  }

  // 'false' / 缺失 (dev 直接 curl 场景) → 通过
  return null;
}
