import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { getSessionMeta } from "@/lib/session-meta";
import { assertCanReadSessionScoped } from "@/lib/team-auth";
import { getUserHighestRole } from "@/lib/user-role";
import { auditLog } from "@/lib/audit-log";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // T7.2: enforce tenant context — team-scoped session read authorization.
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const userRole = await getUserHighestRole(userId);
  const meta = getSessionMeta(id);
  const decision = await assertCanReadSessionScoped(userId, userRole, meta, id);
  if (!decision.allowed) {
    void auditLog({
      userId,
      action: "session.access_denied",
      resourceType: "session",
      resourceId: id,
      metadata: {
        path: "/api/sessions/[id]/state",
        reason: decision.reason,
        sessionTeamId: meta?.teamId ?? null,
        sessionOwnerId: meta?.userId ?? null,
      },
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    if (!await resolveSessionPath(id)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const rpc = getRpcSession(id);
    if (!rpc?.isAlive()) return NextResponse.json({ running: false });

    const state = await rpc.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
