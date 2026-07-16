/**
 * app/api/admin/teams/[id]/invite-links/route.ts
 *
 * Task 4.3 — Team invite links (list / create).
 *
 * GET /api/admin/teams/[id]/invite-links — list active invite links
 *   - RBAC: OWNER or ADMIN of the team, OR a platform OWNER.
 *   - "Active" = not expired AND not yet used (usedBy is null).
 *   - 404 when the team does not exist.
 *   - Returns { inviteLinks: [...] }.
 *
 * POST /api/admin/teams/[id]/invite-links — create an invite link
 *   - RBAC: OWNER or ADMIN of the team, OR a platform OWNER.
 *   - Body: { role?, expiresInHours?, requireAccount? }
 *   - role defaults to "MEMBER"; must be ADMIN|MEMBER.
 *   - expiresInHours defaults to 24; must be a positive number.
 *   - Generates a URL-safe random token.
 *   - 404 when the team does not exist.
 *   - Returns the created invite link (201).
 *
 * SECURITY: role is always re-derived from the DB; `x-user-role` is not trusted.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { canAdministerTeam } from "../members/route";

export const dynamic = "force-dynamic";

const DEFAULT_EXPIRES_HOURS = 24;
const TOKEN_BYTES = 24; // 24 random bytes → 32-char base64url token
const MS_PER_HOUR = 60 * 60 * 1000;

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

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export async function GET(
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

  // Active = not expired and not yet used.
  const inviteLinks = await prisma.inviteLink.findMany({
    where: {
      teamId,
      usedBy: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ inviteLinks });
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
    // Body is optional for this endpoint; treat unparsable/empty as defaults.
    body = {};
  }
  if (typeof body !== "object" || body === null) body = {};
  const { role: rawRole, expiresInHours: rawExpires, requireAccount: rawRequireAccount } =
    body as {
      role?: unknown;
      expiresInHours?: unknown;
      requireAccount?: unknown;
    };

  let role = "MEMBER";
  if (rawRole !== undefined) {
    if (rawRole !== "ADMIN" && rawRole !== "MEMBER") {
      return badRequestResponse('role must be "ADMIN" or "MEMBER"');
    }
    role = rawRole;
  }

  let expiresInHours = DEFAULT_EXPIRES_HOURS;
  if (rawExpires !== undefined) {
    if (typeof rawExpires !== "number" || !Number.isFinite(rawExpires) || rawExpires <= 0) {
      return badRequestResponse("expiresInHours must be a positive number");
    }
    expiresInHours = rawExpires;
  }

  const requireAccount = typeof rawRequireAccount === "boolean" ? rawRequireAccount : true;

  const expiresAt = new Date(Date.now() + expiresInHours * MS_PER_HOUR);

  const inviteLink = await prisma.inviteLink.create({
    data: {
      teamId,
      token: generateToken(),
      role,
      expiresAt,
      requireAccount,
    },
  });

  return NextResponse.json({ inviteLink }, { status: 201 });
}
