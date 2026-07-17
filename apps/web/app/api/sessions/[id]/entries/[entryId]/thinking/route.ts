import { NextResponse } from "next/server";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import { getSessionMeta } from "@/lib/session-meta";
import { assertCanReadSessionScoped } from "@/lib/team-auth";
import { getUserHighestRole } from "@/lib/user-role";
import { auditLog } from "@/lib/audit-log";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;

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
        path: "/api/sessions/[id]/entries/[entryId]/thinking",
        reason: decision.reason,
        sessionTeamId: meta?.teamId ?? null,
        sessionOwnerId: meta?.userId ?? null,
      },
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
  const blockIndex = blockIndexParam === null ? Number.NaN : Number(blockIndexParam);
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
    return NextResponse.json({ error: "Valid blockIndex is required" }, { status: 400 });
  }

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    // SessionManager-backed parsing preserves the SDK's malformed-line tolerance.
    const entry = getSessionEntries(filePath).find((candidate) => candidate.id === entryId);
    if (!entry || entry.type !== "message" || entry.message.role !== "assistant") {
      return NextResponse.json({ error: "Assistant message not found" }, { status: 404 });
    }

    const block = entry.message.content[blockIndex];
    if (!block || block.type !== "thinking") {
      return NextResponse.json({ error: "Thinking block not found" }, { status: 404 });
    }

    return NextResponse.json({ thinking: block.thinking });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
