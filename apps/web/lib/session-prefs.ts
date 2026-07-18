/**
 * Persistent store for user-level session preferences that are NOT stored in
 * the session .jsonl (because we don't want to touch the source-of-truth file
 * for metadata that's purely about sidebar ordering, e.g. "pinned").
 *
 * Backed by a single JSON file at `${PI_WEB_DATA_DIR}/.session-prefs.json`.
 * The file shape is intentionally simple so atomic rewriting is cheap:
 *   { pinned: string[] }   // session ids, in pin order (most-recent pin last)
 *
 * Visibility is GLOBAL (not per-user) in this first cut — pinned sessions show
 * up at the top for every user that can see the session. Switching to a per-user
 * store is a localized change if/when the auth layer learns from this: just key
 * on userId instead of the global map.
 */
declare global {
  // eslint-disable-next-line no-var
  var __piSessionPrefs: {
    pinnedAt: Map<string, number>;
    loadedFrom?: string;
  } | undefined;
}

interface PrefsFile {
  pinned: string[];
}

function dataDir(): string {
  return process.env.PI_WEB_DATA_DIR || "./data";
}

function prefsPath(): string {
  // __dirname .ts builds don't need this; runtime always uses runtime path.
  return `${dataDir()}/.session-prefs.json`;
}

function getStore(): {
  pinnedAt: Map<string, number>;
  loadedFrom?: string;
} {
  if (!globalThis.__piSessionPrefs) {
    globalThis.__piSessionPrefs = { pinnedAt: new Map() };
    // Best-effort eager load; on read we'll re-check the mtime so an external
    // write is observed even if this load raced.
    void loadFromDisk();
  }
  return globalThis.__piSessionPrefs;
}

async function loadFromDisk(): Promise<void> {
  const store = globalThis.__piSessionPrefs;
  if (!store) return;
  const { readFile, stat } = await import("fs/promises");
  const path = prefsPath();
  try {
    const [raw, st] = await Promise.all([
      readFile(path, "utf-8"),
      stat(path),
    ]);
    const parsed = JSON.parse(raw) as PrefsFile;
    store.pinnedAt = new Map();
    if (Array.isArray(parsed.pinned)) {
      parsed.pinned.forEach((id, idx) => {
        if (typeof id !== "string") return;
        // Use ascending order so the most recent pin sorts last → easy to
        // reorder in the UI later by "pinnedAt desc" if needed.
        store.pinnedAt.set(id, idx);
      });
    }
    store.loadedFrom = `${path}:${st.mtimeMs}`;
  } catch {
    // File missing or malformed — fall back to empty store, do not throw.
  }
}

async function maybeReload(): Promise<void> {
  const store = globalThis.__piSessionPrefs;
  if (!store) return;
  const { stat } = await import("fs/promises");
  try {
    const st = await stat(prefsPath());
    const tag = `${prefsPath()}:${st.mtimeMs}`;
    if (tag !== store.loadedFrom) await loadFromDisk();
  } catch {
    // File missing → nothing to reload.
  }
}

async function persistToDisk(): Promise<void> {
  const store = getStore();
  const { writeFile, mkdir } = await import("fs/promises");
  const path = prefsPath();
  // Build the JSON in pin order so file diffs are deterministic.
  const entries = [...store.pinnedAt.entries()].sort((a, b) => a[1] - b[1]);
  const body: PrefsFile = { pinned: entries.map(([id]) => id) };
  await mkdir(dataDir(), { recursive: true });
  await writeFile(path, JSON.stringify(body, null, 2) + "\n", "utf-8");
  store.loadedFrom = `${path}:${(await (await import("fs/promises")).stat(path)).mtimeMs}`;
}

/** Whether the session is currently pinned. Reads trigger an async re-check. */
export function isPinned(sessionId: string): boolean {
  return getStore().pinnedAt.has(sessionId);
}

/** Snapshot of all currently pinned session ids (in pin order, ascending). */
export function getPinnedSessionIds(): string[] {
  return [...getStore().pinnedAt.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
}

/** Toggle (or set) a session's pinned status. Returns the new state. */
export async function setPinned(sessionId: string, pinned: boolean): Promise<boolean> {
  await maybeReload();
  const store = getStore();
  if (pinned) {
    if (!store.pinnedAt.has(sessionId)) {
      // Append to the end so subsequent reads sort by most-recent pin last.
      const next = store.pinnedAt.size === 0 ? 0 : Math.max(...store.pinnedAt.values()) + 1;
      store.pinnedAt.set(sessionId, next);
      await persistToDisk();
    }
    return true;
  }
  if (store.pinnedAt.delete(sessionId)) {
    await persistToDisk();
  }
  return false;
}

/** Erase a session's pin record (used on session delete so the JSONL/UI stays
 *  tidy). Fire-and-forget — failures are tolerated because the orphaned pin is
 *  harmless: the session id just won't resolve to anything. */
export function clearPinned(sessionId: string): void {
  const store = getStore();
  if (store.pinnedAt.delete(sessionId)) {
    void persistToDisk();
  }
}
