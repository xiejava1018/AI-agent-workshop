// lib/session-cap.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { sessionCapCheck, sessionCapIncrement, sessionCapDecrement, SESSION_CAP_MAX } from "./session-cap";

beforeEach(() => {
  // Reset counter between tests
  globalThis.__piSessionCounter = { count: 0 };
});

describe("session-cap", () => {
  it("starts at 0 and allows creation", () => {
    const result = sessionCapCheck();
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(0);
  });

  it("increments counter", () => {
    sessionCapIncrement();
    sessionCapIncrement();
    expect(sessionCapCheck().current).toBe(2);
  });

  it("decrements counter (not below 0)", () => {
    sessionCapIncrement();
    sessionCapIncrement();
    sessionCapDecrement();
    expect(sessionCapCheck().current).toBe(1);
    sessionCapDecrement();
    sessionCapDecrement(); // try to go below 0
    expect(sessionCapCheck().current).toBe(0);
  });

  it("blocks when count reaches MAX", () => {
    for (let i = 0; i < SESSION_CAP_MAX; i++) {
      sessionCapIncrement();
    }
    const result = sessionCapCheck();
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(50);
  });

  it("allows again after decrement from MAX", () => {
    for (let i = 0; i < SESSION_CAP_MAX; i++) {
      sessionCapIncrement();
    }
    expect(sessionCapCheck().allowed).toBe(false);
    sessionCapDecrement();
    expect(sessionCapCheck().allowed).toBe(true);
    expect(sessionCapCheck().current).toBe(49);
  });

  it("exports SESSION_CAP_MAX as 50", () => {
    expect(SESSION_CAP_MAX).toBe(50);
  });
});
