// app/api/admin/sessions/[id]/route.ts
//
// T7.3 — session body privacy for platform admin.
//
// GET /api/admin/sessions/[id]
//   - Gated to OWNER or ADMIN role (derived from DB, never trusted from headers).
//   - Returns ONLY session metadata: id, title, createdAt, tokenUsage, status.
//   - Never returns jsonlPath (the path to conversation body content).
//   - This ensures platform admins can audit session metadata without
//     accessing the actual conversation content.
//
// SECURITY: `x-user-id` is the only trusted header. The role is re-derived
// from the DB so a forged `x-user-role` cannot elevate a non-admin.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserHighestRole } from "@/lib/server-user";

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}

function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function notFoundResponse(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

/**
 * Resolve the caller from `x-user-id`, returning { callerId, callerRole } for
 * an admin, or null (with a flag distinguishing 401 vs 403) otherwise.
 *
 * SECURITY: `x-user-id` is the only trusted header. The role is re-derived
 * from the DB so a forged `x-user-role` cannot elevate a non-admin.
 */
async function resolveAdmin(
  req: NextRequest
): Promise<
  | { ok: true; callerId: string; callerRole: "OWNER" | "ADMIN" }
  | { ok: false; status: 401 | 403 }
> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return { ok: false, status: 401 };
  const callerRole = await getUserHighestRole(callerId);
  if (callerRole !== "OWNER" && callerRole !== "ADMIN") {
    return { ok: false, status: 403 };
  }
  return { ok: true, callerId, callerRole };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await resolveAdmin(req);
  if (!admin.ok) {
    return admin.status === 401 ? unauthorizedResponse() : forbiddenResponse();
  }

  const { id: sessionId } = await params;

  // Fetch session with ONLY the metadata fields - never include jsonlPath
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      createdAt: true,
      tokenUsage: true,
      status: true,
    },
  });

  if (!session) {
    return notFoundResponse();
  }

  return NextResponse.json({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    tokenUsage: session.tokenUsage,
    status: session.status,
  });
}
