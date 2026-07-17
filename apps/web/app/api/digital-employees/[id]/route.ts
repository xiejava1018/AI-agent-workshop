/**
 * app/api/digital-employees/[id]/route.ts
 *
 * Task 4.1 — Digital Employee CRUD.
 *
 * GET /api/digital-employees/[id] — get single agent with bindings
 * PUT /api/digital-employees/[id] — update agent + replace bindings
 * DELETE /api/digital-employees/[id] — hard delete agent + cascade bindings
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

function notFoundResponse(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
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

async function isTeamAdmin(teamId: string, callerId: string): Promise<boolean> {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: callerId } },
    select: { role: true },
  });
  return membership?.role === "OWNER" || membership?.role === "ADMIN";
}

/** Returns the agent if the caller has permission to access it. */
async function getAccessibleAgent(
  id: string,
  callerId: string,
  teamIds: string[],
) {
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return null;

  if (agent.scope === "personal") {
    return agent.ownerUserId === callerId ? agent : null;
  }

  // team agent: caller must be ADMIN/OWNER of the team
  if (!agent.teamId || !teamIds.includes(agent.teamId)) return null;
  const admin = await isTeamAdmin(agent.teamId, callerId);
  return admin ? agent : null;
}

/** Add bindings to a single agent. */
async function addBindings(agent: Awaited<ReturnType<typeof prisma.agent.findUnique>> & Record<string, unknown>) {
  if (!agent || !("id" in agent)) return agent;
  const agentId = agent.id as string;
  const [skillBindings, mcpBindings] = await Promise.all([
    prisma.agentSkillBinding.findMany({ where: { agentId } }),
    prisma.agentMcpBinding.findMany({ where: { agentId } }),
  ]);
  return { ...agent, skillBindings, mcpBindings };
}

// -----------------------------------------------------------------------------
// GET
// -----------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = await getCallerContext(_req);
  if (!ctx) return unauthorizedResponse();
  const { callerId, teamIds } = ctx;

  const { id } = await params;
  const agent = await getAccessibleAgent(id, callerId, teamIds);
  if (!agent) return notFoundResponse();

  const agentWithBindings = await addBindings(agent);
  return NextResponse.json({ agent: agentWithBindings });
}

// -----------------------------------------------------------------------------
// PUT
// -----------------------------------------------------------------------------

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = await getCallerContext(req);
  if (!ctx) return unauthorizedResponse();
  const { callerId, teamIds } = ctx;

  const { id } = await params;
  const agent = await getAccessibleAgent(id, callerId, teamIds);
  if (!agent) return notFoundResponse();

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
    description,
    systemPrompt,
    model,
    skillIds,
    mcpServerIds,
  } = body as Record<string, unknown>;

  const skillIdsArr =
    Array.isArray(skillIds) ? (skillIds.filter((id) => typeof id === "string") as string[]) : [];
  const mcpServerIdsArr =
    Array.isArray(mcpServerIds)
      ? (mcpServerIds.filter((id) => typeof id === "string") as string[])
      : [];

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.agent.update({
      where: { id },
      data: {
        ...(typeof name === "string" && name.trim().length > 0 ? { name: name.trim() } : {}),
        ...(typeof description === "string" ? { description } : {}),
        ...(typeof systemPrompt === "string" ? { systemPrompt } : {}),
        ...(typeof model === "string" ? { model } : {}),
      },
    });

    // Replace skill bindings
    await tx.agentSkillBinding.deleteMany({ where: { agentId: id } });
    const skillBindings = await Promise.all(
      skillIdsArr.map((skillPackageId) =>
        tx.agentSkillBinding.create({
          data: { agentId: id, skillPackageId, mode: "inherit" },
        }),
      ),
    );

    // Replace MCP bindings
    await tx.agentMcpBinding.deleteMany({ where: { agentId: id } });
    const mcpBindings = await Promise.all(
      mcpServerIdsArr.map((mcpServerId) =>
        tx.agentMcpBinding.create({
          data: { agentId: id, mcpServerId, mode: "inherit" },
        }),
      ),
    );

    return { ...updated, skillBindings, mcpBindings };
  });

  return NextResponse.json({ agent: result });
}

// -----------------------------------------------------------------------------
// DELETE
// -----------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = await getCallerContext(_req);
  if (!ctx) return unauthorizedResponse();
  const { callerId, teamIds } = ctx;

  const { id } = await params;
  const agent = await getAccessibleAgent(id, callerId, teamIds);
  if (!agent) return notFoundResponse();

  await prisma.$transaction(async (tx) => {
    // Cascade delete bindings first (no FK constraints, but explicit is cleaner)
    await tx.agentSkillBinding.deleteMany({ where: { agentId: id } });
    await tx.agentMcpBinding.deleteMany({ where: { agentId: id } });
    await tx.agent.delete({ where: { id } });
  });

  return new NextResponse(null, { status: 204 });
}
