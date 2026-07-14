// lib/session-cap.ts
// M2.3: per-user session cap (default 5) with global 50 as fallback.
// Replaces M2.2's global-only counter. Same in-memory lifecycle story:
// process-lifetime counter, lost on restart. M3+ may persist this.
declare global {
  // eslint-disable-next-line no-var
  var __piSessionCap: { perUser: Map<string, number>; total: number } | undefined;
}

const DEFAULT_USER_CAP = 5;
const GLOBAL_CAP = 50;

function getCap(): { perUser: Map<string, number>; total: number } {
  if (!globalThis.__piSessionCap) {
    globalThis.__piSessionCap = { perUser: new Map<string, number>(), total: 0 };
  }
  return globalThis.__piSessionCap;
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
  const current = cap.perUser.get(userId) || 0;
  if (current >= DEFAULT_USER_CAP) {
    return { allowed: false, current, max: DEFAULT_USER_CAP };
  }
  if (cap.total >= GLOBAL_CAP) {
    return { allowed: false, current, max: GLOBAL_CAP };
  }
  return { allowed: true, current, max: DEFAULT_USER_CAP };
}

/** Increment both the per-user counter and the global total. */
export function incrementUserSessionCap(userId: string): void {
  const cap = getCap();
  cap.perUser.set(userId, (cap.perUser.get(userId) || 0) + 1);
  cap.total++;
}

/** Decrement per-user counter and global total; clamp at zero. */
export function decrementUserSessionCap(userId: string): void {
  const cap = getCap();
  const current = cap.perUser.get(userId) || 0;
  if (current > 0) cap.perUser.set(userId, current - 1);
  if (cap.total > 0) cap.total--;
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
