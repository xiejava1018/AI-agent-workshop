import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionMeta } from "@/lib/session-meta";
import { assertCanReadSessionScoped, assertMemberOfTeam } from "@/lib/team-auth";
import { auditLog } from "@/lib/audit-log";
import { getUserHighestRole } from "@/lib/user-role";
import { enforceNotMustChange } from "@/lib/must-change-password";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });

  // The caller must own the session OR be an OWNER/ADMIN in the session's
  // team. This matches the spirit of assertCanReadSessionScoped's
  // "owner" + "team_member" reasons but adds a stricter check: even
  // shared readers cannot share a session with another user (that
  // would let a low-trust account amplify access). isSessionSharedWith
  // is the only path that does NOT allow re-sharing.
  const meta = getSessionMeta(id);
  const decision = await assertCanReadSessionScoped(
    userId,
    await getUserHighestRole(userId),
    meta,
    id
  );
  if (!decision.allowed || (decision.reason !== "owner" && decision.reason !== "team_member")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { sharedWithUserId } = body as { sharedWithUserId?: string };
  if (typeof sharedWithUserId !== "string" || sharedWithUserId.length === 0) {
    return NextResponse.json({ error: "sharedWithUserId required" }, { status: 400 });
  }
  if (sharedWithUserId === userId) {
    return NextResponse.json({ error: "cannot share with yourself" }, { status: 400 });
  }

  // The target user must exist.
  const target = await prisma.user.findUnique({
    where: { id: sharedWithUserId },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "target user not found" }, { status: 404 });
  }

  // The session must have a known teamId (deny-by-default for unscoped
  // sessions — see lib/team-auth.ts).
  if (!meta?.teamId) {
    return NextResponse.json({ error: "session is not team-scoped" }, { status: 400 });
  }

  // The target user must be in some team. Sharing with a team-less
  // user is allowed (they become a shared-only reader), but we record
  // it explicitly so the audit log captures the boundary case.
  const targetInSameTeam = await assertMemberOfTeam(sharedWithUserId, meta.teamId);
  const targetHasAnyTeam = (await prisma.teamMember.count({ where: { userId: sharedWithUserId } })) > 0;

  try {
    await prisma.sessionShare.create({
      data: { sessionId: id, sharedWithUserId },
    });
  } catch (err) {
    // Unique constraint violation → already shared. Idempotent 200.
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      return NextResponse.json({ ok: true, alreadyShared: true });
    }
    throw err;
  }

  await auditLog({
    userId,
    action: "session.share_create",
    resourceType: "session",
    resourceId: id,
    metadata: {
      sharedWithUserId,
      sessionTeamId: meta.teamId,
      targetInSameTeam,
      targetHasAnyTeam,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });

  // Same gating as POST: only owner + team admin/member can unshare.
  const meta = getSessionMeta(id);
  const decision = await assertCanReadSessionScoped(
    userId,
    await getUserHighestRole(userId),
    meta,
    id
  );
  if (!decision.allowed || (decision.reason !== "owner" && decision.reason !== "team_member")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const sharedWithUserId = searchParams.get("sharedWithUserId");
  if (!sharedWithUserId) {
    return NextResponse.json({ error: "sharedWithUserId required" }, { status: 400 });
  }

  await prisma.sessionShare.deleteMany({
    where: { sessionId: id, sharedWithUserId },
  });

  await auditLog({
    userId,
    action: "session.share_delete",
    resourceType: "session",
    resourceId: id,
    metadata: { sharedWithUserId },
  });

  return NextResponse.json({ ok: true });
}