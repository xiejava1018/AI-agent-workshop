/**
 * app/api/admin/models/platform-key/[provider]/route.ts
 *
 * Task 4.4 — remove a platform API key for one provider. OWNER-only.
 *
 * DELETE /api/admin/models/platform-key/[provider]
 *   - Deletes the PlatformApiKey row for the provider. Idempotent: a missing
 *     row returns 404 so the caller can distinguish "nothing to delete".
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ownerGate } from "@/lib/platform-keys";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const gate = await ownerGate(req);
  if (!gate.ok) {
    return gate.authed
      ? NextResponse.json({ error: "forbidden" }, { status: 403 })
      : NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  const { provider: rawProvider } = await params;
  const provider = decodeURIComponent(rawProvider ?? "").trim();
  if (provider.length === 0) {
    return NextResponse.json({ error: "provider required" }, { status: 400 });
  }

  const existing = await prisma.platformApiKey.findUnique({
    where: { provider },
    select: { provider: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.platformApiKey.delete({ where: { provider } });
  return new NextResponse(null, { status: 204 });
}
