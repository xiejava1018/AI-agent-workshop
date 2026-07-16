// app/api/admin/users/route.ts
//
// M2.3 — admin user creation & listing API.
//
// POST /api/admin/users
//   - Gated to OWNER or ADMIN role derived from the database.
//   - Body: { username: string }
//   - Behavior: trim username; 400 on empty; 409 on duplicate; otherwise
//     create a new user with a 16-byte URL-safe base64 random password,
//     bcrypt-hash it (cost 10), and force mustChangePassword=true on first
//     login. createdBy is set to the admin's userId.
//   - Returns: { id, username, initialPassword } — the plaintext password is
//     returned EXACTLY ONCE (it is never persisted in cleartext).
//
// GET /api/admin/users
//   - Same gate.
//   - Returns the list of users that share at least one team with the
//     caller. Useful for the M2.3 dashboard user-management entry point.
//   - Returns: { users: [{ id, username, mustChangePassword, createdBy }] }
//
// Authorization note: both routes deliberately return the same 401/403 shape
// regardless of whether the caller is unauthenticated or authenticated-as-MEMBER,
// so a probe cannot distinguish "not logged in" from "logged in as non-admin".

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assertIsAdmin, getUserHighestRole } from "@/lib/server-user";

const BCRYPT_COST = 10;
const PASSWORD_BYTES = 16; // 16 random bytes → 22-char base64url string

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}

function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function generateInitialPassword(): string {
  // base64url → URL-safe, no padding. 16 bytes yields 22 characters.
  return randomBytes(PASSWORD_BYTES).toString("base64url");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Mirror the M2.x convention: distinguish 401 (no auth headers) from 403
  // (authenticated but not admin) so legitimate clients can tell whether to
  // re-login vs. escalate.
  //
  // SECURITY: `x-user-role` on the request is never trusted. We derive the
  // caller's role from the database via `getUserHighestRole`, matching the
  // pattern used in `app/api/agent/[id]/route.ts`. An attacker who appends
  // `x-user-role: OWNER` to a request cannot bypass the gate.
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorizedResponse();
  const callerRole = await getUserHighestRole(callerId);
  if (callerRole !== "OWNER" && callerRole !== "ADMIN") return forbiddenResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { username: rawUsername } = body as { username?: unknown };
  if (typeof rawUsername !== "string") {
    return NextResponse.json({ error: "username required" }, { status: 400 });
  }
  const username = rawUsername.trim();
  if (username.length === 0) {
    return NextResponse.json({ error: "username required" }, { status: 400 });
  }

  // Reject duplicates BEFORE generating a password — we must NOT return a
  // plaintext password that we never stored.
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "username exists" }, { status: 409 });
  }

  const initialPassword = generateInitialPassword();
  const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_COST);

  // Auto-bind the new admin to a team so they can immediately use the
  // app. Without this, /api/agent/new returns 400 "no project selected"
  // (route.ts:63) and 403 "forbidden" (route.ts:81) — neither of which
  // is actionable from the admin-creation UI. Strategy: prefer the
  // caller's first team; if the caller has no team, fall back to the
  // first team in the DB; if no teams exist, create a "Default Team".
  // The bound project's rootPath is recorded as lastProjectId so
  // /api/agent/new can resolve cwd from user.lastProjectId.
  const callerTeam = await prisma.teamMember.findFirst({
    where: { userId: callerId },
    select: { teamId: true },
  });
  let teamId: string;
  if (callerTeam) {
    teamId = callerTeam.teamId;
  } else {
    const anyTeam = await prisma.team.findFirst({ select: { id: true } });
    if (anyTeam) {
      teamId = anyTeam.id;
    } else {
      const created = await prisma.team.create({
        data: { name: "Default Team", ownerUserId: callerId },
        select: { id: true },
      });
      teamId = created.id;
    }
  }

  // Use a single transaction so user + team membership + project binding
  // either all succeed or all roll back. Avoids a half-bound admin
  // (user exists but has no team, or team exists but user not in it)
  // that would still surface 400/403 on /api/agent/new.
  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        username,
        passwordHash,
        mustChangePassword: true,
        createdBy: callerId,
      },
      select: { id: true, username: true },
    });
    await tx.teamMember.create({
      data: { teamId, userId: created.id, role: "MEMBER" },
    });
    // Pick a project in the same team. Use the first by createdAt so
    // binding is deterministic; if none, create a per-user scratch dir.
    const existingProject = await tx.project.findFirst({
      where: { teamId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    let projectId: string;
    if (existingProject) {
      projectId = existingProject.id;
    } else {
      const { mkdirSync } = await import("fs");
      const { join } = await import("path");
      const scratchPath = join(
        process.cwd(),
        "data",
        "projects",
        `user-${created.username}`,
      );
      mkdirSync(scratchPath, { recursive: true });
      const newProject = await tx.project.create({
        data: {
          teamId,
          name: `${username}'s workspace`,
          rootPath: scratchPath,
          createdBy: callerId,
        },
        select: { id: true },
      });
      projectId = newProject.id;
    }
    await tx.user.update({
      where: { id: created.id },
      data: { lastProjectId: projectId },
    });
    return { id: created.id, username: created.username };
  });

  return NextResponse.json({
    id: result.id,
    username: result.username,
    initialPassword,
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await assertIsAdmin(req);
  if (!admin) {
    // Distinguish missing-auth (401) from non-admin (403) for clarity.
    if (!req.headers.get("x-user-id")) return unauthorizedResponse();
    return forbiddenResponse();
  }

  // List users that share at least one team with the caller.
  // Strategy: find teamIds the admin belongs to, then find all
  // TeamMembers in those teams, then collect their users.
  const memberships = await prisma.teamMember.findMany({
    where: { userId: admin.userId },
    select: { teamId: true },
  });
  const teamIds = memberships.map(m => m.teamId);

  const teamMembers =
    teamIds.length === 0
      ? []
      : await prisma.teamMember.findMany({
          where: { teamId: { in: teamIds } },
          select: {
            user: {
              select: {
                id: true,
                username: true,
                mustChangePassword: true,
                createdBy: true,
                disabled: true,
              },
            },
          },
        });

  // De-duplicate users in case they belong to multiple of the admin's teams.
  const seen = new Set<string>();
  const users = teamMembers
    .map(tm => tm.user)
    .filter(u => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });

  return NextResponse.json({ users });
}