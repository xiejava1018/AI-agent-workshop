/**
 * app/api/digital-employees/route.ts
 *
 * Task 4.1 — Digital Employee CRUD + binding skills/MCP.
 *
 * POST /api/digital-employees
 *   Create a new digital employee (Agent row) with optional skill/MCP bindings.
 *   - scope=team: caller must be OWNER or ADMIN of the team.
 *   - scope=personal: ownerUserId = callerId; any authenticated user may create.
 *
 * GET /api/digital-employees
 *   List agents visible to the caller:
 *   - team agents where caller has OWNER or ADMIN role in the team
 *   - personal agents where ownerUserId = callerId
 *   Query params: scope?: "team"|"personal", teamId?: string
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserHighestRole, getUserTeamIds } from "@/lib/server-user";

export const dynamic = "force-dynamic";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}

/** Cap on GET list queries to prevent unbounded result sets. */
const DEFAULT_LIST_LIMIT = 100;

function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function badRequestResponse(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}

async function getCallerContext(req: NextRequest) {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return null;
  const [role, teamIds] = await Promise.all([
    getUserHighestRole(callerId),
    getUserTeamIds(callerId),
  ]);
  return { callerId, role, teamIds };
}

/** Check if caller is OWNER or ADMIN of a specific team. */
async function isTeamAdmin(teamId: string, callerId: string): Promise<boolean> {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: callerId } },
    select: { role: true },
  });
  return membership?.role === "OWNER" || membership?.role === "ADMIN";
}

/**
 * Batched admin-team check: return the set of teamIds (among `teamIds`) in
 * which `callerId` holds OWNER or ADMIN. One query instead of N per-agent
 * lookups.
 */
async function getAdminTeamIds(teamIds: string[], callerId: string): Promise<Set<string>> {
  if (teamIds.length === 0) return new Set();
  const memberships = await prisma.teamMember.findMany({
    where: { teamId: { in: teamIds }, userId: callerId },
    select: { teamId: true, role: true },
  });
  return new Set(
    memberships
      .filter((m) => m.role === "OWNER" || m.role === "ADMIN")
      .map((m) => m.teamId),
  );
}

/** Fetch bindings for a list of agent IDs. */
async function fetchBindings(agentIds: string[]) {
  if (agentIds.length === 0) return { skillBindings: [], mcpBindings: [] };
  const [skillBindings, mcpBindings] = await Promise.all([
    prisma.agentSkillBinding.findMany({ where: { agentId: { in: agentIds } } }),
    prisma.agentMcpBinding.findMany({ where: { agentId: { in: agentIds } } }),
  ]);
  return { skillBindings, mcpBindings };
}

// -----------------------------------------------------------------------------
// POST — create agent
// -----------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCallerContext(req);
  if (!ctx) return unauthorizedResponse();
  const { callerId, teamIds } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequestResponse("invalid body");
  }
  if (typeof body !== "object" || body === null) {
    return badRequestResponse("invalid body");
  }

  const {
    name: rawName,
    description,
    systemPrompt,
    model,
    scope,
    teamId,
    skillIds,
    mcpServerIds,
  } = body as Record<string, unknown>;

  if (typeof rawName !== "string" || rawName.trim().length === 0) {
    return badRequestResponse("name required");
  }
  const name = rawName.trim();

  const scopeVal = typeof scope === "string" ? scope : "personal";
  if (scopeVal !== "team" && scopeVal !== "personal") {
    return badRequestResponse('scope must be "team" or "personal"');
  }

  if (scopeVal === "team") {
    if (typeof teamId !== "string") {
      return badRequestResponse("teamId required for team-scoped agent");
    }
    if (!teamIds.includes(teamId)) {
      return forbiddenResponse();
    }
    const admin = await isTeamAdmin(teamId, callerId);
    if (!admin) {
      return forbiddenResponse();
    }
  }

  // skillIds and mcpServerIds must be arrays of string if provided
  const skillIdsArr =
    Array.isArray(skillIds) ? (skillIds.filter((id) => typeof id === "string") as string[]) : [];
  const mcpServerIdsArr =
    Array.isArray(mcpServerIds)
      ? (mcpServerIds.filter((id) => typeof id === "string") as string[])
      : [];

  const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        name,
        description: typeof description === "string" ? description : "",
        systemPrompt: typeof systemPrompt === "string" ? systemPrompt : "",
        model: typeof model === "string" ? model : "",
        scope: scopeVal,
        teamId: scopeVal === "team" ? (teamId as string) : null,
        ownerUserId: scopeVal === "personal" ? callerId : null,
      },
    });

    const skillBindings = await Promise.all(
      skillIdsArr.map((skillPackageId) =>
        tx.agentSkillBinding.create({
          data: { agentId: agent.id, skillPackageId, mode: "inherit" },
        }),
      ),
    );

    const mcpBindings = await Promise.all(
      mcpServerIdsArr.map((mcpServerId) =>
        tx.agentMcpBinding.create({
          data: { agentId: agent.id, mcpServerId, mode: "inherit" },
        }),
      ),
    );

    return {
      ...agent,
      skillBindings,
      mcpBindings,
    };
  });

  return NextResponse.json(result, { status: 201 });
}

// -----------------------------------------------------------------------------
// GET — list agents
// -----------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCallerContext(req);
  if (!ctx) return unauthorizedResponse();
  const { callerId, teamIds } = ctx;

  const { searchParams } = new URL(req.url);
  const scopeFilter = searchParams.get("scope") as "team" | "personal" | null;
  const teamIdFilter = searchParams.get("teamId");

  // When teamIdFilter is provided, restrict to that team (and it must be one
  // the caller belongs to). Otherwise include all teams the caller belongs to.
  const teamScopeIds =
    teamIdFilter && teamIds.includes(teamIdFilter) ? [teamIdFilter] : teamIds;

  const teamAgents =
    scopeFilter === "personal" || teamScopeIds.length === 0
      ? []
      : await prisma.agent.findMany({
          where: {
            scope: "team",
            teamId: { in: teamScopeIds },
          },
          take: DEFAULT_LIST_LIMIT,
        });

  // Filter: caller must be OWNER or ADMIN of the team to see its agents.
  // Batch the admin check into a single query (vs N per-agent lookups).
  const adminTeamIds = await getAdminTeamIds(
    teamAgents.map((a) => a.teamId).filter((t): t is string => Boolean(t)),
    callerId,
  );
  const visibleTeamAgents = teamAgents.filter(
    (agent) => agent.teamId != null && adminTeamIds.has(agent.teamId),
  );

  const personalAgents =
    scopeFilter === "team"
      ? []
      : await prisma.agent.findMany({
          where: {
            scope: "personal",
            ownerUserId: callerId,
          },
          take: DEFAULT_LIST_LIMIT,
        });

  const allAgents = [...visibleTeamAgents, ...personalAgents];

  // Fetch bindings in a single batch query
  const agentIds = allAgents.map((a) => a.id);
  const { skillBindings, mcpBindings } = await fetchBindings(agentIds);

  const agents = allAgents.map((agent) => ({
    ...agent,
    skillBindings: skillBindings.filter((b) => b.agentId === agent.id),
    mcpBindings: mcpBindings.filter((b) => b.agentId === agent.id),
  }));

  return NextResponse.json({ agents });
}
