/**
 * app/api/admin/models/platform-key/route.ts
 *
 * Task 4.4 — set (upsert) a platform API key. OWNER-only.
 *
 * POST /api/admin/models/platform-key
 *   - Body: { provider, apiKey }
 *   - Encrypts `apiKey` with AES-256-GCM and upserts the PlatformApiKey row
 *     keyed by provider (one key per provider — enforced by @@unique).
 *   - The plaintext apiKey and ciphertext `secretEnc` are NEVER echoed back.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ownerGate } from "@/lib/platform-keys";
import { encryptSecret } from "@/lib/secret-crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await ownerGate(req);
  if (!gate.ok) {
    return gate.authed
      ? NextResponse.json({ error: "forbidden" }, { status: 403 })
      : NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { provider: rawProvider, apiKey: rawApiKey } = body as Record<string, unknown>;

  if (typeof rawProvider !== "string" || rawProvider.trim().length === 0) {
    return NextResponse.json({ error: "provider required" }, { status: 400 });
  }
  if (typeof rawApiKey !== "string" || rawApiKey.length === 0) {
    return NextResponse.json({ error: "apiKey required" }, { status: 400 });
  }
  const provider = rawProvider.trim();

  let secretEnc: string;
  try {
    secretEnc = encryptSecret(rawApiKey);
  } catch (error) {
    // Misconfigured APP_ENCRYPTION_KEY — fail closed, never persist plaintext.
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  const row = await prisma.platformApiKey.upsert({
    where: { provider },
    create: { provider, secretEnc },
    update: { secretEnc },
    select: { provider: true, updatedAt: true },
  });

  // NEVER return secretEnc or the plaintext apiKey.
  return NextResponse.json({
    provider: row.provider,
    hasKey: true,
    updatedAt: row.updatedAt.toISOString(),
  });
}
