// GET /api/dashboard/stats
// Returns aggregate workspace statistics for the dashboard frontend.
// Mirrors the contract expected by apps/dashboard/src/api/workspace.ts.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  try {
    const [userCount, teamCount, sessionCount, agentCount, projectCount] =
      await Promise.all([
        prisma.user.count(),
        prisma.team.count(),
        prisma.session.count(),
        prisma.agent.count(),
        prisma.project.count(),
      ]);

    const recentSessions = await prisma.session.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        userId: true,
        teamId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      users: userCount,
      teams: teamCount,
      sessions: sessionCount,
      agents: agentCount,
      projects: projectCount,
      recentSessions,
    });
  } catch (error) {
    console.error("[dashboard/stats] error:", error);
    return NextResponse.json(
      { error: "Failed to load stats" },
      { status: 500 }
    );
  }
}
