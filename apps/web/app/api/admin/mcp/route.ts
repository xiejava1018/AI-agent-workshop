/**
 * app/api/admin/mcp/route.ts
 *
 * Task 4.5 — MCP Server CRUD (admin-only).
 *
 * POST /api/admin/mcp
 *   - Gated to platform admin (OWNER role). Creates a new McpServer.
 *   - Body: { name, transport?, endpoint?, command?, configEnc?,
 *             scope: "global"|"team"|"user", teamId?, userId?, enabled? }
 *   - `configEnc` is opaque AES-256-GCM ciphertext produced client-side; we
 *     store it verbatim. It is NEVER returned in any response.
 *
 * GET /api/admin/mcp
 *   - Admin-only (OWNER or ADMIN via assertIsAdmin). Returns all MCP servers.
 *   - Query params: scope?, teamId? for filtering.
 *   - ALWAYS strips `configEnc` from every row in the response.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertIsAdmin } from "@/lib/server-user";
import { getUserHighestRole } from "@/lib/user-role";

export const dynamic = "force-dynamic";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const VALID_SCOPES = ["global", "team", "user"] as const;
type McpScope = (typeof VALID_SCOPES)[number];

/** Cap on GET list queries to prevent unbounded result sets. */
const DEFAULT_LIST_LIMIT = 100;

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

/**
 * Gate write operations to platform admin (OWNER role only). The task spec
 * restricts create/update/delete of MCP servers to the platform admin.
 *
 * SECURITY: role is derived from the database via `getUserHighestRole` — the
 * `x-user-role` request header is never trusted.
 *
 * Returns `{ ok: true, userId }` when the caller is OWNER, `{ ok: false,
 * authed: true }` when authenticated-but-not-owner (→ 403), and `{ ok: false,
 * authed: false }` when no auth header is present (→ 401).
 */
async function checkOwner(req: NextRequest): Promise<
  { ok: true; userId: string } | { ok: false; authed: boolean }
> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return { ok: false, authed: false };
  const role = await getUserHighestRole(userId);
  if (role !== "OWNER") return { ok: false, authed: true };
  return { ok: true, userId };
}

function isMcpScope(v: unknown): v is McpScope {
  return typeof v === "string" && (VALID_SCOPES as readonly string[]).includes(v);
}

/**
 * Strip the encrypted config from a server row before returning it. This is
 * the credential-isolation guarantee: `configEnc` NEVER leaves the server.
 */
function stripConfig<T extends { configEnc?: string }>(server: T): Omit<T, "configEnc"> {
  const rest: Omit<T, "configEnc"> = { ...server } as Omit<T, "configEnc">;
  delete (rest as { configEnc?: string }).configEnc;
  return rest;
}

// -----------------------------------------------------------------------------
// POST — create MCP server
// -----------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const owner = await checkOwner(req);
  if (!owner.ok) {
    return owner.authed ? forbiddenResponse() : unauthorizedResponse();
  }

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
    transport,
    endpoint,
    command,
    configEnc,
    scope: rawScope,
    teamId,
    userId,
    enabled,
  } = body as Record<string, unknown>;

  if (typeof rawName !== "string" || rawName.trim().length === 0) {
    return badRequestResponse("name required");
  }
  const name = rawName.trim();

  if (!isMcpScope(rawScope)) {
    return badRequestResponse('scope must be "global" | "team" | "user"');
  }
  const scope = rawScope;

  // Scope-specific ownership validation.
  if (scope === "team") {
    if (typeof teamId !== "string" || teamId.trim().length === 0) {
      return badRequestResponse("teamId required for team-scoped MCP server");
    }
  } else if (scope === "user") {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return badRequestResponse("userId required for user-scoped MCP server");
    }
  }

  const created = await prisma.mcpServer.create({
    data: {
      name,
      transport: typeof transport === "string" ? transport : "stdio",
      endpoint: typeof endpoint === "string" ? endpoint : "",
      command: typeof command === "string" ? command : "",
      // configEnc is opaque ciphertext from the client; store verbatim.
      configEnc: typeof configEnc === "string" ? configEnc : "",
      scope,
      teamId: scope === "team" ? (teamId as string) : null,
      userId: scope === "user" ? (userId as string) : null,
      enabled: typeof enabled === "boolean" ? enabled : true,
    },
  });

  return NextResponse.json({ server: stripConfig(created) }, { status: 201 });
}

// -----------------------------------------------------------------------------
// GET — list MCP servers
// -----------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await assertIsAdmin(req);
  if (!admin) {
    if (!req.headers.get("x-user-id")) return unauthorizedResponse();
    return forbiddenResponse();
  }

  const { searchParams } = new URL(req.url);
  const scopeFilter = searchParams.get("scope");
  const teamIdFilter = searchParams.get("teamId");

  // Build the where clause from optional filters; never accept unbounded queries.
  const where: Record<string, unknown> = {};
  if (scopeFilter && isMcpScope(scopeFilter)) {
    where.scope = scopeFilter;
  }
  if (teamIdFilter) {
    where.teamId = teamIdFilter;
  }

  const servers = await prisma.mcpServer.findMany({
    where,
    take: DEFAULT_LIST_LIMIT,
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ servers: servers.map(stripConfig) });
}
