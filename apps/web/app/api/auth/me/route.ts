// app/api/auth/me/route.ts
//
// Returns the current authenticated user's context.
// Middleware already verifies the access token and injects x-user-id / x-user-role.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/server-user";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  const ctx = await getCurrentUserContext(userId);
  if (!ctx) {
    return NextResponse.json({ error: "invalid session" }, { status: 401 });
  }

  return NextResponse.json({
    id: ctx.user.id,
    username: ctx.user.username,
    mustChangePassword: ctx.user.mustChangePassword,
    role: ctx.role,
  });
}
