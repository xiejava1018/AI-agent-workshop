/**
 * app/api/skills/install/route.ts
 *
 * POST /api/skills/install — install a skill.
 *
 * This endpoint supports two shapes, dispatched on the request body:
 *
 *   1. Scoped DB registration (Task 5.1) — body carries `slug`:
 *      { slug, name, description?, scope: "global"|"team"|"user",
 *        teamId?, userId?, source?, filePath? }
 *      Registers a `SkillPackage` row for the given scope. RBAC:
 *        - global : OWNER only (platform admin)
 *        - team   : OWNER or ADMIN of that team (teamId required)
 *        - user   : any authenticated user, for themselves (userId defaults
 *                   to the caller; installing for another user requires OWNER)
 *      SECURITY: caller role is derived from the DB via `getUserHighestRole`,
 *      never trusted from `x-user-role`.
 *
 *   2. Legacy npx filesystem install — body carries `package`:
 *      { package, scope: "global"|"project", cwd? }
 *      Runs `npx ... skills add` to install a bundle onto disk. Preserved for
 *      backward compatibility with the existing SkillsConfig UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { resolve, relative, sep } from "path";
import { runNpx } from "@/lib/npx";
import { prisma } from "@/lib/prisma";
import { getUserHighestRole } from "@/lib/user-role";

// Skills root — filePath values are validated against this at install time
const SKILLS_ROOT = resolve(process.env.SKILLS_ROOT ?? "./.skills");

export const dynamic = "force-dynamic";

const ANSI_RE = /\x1B\[[0-9;]*m/g;

const VALID_SCOPES = ["global", "team", "user"] as const;
type SkillScope = (typeof VALID_SCOPES)[number];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}

function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function badRequestResponse(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}

function isSkillScope(v: unknown): v is SkillScope {
  return typeof v === "string" && (VALID_SCOPES as readonly string[]).includes(v);
}

/**
 * Validate that a filePath resolves to a location within SKILLS_ROOT.
 * Rejects empty paths and any path that escapes the skills directory (path traversal).
 */
function isValidSkillFilePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== "string") return false;
  const candidate = resolve(filePath);
  const rel = relative(SKILLS_ROOT, candidate);
  return !(rel.startsWith(`..${sep}`) || rel.includes(".."));
}

/** Check if caller is OWNER or ADMIN of a specific team. */
async function isTeamAdmin(teamId: string, callerId: string): Promise<boolean> {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: callerId } },
    select: { role: true },
  });
  return membership?.role === "OWNER" || membership?.role === "ADMIN";
}

// -----------------------------------------------------------------------------
// POST — dispatch on body shape
// -----------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequestResponse("invalid body");
  }
  if (typeof body !== "object" || body === null) {
    return badRequestResponse("invalid body");
  }

  // Scoped DB registration path (Task 5.1) is selected by the presence of `slug`.
  if ("slug" in body) {
    return handleScopedInstall(req, body);
  }
  // Legacy npx filesystem install path.
  return handleNpxInstall(body);
}

// -----------------------------------------------------------------------------
// Scoped DB registration (Task 5.1)
// -----------------------------------------------------------------------------

async function handleScopedInstall(
  req: NextRequest,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorizedResponse();

  const { slug: rawSlug, name: rawName, description, scope: rawScope, teamId, userId, source, filePath: rawFilePath } =
    body;

  if (typeof rawSlug !== "string" || rawSlug.trim().length === 0) {
    return badRequestResponse("slug required");
  }
  const slug = rawSlug.trim();

  if (typeof rawName !== "string" || rawName.trim().length === 0) {
    return badRequestResponse("name required");
  }
  const name = rawName.trim();

  if (!isSkillScope(rawScope)) {
    return badRequestResponse('scope must be "global" | "team" | "user"');
  }
  const scope = rawScope;

  // Validate filePath if provided — must stay within SKILLS_ROOT
  const filePath = typeof rawFilePath === "string" && rawFilePath.trim() !== ""
    ? rawFilePath.trim()
    : "";
  if (filePath && !isValidSkillFilePath(filePath)) {
    return badRequestResponse("filePath must be inside the skills root directory");
  }

  // Resolve tenant + RBAC per scope.
  let resolvedTeamId: string | null = null;
  let resolvedUserId: string | null = null;

  if (scope === "global") {
    // Platform admin (OWNER) only.
    const role = await getUserHighestRole(callerId);
    if (role !== "OWNER") return forbiddenResponse();
  } else if (scope === "team") {
    if (typeof teamId !== "string" || teamId.trim().length === 0) {
      return badRequestResponse("teamId required for team-scoped skill");
    }
    const admin = await isTeamAdmin(teamId, callerId);
    if (!admin) return forbiddenResponse();
    resolvedTeamId = teamId;
  } else {
    // scope === "user": any authenticated user, for themselves. userId defaults
    // to the caller; installing for a different user requires platform OWNER.
    const targetUserId =
      typeof userId === "string" && userId.trim().length > 0 ? userId.trim() : callerId;
    if (targetUserId !== callerId) {
      const role = await getUserHighestRole(callerId);
      if (role !== "OWNER") return forbiddenResponse();
    }
    resolvedUserId = targetUserId;
  }

  // App-level duplicate check. The DB has @@unique([scope, slug, teamId,
  // userId]), but Postgres treats NULLs as distinct, so global/user rows (whose
  // teamId is NULL, or team rows whose userId is NULL) would NOT trip the unique
  // index. We check explicitly to reliably prevent duplicates across all scopes.
  const existing = await prisma.skillPackage.findFirst({
    where: { scope, slug, teamId: resolvedTeamId, userId: resolvedUserId },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "skill already installed for this scope" },
      { status: 409 },
    );
  }

  try {
    const created = await prisma.skillPackage.create({
      data: {
        slug,
        name,
        description: typeof description === "string" ? description : "",
        scope,
        teamId: resolvedTeamId,
        userId: resolvedUserId,
        source: typeof source === "string" ? source : "",
        filePath,
      },
    });
    return NextResponse.json({ skill: created }, { status: 201 });
  } catch (e) {
    // Unique constraint (scope, slug, teamId, userId) — already installed
    // (covers the concurrent-insert race the pre-check can't).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "skill already installed for this scope" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// -----------------------------------------------------------------------------
// Legacy npx filesystem install
// -----------------------------------------------------------------------------

async function handleNpxInstall(body: Record<string, unknown>): Promise<NextResponse> {
  try {
    const pkg = body.package as string | undefined;
    const scope = body.scope as string | undefined;
    const cwd = body.cwd as string | undefined;
    if (!pkg?.trim()) return NextResponse.json({ error: "package required" }, { status: 400 });

    const isGlobal = scope !== "project";
    const args = ["skills", "add", pkg.trim(), "-y", "--agent", "pi"];
    if (isGlobal) args.push("-g");

    console.log(`[skills/install] running: npx ${args.join(" ")}`);
    const { stdout, stderr } = await runNpx(args, {
      timeout: 60000,
      cwd: !isGlobal && cwd ? cwd : undefined,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    const output = (stdout + stderr).replace(ANSI_RE, "");
    const success = /Installation complete|Installed \d+ skill/.test(output);
    if (!success) {
      return NextResponse.json({ error: output.slice(-300) || "Install failed" }, { status: 500 });
    }
    return NextResponse.json({ success: true, output });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = ((err.stdout ?? "") + (err.stderr ?? "")).replace(ANSI_RE, "");
    return NextResponse.json({ error: output || (err.message ?? String(e)) }, { status: 500 });
  }
}
