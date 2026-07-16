/**
 * app/api/admin/teams/[id]/route.ts
 *
 * Task 4.3 — Team hybrid lifecycle (detail / update / delete).
 *
 * GET /api/admin/teams/[id] — team detail with members
 *   - RBAC: platform admin (OWNER or ADMIN).
 *   - Returns team + members (with roles + usernames).
 *   - 404 when the team does not exist.
 *
 * PUT /api/admin/teams/[id] — update team
 *   - RBAC: platform OWNER only.
 *   - Body: { name?, tokenDailyLimit?, maxConcurrentSessions? }
 *   - Only provided fields are updated. Quota fields must be non-negative ints.
 *   - 404 when the team does not exist.
 *
 * DELETE /api/admin/teams/[id] — delete team
 *   - RBAC: platform OWNER only.
 *   - Hard delete with cascade: TeamMember → Project → InviteLink → Team,
 *     inside a single transaction (FKs are ON DELETE RESTRICT in the baseline).
 *   - 404 when the team does not exist.
 *
 * SECURITY: role is always re-derived from the DB; `x-user-role` is not trusted.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserHighestRole } from "@/lib/server-user";

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

/** Resolve the caller and require platform OWNER or ADMIN. */
async function resolvePlatformAdmin(
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

// -----------------------------------------------------------------------------
// GET — team detail with members
// -----------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const admin = await resolvePlatformAdmin(req);
  if (!admin.ok) {
    return admin.status === 401 ? unauthorizedResponse() : forbiddenResponse();
  }

  const { id: teamId } = await params;

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      members: {
        include: { user: { select: { id: true, username: true, disabled: true } } },
        orderBy: { joinedAt: "asc" },
      },
    },
  });
  if (!team) return notFoundResponse();

  const members = team.members.map((m) => ({
    userId: m.userId,
    username: m.user.username,
    disabled: m.user.disabled,
    role: m.role,
    joinedAt: m.joinedAt,
    isOwner: m.userId === team.ownerUserId,
  }));

  return NextResponse.json({
    team: {
      id: team.id,
      name: team.name,
      ownerUserId: team.ownerUserId,
      tokenDailyLimit: team.tokenDailyLimit,
      maxConcurrentSessions: team.maxConcurrentSessions,
      createdAt: team.createdAt,
      members,
    },
  });
}

// -----------------------------------------------------------------------------
// PUT — update team (platform OWNER only)
// -----------------------------------------------------------------------------

/** Validate an optional non-negative integer quota field. */
function parseQuota(
  value: unknown,
  field: string
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return { ok: false, error: `${field} must be a non-negative integer` };
  }
  return { ok: true, value };
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorizedResponse();
  const callerRole = await getUserHighestRole(callerId);
  if (callerRole !== "OWNER") return forbiddenResponse();

  const { id: teamId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequestResponse("invalid body");
  }
  if (typeof body !== "object" || body === null) {
    return badRequestResponse("invalid body");
  }
  const { name, tokenDailyLimit, maxConcurrentSessions } = body as {
    name?: unknown;
    tokenDailyLimit?: unknown;
    maxConcurrentSessions?: unknown;
  };

  const data: {
    name?: string;
    tokenDailyLimit?: number;
    maxConcurrentSessions?: number;
  } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return badRequestResponse("name must be a non-empty string");
    }
    data.name = name.trim();
  }

  const tdl = parseQuota(tokenDailyLimit, "tokenDailyLimit");
  if (!tdl.ok) return badRequestResponse(tdl.error);
  if (tdl.value !== undefined) data.tokenDailyLimit = tdl.value;

  const mcs = parseQuota(maxConcurrentSessions, "maxConcurrentSessions");
  if (!mcs.ok) return badRequestResponse(mcs.error);
  if (mcs.value !== undefined) data.maxConcurrentSessions = mcs.value;

  if (Object.keys(data).length === 0) {
    return badRequestResponse("no fields to update");
  }

  const existing = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true },
  });
  if (!existing) return notFoundResponse();

  const team = await prisma.team.update({ where: { id: teamId }, data });
  return NextResponse.json({ team });
}

// -----------------------------------------------------------------------------
// DELETE — delete team with cascade (platform OWNER only)
// -----------------------------------------------------------------------------

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorizedResponse();
  const callerRole = await getUserHighestRole(callerId);
  if (callerRole !== "OWNER") return forbiddenResponse();

  const { id: teamId } = await params;

  const existing = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true },
  });
  if (!existing) return notFoundResponse();

  // Hard delete with cascade. FKs are ON DELETE RESTRICT in the baseline, so
  // remove dependents first, all inside one transaction.
  await prisma.$transaction([
    prisma.teamMember.deleteMany({ where: { teamId } }),
    prisma.project.deleteMany({ where: { teamId } }),
    prisma.inviteLink.deleteMany({ where: { teamId } }),
    prisma.team.delete({ where: { id: teamId } }),
  ]);

  return NextResponse.json({ id: teamId, deleted: true });
}
