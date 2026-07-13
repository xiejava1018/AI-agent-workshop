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
    //   3. Shared: M2.4 placeholder, always false (session_shares table empty in M2.2)
    //
    // Note: listSessionMeta() returns rows without the session id (id is the map
    // key), so we use getSessionMeta(id) per session from listAllSessions().
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

      // (3) Shared placeholder — M2.4 will check session_shares table.
      // For M2.2 the table is empty, so this branch never matches.
    }

    return NextResponse.json({
      sessions: visibleSessions,
      runningSessionIds: getRunningRpcSessionIds(),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}