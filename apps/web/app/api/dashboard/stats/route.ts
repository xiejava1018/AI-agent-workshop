// GET /api/dashboard/stats
// Aggregate workspace statistics for the dashboard frontend
// (apps/dashboard/src/api/workspace.ts).
//
// Data sources:
//   - sessions: the caller's own JSONL sessions (listAllSessions + meta.userId),
//     NOT the Prisma Session model - that table is never written in this app,
//     so counting it always returned 0. "tokens" has no reliable source today
//     (tokenUsage is never populated), so the card reports 0 instead of a
//     fabricated number.
//   - agents / skills / projects: Prisma counts (Agent / SkillPackage / Project).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { listAllSessions } from "@/lib/session-reader";
import { getSessionMeta } from "@/lib/session-meta";
import { getUserTeamIds } from "@/lib/server-user";

export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  try {
    // Sessions are filesystem-backed (JSONL). Count only the caller's own
    // sessions by matching the per-session metadata userId.
    const allSessions = await listAllSessions();
    const ownSessions = allSessions.filter((s) => {
      const meta = getSessionMeta(s.id);
      return meta?.userId === userId;
    });

    const [agents, skills, teamIds] = await Promise.all([
      prisma.agent.count(),
      prisma.skillPackage.count({ where: { enabled: true } }),
      getUserTeamIds(userId),
    ]);
    const projects = await prisma.project.count({
      where: { teamId: { in: teamIds } },
    });

    return NextResponse.json({
      sessions: ownSessions.length,
      tokens: 0,
      agents,
      skills,
      projects,
    });
  } catch (error) {
    console.error("[dashboard/stats] error:", error);
    return NextResponse.json(
      { error: "Failed to load stats" },
      { status: 500 }
    );
  }
}
