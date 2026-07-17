/**
 * app/api/admin/mcp/[id]/route.ts
 *
 * Task 4.5 — MCP Server CRUD (admin-only), single-record operations.
 *
 * GET    /api/admin/mcp/[id]        — single server, configEnc stripped
 * PUT    /api/admin/mcp/[id]        — update fields (OWNER-only)
 * DELETE /api/admin/mcp/[id]        — hard delete + cascade bindings (OWNER-only)
 *
 * `configEnc` is NEVER present in any response body. On PUT, a `configEnc`
 * value in the request body replaces the stored ciphertext (it is opaque
 * AES-256-GCM ciphertext produced client-side; stored verbatim).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertPlatformAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const VALID_SCOPES = ["global", "team", "user"] as const;
type McpScope = (typeof VALID_SCOPES)[number];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}

function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function notFoundResponse(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

function badRequestResponse(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/** Strip the encrypted config before returning a row. */
function stripConfig<T extends { configEnc?: string }>(server: T): Omit<T, "configEnc"> {
  const rest: Omit<T, "configEnc"> = { ...server } as Omit<T, "configEnc">;
  delete (rest as { configEnc?: string }).configEnc;
  return rest;
}

/** Read access: platform admin (platform:access) via assertPlatformAdmin. */
async function readGate(req: NextRequest): Promise<{ ok: true } | { authed: boolean }> {
  const admin = await assertPlatformAdmin(req);
  if (admin) return { ok: true };
  return { authed: Boolean(req.headers.get("x-user-id")) };
}

/** Write access: platform admin only (同 readGate,统一语义)。 */
async function ownerGate(req: NextRequest): Promise<{ ok: true; userId: string } | { authed: boolean }> {
  const admin = await assertPlatformAdmin(req);
  if (admin) return { ok: true, userId: admin.userId };
  return { authed: Boolean(req.headers.get("x-user-id")) };
}

function isMcpScope(v: unknown): v is McpScope {
  return typeof v === "string" && (VALID_SCOPES as readonly string[]).includes(v);
}

// -----------------------------------------------------------------------------
// GET
// -----------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await readGate(req);
  if (!("ok" in gate)) {
    return gate.authed ? forbiddenResponse() : unauthorizedResponse();
  }

  const { id } = await params;
  const server = await prisma.mcpServer.findUnique({ where: { id } });
  if (!server) return notFoundResponse();

  return NextResponse.json({ server: stripConfig(server) });
}

// -----------------------------------------------------------------------------
// PUT
// -----------------------------------------------------------------------------

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await ownerGate(req);
  if (!("ok" in gate)) {
    return gate.authed ? forbiddenResponse() : unauthorizedResponse();
  }

  const { id } = await params;
  const existing = await prisma.mcpServer.findUnique({ where: { id } });
  if (!existing) return notFoundResponse();

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
    name,
    transport,
    endpoint,
    command,
    configEnc,
    scope,
    teamId,
    userId,
    enabled,
  } = body as Record<string, unknown>;

  if (scope !== undefined && !isMcpScope(scope)) {
    return badRequestResponse('scope must be "global" | "team" | "user"');
  }

  // Resolve the effective scope so teamId/userId are kept consistent.
  const effectiveScope = scope ?? existing.scope;
  if (effectiveScope === "team") {
    const effectiveTeamId = teamId !== undefined ? teamId : existing.teamId;
    if (typeof effectiveTeamId !== "string" || effectiveTeamId.trim().length === 0) {
      return badRequestResponse("teamId required for team-scoped MCP server");
    }
  } else if (effectiveScope === "user") {
    const effectiveUserId = userId !== undefined ? userId : existing.userId;
    if (typeof effectiveUserId !== "string" || effectiveUserId.trim().length === 0) {
      return badRequestResponse("userId required for user-scoped MCP server");
    }
  }

  const updated = await prisma.mcpServer.update({
    where: { id },
    data: {
      ...(typeof name === "string" && name.trim().length > 0 ? { name: name.trim() } : {}),
      ...(typeof transport === "string" ? { transport } : {}),
      ...(typeof endpoint === "string" ? { endpoint } : {}),
      ...(typeof command === "string" ? { command } : {}),
      // configEnc present in the body ⇒ admin is setting a NEW config. Store
      // the opaque ciphertext verbatim; an empty string clears the config.
      ...(typeof configEnc === "string" ? { configEnc } : {}),
      ...(scope !== undefined ? { scope } : {}),
      // Keep teamId/userId consistent with the scope on update.
      ...(scope !== undefined
        ? {
            teamId: scope === "team" ? ((teamId as string) ?? existing.teamId) : null,
            userId: scope === "user" ? ((userId as string) ?? existing.userId) : null,
          }
        : {}),
      ...(typeof enabled === "boolean" ? { enabled } : {}),
    },
  });

  return NextResponse.json({ server: stripConfig(updated) });
}

// -----------------------------------------------------------------------------
// DELETE
// -----------------------------------------------------------------------------

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await ownerGate(req);
  if (!("ok" in gate)) {
    return gate.authed ? forbiddenResponse() : unauthorizedResponse();
  }

  const { id } = await params;
  const existing = await prisma.mcpServer.findUnique({ where: { id } });
  if (!existing) return notFoundResponse();

  await prisma.$transaction(async (tx) => {
    // Cascade: drop every agent binding pointing at this server first, then
    // remove the server. Explicit even though AgentMcpBinding has no FK.
    await tx.agentMcpBinding.deleteMany({ where: { mcpServerId: id } });
    await tx.mcpServer.delete({ where: { id } });
  });

  return new NextResponse(null, { status: 204 });
}
