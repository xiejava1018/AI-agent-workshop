/**
 * app/api/admin/teams/[id]/members/route.ts
 *
 * Task 4.3 — Team member management (add member).
 *
 * POST /api/admin/teams/[id]/members — add a member
 *   - RBAC: OWNER or ADMIN of the team (team-level role), OR a platform OWNER.
 *   - Body: { userId, role: "ADMIN" | "MEMBER" }
 *   - The team owner's OWNER role cannot be granted via this endpoint.
 *   - 400 when userId/role missing or role invalid or user does not exist.
 *   - 404 when the team does not exist.
 *   - 409 when the user is already a member.
 *   - Returns the created membership (201).
 *
 * SECURITY: role is always re-derived from the DB; `x-user-role` is not trusted.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAdministerTeam } from "@/lib/team-admin";

export const dynamic = "force-dynamic";

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}

function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function badRequestResponse(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}

function notFoundResponse(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorizedResponse();

  const { id: teamId } = await params;

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true },
  });
  if (!team) return notFoundResponse();

  if (!(await canAdministerTeam(teamId, callerId))) return forbiddenResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequestResponse("invalid body");
  }
  if (typeof body !== "object" || body === null) {
    return badRequestResponse("invalid body");
  }
  const { userId: rawUserId, role: rawRole } = body as {
    userId?: unknown;
    role?: unknown;
  };

  if (typeof rawUserId !== "string" || rawUserId.trim().length === 0) {
    return badRequestResponse("userId required");
  }
  const userId = rawUserId.trim();

  if (rawRole !== "ADMIN" && rawRole !== "MEMBER") {
    return badRequestResponse('role must be "ADMIN" or "MEMBER"');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return badRequestResponse("userId does not exist");

  const existing = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { teamId: true },
  });
  if (existing) {
    return NextResponse.json({ error: "user already a member" }, { status: 409 });
  }

  const member = await prisma.teamMember.create({
    data: { teamId, userId, role: rawRole },
  });

  return NextResponse.json({ member }, { status: 201 });
}
