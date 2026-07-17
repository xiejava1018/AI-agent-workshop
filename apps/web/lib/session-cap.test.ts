// lib/session-cap.test.ts
// M2.3: per-user session cap (5) with global 50 as fallback.
// Replaces M2.2 global-only counter.
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkUserSessionCap,
  incrementUserSessionCap,
  decrementUserSessionCap,
  getOldestActiveUserIdExcept,
  USER_SESSION_CAP_MAX,
  GLOBAL_SESSION_CAP_MAX,
} from "./session-cap";

beforeEach(() => {
  globalThis.__piSessionCap = undefined;
  globalThis.__piUserLastActive = undefined;
});

describe("session-cap (per-user with global fallback)", () => {
  it("allows when below per-user cap", () => {
    const r = checkUserSessionCap("alice");
    expect(r.allowed).toBe(true);
    expect(r.current).toBe(0);
    expect(r.max).toBe(USER_SESSION_CAP_MAX);
  });

  it("blocks after 5 increments for the same user", () => {
    for (let i = 0; i < 5; i++) {
      incrementUserSessionCap("alice");
    }
    const r = checkUserSessionCap("alice");
    expect(r.allowed).toBe(false);
    expect(r.current).toBe(5);
    expect(r.max).toBe(USER_SESSION_CAP_MAX);
  });

  it("blocks at exactly 5 on increment 6 attempt", () => {
    for (let i = 0; i < 5; i++) {
      incrementUserSessionCap("alice");
    }
    // At cap — any further increment is allowed by the counter (best-effort),
    // but the check must refuse further creation requests.
    incrementUserSessionCap("alice");
    const r = checkUserSessionCap("alice");
    expect(r.allowed).toBe(false);
    expect(r.current).toBe(6);
  });

  it("does not block another user when one user is full (per-user isolation)", () => {
    for (let i = 0; i < 5; i++) {
      incrementUserSessionCap("alice");
    }
    expect(checkUserSessionCap("alice").allowed).toBe(false);
    // Bob has never created a session — must be allowed.
    const bob = checkUserSessionCap("bob");
    expect(bob.allowed).toBe(true);
    expect(bob.current).toBe(0);
    expect(bob.max).toBe(USER_SESSION_CAP_MAX);
  });

  it("global cap of 50 triggers after all users combined reach 50", () => {
    // Spread across 10 users so per-user is never the limiter.
    for (let u = 0; u < 10; u++) {
      for (let i = 0; i < 5; i++) {
        incrementUserSessionCap(`user${u}`);
      }
    }
    // 50 total, 5 per user — per-user ceiling blocks new sessions at this point.
    // The 'global cap as fallback' requirement says: even if a single user
    // somehow had room, total=50 would block. Verify via a fresh user at total=50.
    const r = checkUserSessionCap("fresh");
    expect(r.allowed).toBe(false);
    expect(r.max).toBe(GLOBAL_SESSION_CAP_MAX);
  });

  it("decrement frees a slot", () => {
    for (let i = 0; i < 5; i++) {
      incrementUserSessionCap("alice");
    }
    expect(checkUserSessionCap("alice").allowed).toBe(false);
    decrementUserSessionCap("alice");
    const r = checkUserSessionCap("alice");
    expect(r.allowed).toBe(true);
    expect(r.current).toBe(4);
  });

  it("decrement does not go below zero", () => {
    decrementUserSessionCap("alice"); // no prior increment
    expect(checkUserSessionCap("alice").current).toBe(0);
    // global total also must not go below zero
    expect((globalThis.__piSessionCap as { total: number }).total).toBe(0);
  });

  it("exports USER_SESSION_CAP_MAX = 5 and GLOBAL_SESSION_CAP_MAX = 50", () => {
    expect(USER_SESSION_CAP_MAX).toBe(5);
    expect(GLOBAL_SESSION_CAP_MAX).toBe(50);
  });

  describe("getOldestActiveUserIdExcept", () => {
    it("returns null when no other users are tracked", () => {
      incrementUserSessionCap("alice");
      expect(getOldestActiveUserIdExcept("alice")).toBeNull();
    });

    it("returns the oldest active user excluding the given userId", () => {
      // Alice first, then Bob, then Carol
      incrementUserSessionCap("alice");
      // Simulate time passing — touch bob
      const lastActive = (globalThis as Record<string, unknown>).__piUserLastActive as Map<string, number> | undefined;
      lastActive?.set("bob", Date.now());
      // touch carol
      lastActive?.set("carol", Date.now());

      const oldest = getOldestActiveUserIdExcept("alice");
      // alice was touched first (at increment time), bob and carol at approximately same time
      // oldest excluding alice could be bob or carol
      expect(oldest).not.toBe("alice");
      expect(oldest === "bob" || oldest === "carol").toBe(true);
    });

    it("returns null when only the exceptUserId is tracked", () => {
      incrementUserSessionCap("solo");
      expect(getOldestActiveUserIdExcept("solo")).toBeNull();
    });

    it("skips the exceptUserId even if they are the oldest", () => {
      // Set alice as oldest (earlier timestamp), bob as newer
      globalThis.__piUserLastActive = new Map<string, number>();
      globalThis.__piUserLastActive.set("alice", Date.now() - 1000); // older
      globalThis.__piUserLastActive.set("bob", Date.now() - 500); // newer

      const oldest = getOldestActiveUserIdExcept("alice");
      expect(oldest).toBe("bob");
    });
  });
});
