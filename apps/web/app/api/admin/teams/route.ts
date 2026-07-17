/**
 * app/api/admin/teams/route.ts
 *
 * Task 4.3 — Team hybrid lifecycle (create / list).
 *
 * POST /api/admin/teams — create a team
 *   - RBAC: platform admin (platform:access via assertPlatformAdmin).
 *   - Body: { name, ownerUserId }
 *   - Creates the Team with ownerUserId as its owner AND an OWNER-role
 *     TeamMember row for that user, so downstream team-level admin checks
 *     resolve correctly.
 *   - 400 when name/ownerUserId missing or ownerUserId does not exist.
 *   - Returns the created team (201).
 *
 * GET /api/admin/teams — list teams
 *   - RBAC: platform admin (platform:access via assertPlatformAdmin).
 *   - Query params: page? (1-based), limit? (default 50, max 100).
 *   - Returns teams with member count and owner info.
 *
 * SECURITY: `x-user-id` is trusted (middleware sets it from the verified JWT);
 * `x-user-role` is NEVER trusted — the caller's platform admin status is
 * re-derived from the DB via assertPlatformAdmin.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertPlatformAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}

function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function badRequestResponse(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}

// -----------------------------------------------------------------------------
// POST — create team (platform OWNER only)
// -----------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorizedResponse();
  // M4 RBAC 平台中台:平台管理员才能创建团队(原"任意团队 OWNER"已收紧)
  const callerIsPlatformAdmin = await assertPlatformAdmin(req);
  if (!callerIsPlatformAdmin) return forbiddenResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequestResponse("invalid body");
  }
  if (typeof body !== "object" || body === null) {
    return badRequestResponse("invalid body");
  }
  const { name: rawName, ownerUserId: rawOwnerId } = body as {
    name?: unknown;
    ownerUserId?: unknown;
  };

  if (typeof rawName !== "string" || rawName.trim().length === 0) {
    return badRequestResponse("name required");
  }
  const name = rawName.trim();

  if (typeof rawOwnerId !== "string" || rawOwnerId.trim().length === 0) {
    return badRequestResponse("ownerUserId required");
  }
  const ownerUserId = rawOwnerId.trim();

  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId },
    select: { id: true },
  });
  if (!owner) return badRequestResponse("ownerUserId does not exist");

  // Create the team and its OWNER membership atomically so team-level admin
  // checks (TeamMember.role === "OWNER") always find the owner row.
  const team = await prisma.$transaction(async (tx) => {
    const created = await tx.team.create({
      data: { name, ownerUserId },
    });
    await tx.teamMember.create({
      data: { teamId: created.id, userId: ownerUserId, role: "OWNER" },
    });
    return created;
  });

  return NextResponse.json({ team }, { status: 201 });
}

// -----------------------------------------------------------------------------
// GET — list teams (platform admin)
// -----------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await assertPlatformAdmin(req);
  if (!admin) {
    if (!req.headers.get("x-user-id")) return unauthorizedResponse();
    return forbiddenResponse();
  }

  const { searchParams } = new URL(req.url);
  const pageRaw = Number(searchParams.get("page") ?? "1");
  const limitRaw = Number(searchParams.get("limit") ?? String(DEFAULT_PAGE_LIMIT));
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw >= 1
      ? Math.min(Math.floor(limitRaw), MAX_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT;

  const [total, teams] = await Promise.all([
    prisma.team.count(),
    prisma.team.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: { select: { members: true } },
      },
    }),
  ]);

  // Resolve owner usernames in one batched query.
  const ownerIds = [...new Set(teams.map((t) => t.ownerUserId))];
  const owners =
    ownerIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, username: true },
        });
  const ownerById = new Map(owners.map((o) => [o.id, o.username]));

  const result = teams.map((t) => ({
    id: t.id,
    name: t.name,
    ownerUserId: t.ownerUserId,
    ownerUsername: ownerById.get(t.ownerUserId) ?? null,
    tokenDailyLimit: t.tokenDailyLimit,
    maxConcurrentSessions: t.maxConcurrentSessions,
    createdAt: t.createdAt,
    memberCount: t._count.members,
  }));

  return NextResponse.json({ teams: result, total, page, limit });
}
