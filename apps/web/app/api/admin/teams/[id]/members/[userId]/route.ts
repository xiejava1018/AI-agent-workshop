/**
 * app/api/admin/teams/[id]/members/[userId]/route.ts
 *
 * Task 4.3 — Team member management (remove / update role).
 *
 * DELETE /api/admin/teams/[id]/members/[userId] — remove a member
 *   - RBAC: OWNER or ADMIN of the team, OR a platform OWNER.
 *   - The team owner (Team.ownerUserId) can NEVER be removed.
 *   - 404 when the team does not exist or the target is not a member.
 *   - Returns { teamId, userId, removed: true }.
 *
 * PUT /api/admin/teams/[id]/members/[userId] — update member role
 *   - RBAC: OWNER or ADMIN of the team, OR a platform OWNER.
 *   - Body: { role: "ADMIN" | "MEMBER" }
 *   - The team owner's role can NEVER be changed through this endpoint.
 *   - 400 when role missing/invalid.
 *   - 404 when the team does not exist or the target is not a member.
 *   - Returns the updated membership.
 *
 * SECURITY: role is always re-derived from the DB; `x-user-role` is not trusted.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAdministerTeam } from "../route";

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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorizedResponse();

  const { id: teamId, userId: targetUserId } = await params;

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, ownerUserId: true },
  });
  if (!team) return notFoundResponse();

  if (!(await canAdministerTeam(teamId, callerId))) return forbiddenResponse();

  // The team owner can never be removed — that would orphan the team.
  if (targetUserId === team.ownerUserId) {
    return badRequestResponse("cannot remove the team owner");
  }

  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: targetUserId } },
    select: { teamId: true },
  });
  if (!membership) return notFoundResponse();

  await prisma.teamMember.delete({
    where: { teamId_userId: { teamId, userId: targetUserId } },
  });

  return NextResponse.json({ teamId, userId: targetUserId, removed: true });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorizedResponse();

  const { id: teamId, userId: targetUserId } = await params;

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, ownerUserId: true },
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
  const { role: rawRole } = body as { role?: unknown };
  if (rawRole !== "ADMIN" && rawRole !== "MEMBER") {
    return badRequestResponse('role must be "ADMIN" or "MEMBER"');
  }

  // The team owner's role can never be changed here — demoting the owner would
  // break the team's ownership invariant.
  if (targetUserId === team.ownerUserId) {
    return badRequestResponse("cannot change the team owner's role");
  }

  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: targetUserId } },
    select: { teamId: true },
  });
  if (!membership) return notFoundResponse();

  const member = await prisma.teamMember.update({
    where: { teamId_userId: { teamId, userId: targetUserId } },
    data: { role: rawRole },
  });

  return NextResponse.json({ member });
}
