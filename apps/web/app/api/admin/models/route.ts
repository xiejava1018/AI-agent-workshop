/**
 * app/api/admin/models/route.ts
 *
 * Task 4.4 — model configuration admin surface.
 *
 * GET /api/admin/models
 *   - Admin-only (OWNER or ADMIN). Returns the file-based model config
 *     (providers, defaultModel, fallbackOrder) reused verbatim from the
 *     `/api/models-config` source of truth, PLUS the platform API-key pool
 *     status: which providers have a stored key (NEVER the key material).
 *
 * Platform key mutations live under `/api/admin/models/platform-key(s)`.
 *
 * SECURITY: role is always derived from the DB (assertIsAdmin); the
 * `x-user-role` header is never trusted. Key material never leaves the server.
 */

import { NextRequest, NextResponse } from "next/server";
import { assertIsAdmin } from "@/lib/server-user";
import { readModelsConfig } from "@/lib/models-config";
import { loadPlatformKeyStatus } from "@/lib/platform-keys";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await assertIsAdmin(req);
  if (!admin) {
    if (!req.headers.get("x-user-id")) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const config = readModelsConfig();
  const platformKeys = await loadPlatformKeyStatus();

  return NextResponse.json({
    providers: config.providers ?? {},
    defaultModel: config.defaultModel ?? null,
    fallbackOrder: config.fallbackOrder ?? null,
    platformKeys,
  });
}
