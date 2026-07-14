declare global {
  var __piSessionMeta: Map<string, SessionMetaRow> | undefined;
}

export type SessionMetaRow = {
  userId: string | null;
  projectId: string | null;
  // M2.4: teamId is set at session creation time from the project the
  // session belongs to. It is the authoritative scope for authorization
  // decisions — see lib/team-auth.ts. `null` means "unknown scope"
  // (session predates M2.4, or rebuildFromJsonl could not resolve it)
  // and is treated as deny-by-default by assertCanReadSession.
  teamId: string | null;
  createdAt: number;
};

function getMetaMap(): Map<string, SessionMetaRow> {
  if (!globalThis.__piSessionMeta) {
    globalThis.__piSessionMeta = new Map();
    // Lazy trigger: scan filesystem on first access (M1 pattern).
    // rebuildFromJsonl is sync-via-await; we fire-and-forget the promise
    // and return the empty map immediately. First getSessionMeta/listSessionMeta
    // call will see empty; subsequent calls (after the async scan) will see
    // populated data. Acceptable trade-off for M2.2 — no instrumentation.ts
    // hook needed (fork already does lazy init in getMetaMap).
    void rebuildFromJsonl(globalThis.__piSessionMeta);
  }
  return globalThis.__piSessionMeta;
}

// M2.2 real implementation: walk <PI_WEB_DATA_DIR>/**/*.jsonl and
// extract session metadata from each file's first line. Per M1 spec
// "Server 启动扫描标 userId = null" degradation rule: sessions
// without a parseable first line get userId=null (anonymous).
export async function rebuildFromJsonl(map: Map<string, SessionMetaRow>): Promise<void> {
  // Lazy require — only loaded when actual filesystem scan runs.
  // This avoids a top-level import of node:fs in edge runtime contexts
  // (defensive; the lazy getMetaMap() call only happens in nodejs runtime).
  const { readdir, readFile } = await import("fs/promises");
  const { join } = await import("path");

  const dataDir = process.env.PI_WEB_DATA_DIR || "./data";

  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return out; // dir not readable; treat as empty
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip noise directories
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        out.push(...(await walk(fullPath)));
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
    return out;
  }

  const files = await walk(dataDir);
  // M2.4: backfill teamId from Project for sessions whose .jsonl predates
  // the teamId field. We do one bulk query for all distinct projectIds
  // (instead of per-file) so the rebuild stays O(files + projects) not
  // O(files × projects).
  const projectToTeam = new Map<string, string>();
  try {
    const { prisma } = await import("./prisma");
    const projects = await prisma.project.findMany({
      select: { id: true, teamId: true },
    });
    for (const p of projects) projectToTeam.set(p.id, p.teamId);
  } catch {
    // DB unavailable during rebuild (e.g. before bootstrap): teamId stays
    // null for all sessions, which the auth layer treats as deny.
  }

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    // Session id = filename basename without .jsonl extension
    const parts = file.split("/");
    const fname = parts[parts.length - 1];
    const sessionId = fname.endsWith(".jsonl") ? fname.slice(0, -6) : fname;

    let userId: string | null = null;
    let projectId: string | null = null;
    try {
      const content = await readFile(file, "utf-8");
      const firstLine = content.split("\n")[0];
      if (firstLine) {
        const parsed = JSON.parse(firstLine);
        if (typeof parsed.userId === "string") userId = parsed.userId;
        if (typeof parsed.projectId === "string") projectId = parsed.projectId;
      }
    } catch {
      // Parse failure → userId=null, projectId=null (M1 spec degradation)
    }

    // M2.4: prefer the teamId embedded in the .jsonl header (new sessions
    // after M2.4 write it). Fall back to Project lookup for old sessions.
    let teamId: string | null = null;
    try {
      const content = await readFile(file, "utf-8");
      const firstLine = content.split("\n")[0];
      if (firstLine) {
        const parsed = JSON.parse(firstLine);
        if (typeof parsed.teamId === "string") teamId = parsed.teamId;
      }
    } catch {
      // ignore
    }
    if (!teamId && projectId) {
      teamId = projectToTeam.get(projectId) ?? null;
    }

    if (!map.has(sessionId)) {
      map.set(sessionId, { userId, projectId, teamId, createdAt: Date.now() });
    }
  }
}

export function recordSessionMeta(
  realSessionId: string,
  userId: string | null,
  projectId: string | null,
  teamId: string | null
) {
  const map = getMetaMap();
  if (!map.has(realSessionId)) {
    map.set(realSessionId, { userId, projectId, teamId, createdAt: Date.now() });
  }
}

export function getSessionMeta(realSessionId: string): SessionMetaRow | undefined {
  return getMetaMap().get(realSessionId);
}

export function listSessionMeta(): SessionMetaRow[] {
  return Array.from(getMetaMap().values());
}

// M2.4: assertCanReadSession now requires awaiting an async DB lookup.
// The synchronous shape is kept only as a transitional deprecation stub
// that throws if called — all call sites in app/ must migrate to
// assertCanReadSessionScoped from lib/team-auth.ts (which returns the
// decision reason alongside the boolean, so the caller can write audit
// log entries with proper context).
export function assertCanReadSession(
  userId: string,
  userRole: "OWNER" | "ADMIN" | "MEMBER" | null,
  sessionId: string
): boolean {
  throw new Error(
    "assertCanReadSession is removed in M2.4 — use await " +
      "assertCanReadSessionScoped(userId, userRole, meta, sessionId) " +
      "from lib/team-auth.ts. The signature change forces every call " +
      "site to be reviewed for team isolation."
  );
}
