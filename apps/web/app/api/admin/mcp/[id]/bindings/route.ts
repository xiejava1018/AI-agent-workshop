/**
 * app/api/admin/mcp/[id]/bindings/route.ts
 *
 * Task 4.5 — MCP Server CRUD: agent-to-MCP binding management.
 *
 * PATCH /api/admin/mcp/[id]/bindings
 *   - OWNER-only. Replace ALL AgentMcpBinding rows for this McpServer.
 *   - Body: { bindings: [{ agentId, mode: "inherit" | "include" | "exclude" }] }
 *   - Returns the resulting bindings for the server.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserHighestRole } from "@/lib/user-role";

export const dynamic = "force-dynamic";

const VALID_MODES = ["inherit", "include", "exclude"] as const;
type BindingMode = (typeof VALID_MODES)[number];

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

async function ownerGate(req: NextRequest): Promise<{ ok: true; userId: string } | { authed: boolean }> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return { authed: false };
  const role = await getUserHighestRole(userId);
  if (role !== "OWNER") return { authed: true };
  return { ok: true, userId };
}

function isBindingMode(v: unknown): v is BindingMode {
  return typeof v === "string" && (VALID_MODES as readonly string[]).includes(v);
}

// -----------------------------------------------------------------------------
// PATCH
// -----------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await ownerGate(req);
  if (!("ok" in gate)) {
    return gate.authed ? forbiddenResponse() : unauthorizedResponse();
  }

  const { id } = await params;
  const server = await prisma.mcpServer.findUnique({ where: { id } });
  if (!server) return notFoundResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequestResponse("invalid body");
  }
  if (typeof body !== "object" || body === null) {
    return badRequestResponse("invalid body");
  }

  const { bindings: rawBindings } = body as { bindings?: unknown };
  if (!Array.isArray(rawBindings)) {
    return badRequestResponse("bindings must be an array");
  }

  // Validate and normalize each binding entry.
  const normalized: Array<{ agentId: string; mode: BindingMode }> = [];
  const seen = new Set<string>();
  for (const entry of rawBindings) {
    if (typeof entry !== "object" || entry === null) {
      return badRequestResponse("invalid binding entry");
    }
    const { agentId, mode } = entry as { agentId?: unknown; mode?: unknown };
    if (typeof agentId !== "string" || agentId.trim().length === 0) {
      return badRequestResponse("binding agentId required");
    }
    const effectiveMode = isBindingMode(mode) ? mode : "inherit";
    if (seen.has(agentId)) {
      // De-dupe: keep the last occurrence by overwriting the prior entry.
      const idx = normalized.findIndex((n) => n.agentId === agentId);
      if (idx >= 0) normalized[idx] = { agentId, mode: effectiveMode };
      else normalized.push({ agentId, mode: effectiveMode });
    } else {
      seen.add(agentId);
      normalized.push({ agentId, mode: effectiveMode });
    }
  }

  // Replace-all inside a single transaction so we never end up with a
  // partially-applied binding set.
  const result = await prisma.$transaction(async (tx) => {
    await tx.agentMcpBinding.deleteMany({ where: { mcpServerId: id } });
    const created = await Promise.all(
      normalized.map((b) =>
        tx.agentMcpBinding.create({
          data: { agentId: b.agentId, mcpServerId: id, mode: b.mode },
        }),
      ),
    );
    return created;
  });

  return NextResponse.json({ bindings: result });
}
