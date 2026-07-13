import { NextRequest, NextResponse } from "next/server";
import { getAuthProvider } from "@/lib/auth-provider";

// Module-level: provider is registered by user-login/route.ts.
// If user-login hasn't loaded (e.g. only logout is hit in tests), the
// registry will throw "AuthProvider not registered" — that's the spec
// contract: the routes share one registry, not each register its own.
const provider = getAuthProvider();

export async function POST(req: NextRequest) {
  // userId 从 cookie 拿不到时静默清 cookie（M1: 无 revoke 表）
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("pw_at");
  return res;
}