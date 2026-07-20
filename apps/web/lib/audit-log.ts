// lib/audit-log.ts
//
// M2.4 audit log helper.
//
// All security-relevant events write to the AuditLog table. Each event
// has a stable `action` token (e.g. "session.access_denied",
// "session.share_create", "user.create"), the affected resource type
// and id, and optional structured `metadata` as a JSON string.
//
// Performance: the helper short-circuits repeated identical events
// from the same (userId, action, resourceType, resourceId) within a
// configurable dedupe window (default 5s, set via dedupeMs). This stops
// sustained 403 storms (e.g. a misbehaving client retrying a denied
// request 100/sec) from filling the AuditLog table with noise. The
// dedupe state lives in globalThis so duplicate suppression survives
// hot reloads in dev.
//
// Disk vs DB: the helper is intentionally synchronous-failing — it
// catches and logs its own errors rather than throwing, so a DB outage
// during audit logging cannot block the primary request path. The
// `throwOnError` option exists for tests that want to assert the
// helper works end-to-end.

import { prisma } from "./prisma";

export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "session.create"
  | "session.access_denied"
  | "session.body_access_denied"
  | "session.share_create"
  | "session.share_delete"
  | "session.export"
  | "user.create"
  | "user.update"
  | "user.delete"
  | "user.disable"
  | "user.password_change"
  | "user.reset_password"
  | "user.assign_role"
  | "role.create"
  | "role.update"
  | "role.delete"
  | "role.assign_permission"
  | "menu.create"
  | "menu.update"
  | "menu.delete";

interface AuditEvent {
  userId?: string | null;
  action: AuditAction | string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

interface DedupeEntry {
  firstAt: number;
  lastAt: number;
  count: number;
}

interface AuditState {
  dedupe: Map<string, DedupeEntry>;
  totalWritten: number;
  totalDeduplicated: number;
  totalFailed: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __piAuditState: AuditState | undefined;
}

function getAuditState(): AuditState {
  if (!globalThis.__piAuditState) {
    globalThis.__piAuditState = { dedupe: new Map(), totalWritten: 0, totalDeduplicated: 0, totalFailed: 0 };
  }
  return globalThis.__piAuditState;
}

/**
 * Reset audit state. Tests that exercise the dedupe window call this
 * in beforeEach so they don't see stale deduplication.
 */
export function _resetAuditStateForTests(): void {
  globalThis.__piAuditState = { dedupe: new Map(), totalWritten: 0, totalDeduplicated: 0, totalFailed: 0 };
}

/**
 * Write one audit log entry. Same-key events within `dedupeMs` are
 * coalesced: the first event is persisted, subsequent events within
 * the window only bump the in-memory counter (which is visible via
 * _getAuditStatsForTests).
 *
 * The dedupe key is `${userId ?? "_"}::${action}::${resourceType}::${resourceId ?? "_"}`.
 * If you want every event to land in DB, set dedupeMs=0.
 *
 * Returns: { written: boolean } — `written=false` means the event was
 * deduplicated (or failed silently).
 */
export async function auditLog(
  event: AuditEvent,
  options: { dedupeMs?: number; throwOnError?: boolean } = {}
): Promise<{ written: boolean; deduplicated?: boolean; failed?: boolean }> {
  const dedupeMs = options.dedupeMs ?? 5000;
  const state = getAuditState();
  const key = `${event.userId ?? "_"}::${event.action}::${event.resourceType}::${event.resourceId ?? "_"}`;
  const now = Date.now();

  const entry = state.dedupe.get(key);
  if (entry && now - entry.lastAt < dedupeMs) {
    entry.lastAt = now;
    entry.count += 1;
    state.totalDeduplicated += 1;
    return { written: false, deduplicated: true };
  }

  try {
    await prisma.auditLog.create({
      data: {
        userId: event.userId ?? null,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId ?? null,
        metadata: event.metadata ? JSON.stringify(event.metadata) : null,
      },
    });
    state.dedupe.set(key, { firstAt: now, lastAt: now, count: 1 });
    state.totalWritten += 1;
    return { written: true };
  } catch (err) {
    state.totalFailed += 1;
    // eslint-disable-next-line no-console
    console.error("[audit-log] failed to write event", err);
    if (options.throwOnError) throw err;
    return { written: false, failed: true };
  }
}

/**
 * Read counters. For observability / tests only.
 */
export function _getAuditStatsForTests(): {
  totalWritten: number;
  totalDeduplicated: number;
  totalFailed: number;
} {
  const state = getAuditState();
  return {
    totalWritten: state.totalWritten,
    totalDeduplicated: state.totalDeduplicated,
    totalFailed: state.totalFailed,
  };
}