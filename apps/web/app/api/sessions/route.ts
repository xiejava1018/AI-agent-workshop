import { NextRequest, NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";
import { prisma } from "@/lib/prisma";
import { getUserTeamIds } from "@/lib/server-user";
import { getSessionMeta } from "@/lib/session-meta";

export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }

    // Build user context: teamIds + isAdmin
    const [teamIds, memberships] = await Promise.all([
      getUserTeamIds(userId),
      prisma.teamMember.findMany({
        where: { userId },
        select: { role: true },
      }),
    ]);
    const isAdmin = memberships.some(
      (m) => m.role === "OWNER" || m.role === "ADMIN"
    );

    // Load all sessions (M1 list pattern — JSONL scan)
    const sessions = await listAllSessions();

    // 3-way union filter per spec session-visibility-filter:
    //   1. Self: meta.userId === userId
    //   2. Team admin: isAdmin AND project.teamId in user's teamIds
    //   3. Shared: a SessionShare row exists for this (session, user)
    //
    // Note: listSessionMeta() returns rows without the session id (id is the map
    // key), so we use getSessionMeta(id) per session from listAllSessions().
    //
    // Performance: load all SessionShare rows for the user ONCE, instead
    // of per-session. The session-id column is part of the composite PK
    // (sessionId, sharedWithUserId), so the query is cheap.
    const sharedRows = await prisma.sessionShare.findMany({
      where: { sharedWithUserId: userId },
      select: { sessionId: true },
    });
    const sharedSessionIds = new Set(sharedRows.map((r) => r.sessionId));

    const visibleSessions = [];
    for (const session of sessions) {
      const meta = getSessionMeta(session.id);
      if (!meta) continue;

      // (1) Self
      if (meta.userId === userId) {
        visibleSessions.push(session);
        continue;
      }

      // (2) Team admin — only when isAdmin AND projectId is set
      if (isAdmin && meta.projectId) {
        const project = await prisma.project.findUnique({
          where: { id: meta.projectId },
          select: { teamId: true },
        });
        if (project && teamIds.includes(project.teamId)) {
          visibleSessions.push(session);
          continue;
        }
      }

      // (3) Shared — any explicit SessionShare row grants visibility.
      // M2.4 implementation: SessionShare table was previously empty so
      // this branch never matched. Now the user can be added to other
      // users' sessions via /api/agent/[id]/share.
      if (sharedSessionIds.has(session.id)) {
        visibleSessions.push(session);
        continue;
      }
    }

    return NextResponse.json({
      sessions: visibleSessions,
      runningSessionIds: getRunningRpcSessionIds(),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}