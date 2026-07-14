// lib/session-cap.ts
// M2.3: per-user session cap (default 5) with global 50 as fallback.
// Replaces M2.2's global-only counter. Same in-memory lifecycle story:
// process-lifetime counter, lost on restart. M3+ may persist this.
declare global {
  // eslint-disable-next-line no-var
  var __piSessionCap: { perUser: Map<string, number>; total: number } | undefined;
  // Tracks the last "touched" timestamp for each userId, used to evict
  // the least-recently-active user when we need to make room. Updated
  // on every increment and on every cap check.
  // eslint-disable-next-line no-var
  var __piUserLastActive: Map<string, number> | undefined;
}

const DEFAULT_USER_CAP = 5;
const GLOBAL_CAP = 50;

function getCap(): { perUser: Map<string, number>; total: number } {
  if (!globalThis.__piSessionCap) {
    globalThis.__piSessionCap = { perUser: new Map<string, number>(), total: 0 };
  }
  return globalThis.__piSessionCap;
}

function getLastActive(): Map<string, number> {
  if (!globalThis.__piUserLastActive) {
    globalThis.__piUserLastActive = new Map<string, number>();
  }
  return globalThis.__piUserLastActive;
}

/**
 * Check whether a user may create another session.
 * Per-user ceiling is checked first (allows friendly error messages and clear
 * per-user enforcement). Global ceiling is the fallback (defense in depth).
 *
 * @returns { allowed, current, max } — `max` reports whichever cap was hit
 *          (USER_SESSION_CAP_MAX or GLOBAL_SESSION_CAP_MAX).
 */
export function checkUserSessionCap(
  userId: string
): { allowed: boolean; current: number; max: number } {
  const cap = getCap();
  const lastActive = getLastActive();

  // Update this user's last-active timestamp; the cap check itself is
  // a signal of "this user is doing something" so it should keep the
  // user's slot from being the one evicted.
  lastActive.set(userId, Date.now());

  const current = cap.perUser.get(userId) || 0;
  if (current >= DEFAULT_USER_CAP) {
    return { allowed: false, current, max: DEFAULT_USER_CAP };
  }
  if (cap.total >= GLOBAL_CAP) {
    return { allowed: false, current, max: GLOBAL_CAP };
  }
  return { allowed: true, current, max: DEFAULT_USER_CAP };
}

/**
 * Return the userId whose last activity is oldest (excluding
 * `exceptUserId`). Returns null when no other user is tracked. Used by
 * the route handler to decide whom to evict when the global cap is hit.
 */
export function getOldestActiveUserIdExcept(exceptUserId: string): string | null {
  const lastActive = getLastActive();
  let oldestUserId: string | null = null;
  let oldestTime = Number.POSITIVE_INFINITY;
  for (const [uid, t] of lastActive) {
    if (uid === exceptUserId) continue;
    if (t < oldestTime) {
      oldestTime = t;
      oldestUserId = uid;
    }
  }
  return oldestUserId;
}

/** Increment both the per-user counter and the global total. */
export function incrementUserSessionCap(userId: string): void {
  const cap = getCap();
  cap.perUser.set(userId, (cap.perUser.get(userId) || 0) + 1);
  cap.total++;
  getLastActive().set(userId, Date.now());
}

/** Decrement per-user counter and global total; clamp at zero. */
export function decrementUserSessionCap(userId: string): void {
  const cap = getCap();
  const current = cap.perUser.get(userId) || 0;
  if (current > 0) cap.perUser.set(userId, current - 1);
  if (cap.total > 0) cap.total--;
  // If the user has no more sessions, drop them from lastActive so the
  // LRU sort doesn't keep stale users as candidates for eviction.
  if ((cap.perUser.get(userId) || 0) === 0) {
    cap.perUser.delete(userId);
    getLastActive().delete(userId);
  }
}

export const USER_SESSION_CAP_MAX = DEFAULT_USER_CAP;
export const GLOBAL_SESSION_CAP_MAX = GLOBAL_CAP;

// M2.3 known limitation: decrementUserSessionCap has no production call site.
// The fork's SessionManager does not expose a close hook for the M1 RSC
// subsystem, so the in-memory counter only grows during a server's lifetime.
// The beforeExit observer below ensures graceful shutdown logs the final
// counts; M3+ will add a proper session-close hook.
if (typeof process !== "undefined") {
  process.on("beforeExit", () => {
    const cap = getCap();
    // eslint-disable-next-line no-console
    console.log(
      `[session-cap] shutdown: total=${cap.total} per-user=${cap.perUser.size} users (per-user max ${DEFAULT_USER_CAP}, global max ${GLOBAL_CAP})`
    );
  });
}
