declare global {
  var __piSessionMeta: Map<string, SessionMetaRow> | undefined;
}

export type SessionMetaRow = {
  userId: string | null;
  projectId: string | null;
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

    if (!map.has(sessionId)) {
      map.set(sessionId, { userId, projectId, createdAt: Date.now() });
    }
  }
}

export function recordSessionMeta(
  realSessionId: string,
  userId: string | null,
  projectId: string | null
) {
  const map = getMetaMap();
  if (!map.has(realSessionId)) {
    map.set(realSessionId, { userId, projectId, createdAt: Date.now() });
  }
}

export function getSessionMeta(realSessionId: string): SessionMetaRow | undefined {
  return getMetaMap().get(realSessionId);
}

export function listSessionMeta(): SessionMetaRow[] {
  return Array.from(getMetaMap().values());
}

export function assertCanReadSession(
  userId: string,
  userRole: "OWNER" | "ADMIN" | "MEMBER" | null,
  sessionId: string
): boolean {
  const meta = getSessionMeta(sessionId);
  if (!meta) return false;
  if (meta.userId === userId) return true;
  if (userRole && ["OWNER", "ADMIN"].includes(userRole)) {
    // 注: M1 简化, 不做 teamId 检查（owner/admin 总可见）
    return true;
  }
  return false;
}
