import { NextResponse } from "next/server";
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  buildSessionContext,
  readSessionHeader,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { getSessionMeta } from "@/lib/session-meta";
import { setPinned, clearPinned, isPinned } from "@/lib/session-prefs";
import { assertCanReadSessionScoped, assertCanReadSessionBody } from "@/lib/team-auth";
import { getUserHighestRole } from "@/lib/user-role";
import { auditLog } from "@/lib/audit-log";

// BranchNavigator still traverses recursively, so keep the response tree shallow.
const MAX_PROJECTED_TREE_DEPTH = 200;

/**
 * Project the session tree into the shallow navigation tree sent to the client.
 * Keeps roots, branch points, and leaves while contracting single-child chains
 * without recursive traversal. Contracted entry IDs are attached to the next
 * visible node so the UI can still recognize an active leaf inside the chain.
 */
function projectTreeForResponse<T extends { entry: { id: string }; children: T[]; compressedEntryIds?: string[] }>(
  nodes: T[]
): T[] {
  const keep = new Set<T>();
  const roots = new Set(nodes);
  const seen = new Set<T>();
  const stack = [...nodes];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);

    if (
      roots.has(node) ||
      node.children.length !== 1
    ) {
      keep.add(node);
    }

    for (const child of node.children) {
      stack.push(child);
    }
  }

  const cloneNode = (node: T, compressedEntryIds?: string[]): T => ({
    ...node,
    children: [],
    ...(compressedEntryIds?.length ? { compressedEntryIds } : {}),
  });
  const projectedRoots = nodes.map((node) => cloneNode(node));
  const tasks = nodes.map((source, index) => ({
    source,
    projected: projectedRoots[index],
    depth: 1,
  }));

  const appendFlattenedKeptDescendants = (source: T, projectedParent: T) => {
    const pending = [{ node: source, compressedEntryIds: [] as string[] }];
    const flattenedSeen = new Set<T>();

    while (pending.length > 0) {
      const { node, compressedEntryIds } = pending.pop()!;
      if (flattenedSeen.has(node)) continue;
      flattenedSeen.add(node);

      if (keep.has(node)) {
        projectedParent.children.push(cloneNode(node, compressedEntryIds));
      }

      for (let i = node.children.length - 1; i >= 0; i--) {
        pending.push({
          node: node.children[i],
          compressedEntryIds: keep.has(node)
            ? []
            : [...compressedEntryIds, node.entry.id],
        });
      }
    }
  };

  while (tasks.length > 0) {
    const { source, projected, depth } = tasks.pop()!;

    for (const sourceChild of source.children) {
      let child = sourceChild;

      if (depth >= MAX_PROJECTED_TREE_DEPTH) {
        appendFlattenedKeptDescendants(child, projected);
        continue;
      }

      const compressedEntryIds: string[] = [];
      while (!keep.has(child) && child.children.length === 1) {
        compressedEntryIds.push(child.entry.id);
        child = child.children[0];
      }

      if (!keep.has(child)) {
        continue;
      }

      const projectedChild = cloneNode(child, compressedEntryIds);
      projected.children.push(projectedChild);
      tasks.push({ source: child, projected: projectedChild, depth: depth + 1 });
    }
  }

  return projectedRoots;
}

/**
 * T7.2 tenant-context enforcement: verify the caller has permission to read
 * the session via team-scoped authorization (matching the agent routes).
 *
 * T7.3: when `body=true`, uses assertCanReadSessionBody which only allows
 * the session owner and team OWNER/ADMIN (not MEMBER or shared-with).
 * The audit action distinguishes body-access-denied from metadata-access-denied.
 */
async function assertCanReadSession(
  req: Request,
  sessionId: string,
  options: { body: boolean } = { body: false },
): Promise<{ allowed: true; userId: string } | Response> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const userRole = await getUserHighestRole(userId);
  const meta = getSessionMeta(sessionId);

  if (options.body) {
    const decision = await assertCanReadSessionBody(userId, userRole, meta, sessionId);
    if (!decision.allowed) {
      const action = decision.reason === "body_access_denied"
        ? "session.body_access_denied"
        : "session.access_denied";
      void auditLog({
        userId,
        action,
        resourceType: "session",
        resourceId: sessionId,
        metadata: {
          path: "/api/sessions/[id]",
          reason: decision.reason,
          sessionTeamId: meta?.teamId ?? null,
          sessionOwnerId: meta?.userId ?? null,
        },
      });
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else {
    const decision = await assertCanReadSessionScoped(userId, userRole, meta, sessionId);
    if (!decision.allowed) {
      void auditLog({
        userId,
        action: "session.access_denied",
        resourceType: "session",
        resourceId: sessionId,
        metadata: {
          path: "/api/sessions/[id]",
          reason: decision.reason,
          sessionTeamId: meta?.teamId ?? null,
          sessionOwnerId: meta?.userId ?? null,
        },
      });
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  return { allowed: true as const, userId };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await assertCanReadSession(req, id, { body: true });
  if (auth instanceof Response) return auth;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = SessionManager.open(filePath);
    const entries = sm.getEntries() as never;
    const leafId = sm.getLeafId();
    const tree = projectTreeForResponse(sm.getTree());
    const searchParams = new URL(req.url).searchParams;
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const context = buildSessionContext(entries, leafId, { deferThinking, deferToolResultImages });

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const info = header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: sm.getSessionName(),
      created: header.timestamp,
      modified,
      messageCount: context.messages.length,
      firstMessage: context.messages.find((m) => m.role === "user")
        ? (() => {
            const msg = context.messages.find((m) => m.role === "user")!;
            const c = (msg as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
      pinned: isPinned(id),
    } : null;

    return NextResponse.json({
      sessionId: id,
      filePath,
      info,
      leafId,
      tree,
      context,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name?: string, pinned?: boolean }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await assertCanReadSession(req, id);
  if (auth instanceof Response) return auth;

  try {
    const body = await req.json() as { name?: unknown; pinned?: unknown };

    // Pin toggle is a pure-prefs operation — no need to touch the .jsonl.
    if (typeof body.pinned === "boolean") {
      const applied = await setPinned(id, body.pinned);
      return NextResponse.json({ ok: true, pinned: applied });
    }

    if (typeof body.name !== "string") {
      return NextResponse.json(
        { error: "name (string) or pinned (boolean) is required" },
        { status: 400 },
      );
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(body.name.trim());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await assertCanReadSession(req, id);
  if (auth instanceof Response) return auth;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Read only the bounded header before deleting.
    const parentSessionPath = readSessionHeader(filePath)?.parentSession;

    // Re-attach all direct children to this session's parent (cascade re-parent)
    // Scan sibling files in the same directory
    const dir = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && join(dir, f) !== filePath);
      for (const file of files) {
        const childPath = join(dir, file);
        try {
          const content = readFileSync(childPath, "utf8");
          const lines = content.split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
          if (header.type === "session" && header.parentSession === filePath) {
            // Rewrite header with new parentSession
            header.parentSession = parentSessionPath;
            lines[0] = JSON.stringify(header);
            writeFileSync(childPath, lines.join("\n"));
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* skip if dir unreadable */ }

    getRpcSession(id)?.destroy();
    unlinkSync(filePath);
    invalidateSessionPathCache(id);
    // Drop any pin record so the prefs file doesn't accumulate dead ids.
    clearPinned(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
