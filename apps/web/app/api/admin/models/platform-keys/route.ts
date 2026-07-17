/**
 * app/api/admin/models/platform-keys/route.ts
 *
 * Task 4.4 — list platform key pool status. OWNER-only.
 *
 * GET /api/admin/models/platform-keys
 *   - Returns which providers have a stored key (NOT the keys themselves).
 */

import { NextRequest, NextResponse } from "next/server";
import { ownerGate, loadPlatformKeyStatus } from "@/lib/platform-keys";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await ownerGate(req);
  if (!gate.ok) {
    return gate.authed
      ? NextResponse.json({ error: "forbidden" }, { status: 403 })
      : NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  const platformKeys = await loadPlatformKeyStatus();
  return NextResponse.json({ platformKeys });
}
