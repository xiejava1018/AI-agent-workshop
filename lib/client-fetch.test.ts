// lib/client-fetch.test.ts
//
// TDD test suite for the 401-refresh-retry fetch wrapper used by client
// pages such as /[locale]/login (Task 5.1).
//
// Test plan (each `it` maps to one expected behavior):
//  1. returns the original response when it is NOT 401
//  2. retries the original request ONCE after a successful refresh on 401
//  3. calls /api/auth/refresh exactly once (never loops)
//  4. invokes onAuthFailed and returns the original 401 response when refresh fails
//  5. does NOT call refresh when the initial response is 403 (only 401 triggers refresh)
//  6. preserves the original request body + headers on the retry
//  7. handles network errors thrown by fetch (does not call refresh on TypeError)
//  8. refresh-once guard: even if refresh returns ok, the retry itself is NOT subject to another 401-refresh loop

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { authFetch } from "./client-fetch";

type FetchCall = { url: string; init?: RequestInit };

// Build a minimal Response that the wrapper treats as fetch output.
function makeResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const calls: FetchCall[] = [];

/**
 * Install a globalThis.fetch spy that:
 *   - resolves to the next entry of `responses` per call (FIFO)
 *   - records (url, init) into the shared `calls` array
 *
 * Pass `Error` instances for rejections (e.g. `new TypeError("Failed to fetch")`).
 */
function installFetchSpy(responses: Array<Response | Error>): void {
  let idx = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const next = responses[idx++];
    if (next === undefined) {
      throw new Error(
        `installFetchSpy: no queued response for call #${idx} to ${url}`
      );
    }
    if (next instanceof Error) throw next;
    return next;
  });
}

beforeEach(() => {
  calls.length = 0;
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authFetch — 401 refresh-retry wrapper", () => {
  it("returns the original response when it is NOT 401", async () => {
    installFetchSpy([makeResponse(200, { hi: 1 })]);

    const onAuthFailed = vi.fn();
    const res = await authFetch("/api/projects", { method: "GET" }, onAuthFailed);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/projects");
    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  it("retries the original request ONCE after a successful refresh on 401", async () => {
    // First call: 401. Second call (refresh): 200 ok. Third call (retry): 200.
    installFetchSpy([
      makeResponse(401, { error: "auth required" }),
      makeResponse(200, { ok: true }),
      makeResponse(200, { projects: [] }),
    ]);

    const onAuthFailed = vi.fn();
    const res = await authFetch("/api/projects", { method: "GET" }, onAuthFailed);

    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([
      "/api/projects",
      "/api/auth/refresh",
      "/api/projects",
    ]);
    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  it("calls /api/auth/refresh exactly once even if the retry also 401s", async () => {
    // 401 → refresh ok → retry 401 → NO second refresh attempt.
    // The session IS valid (refresh succeeded), so onAuthFailed should NOT fire
    // for the second 401 — that 401 means "authenticated but this resource
    // rejects you", not "session is dead". Caller handles the response.
    installFetchSpy([
      makeResponse(401),
      makeResponse(200),
      makeResponse(401),
    ]);

    const onAuthFailed = vi.fn();
    const res = await authFetch("/api/projects", {}, onAuthFailed);

    expect(res.status).toBe(401);
    const urls = calls.map((c) => c.url);
    // Exactly one refresh call; the retry does NOT itself trigger another refresh.
    expect(urls.filter((u) => u === "/api/auth/refresh")).toHaveLength(1);
    // Refresh succeeded → the session is alive. The 401 from the retry is the
    // caller's problem to surface (likely a permission error to display).
    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  it("invokes onAuthFailed and returns the original 401 response when refresh fails", async () => {
    installFetchSpy([
      makeResponse(401),
      makeResponse(401, { error: "invalid refresh token" }),
    ]);

    const onAuthFailed = vi.fn();
    const res = await authFetch("/api/projects", {}, onAuthFailed);

    expect(res.status).toBe(401);
    expect(onAuthFailed).toHaveBeenCalledTimes(1);
    // Should have made exactly two calls: original + refresh.
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("/api/projects");
    expect(calls[1].url).toBe("/api/auth/refresh");
  });

  it("does NOT call refresh when the initial response is 403 (forbidden)", async () => {
    installFetchSpy([makeResponse(403, { error: "forbidden" })]);

    const onAuthFailed = vi.fn();
    const res = await authFetch("/api/admin/users", {}, onAuthFailed);

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/admin/users");
    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  it("preserves the original request body + method on the retry", async () => {
    const body = JSON.stringify({ username: "alice", password: "x" });
    installFetchSpy([
      makeResponse(401),
      makeResponse(200),
      makeResponse(200),
    ]);

    const onAuthFailed = vi.fn();
    await authFetch(
      "/api/projects",
      { method: "POST", headers: { "Content-Type": "application/json" }, body },
      onAuthFailed
    );

    const originalCall = calls[0];
    const retryCall = calls[2];
    expect(originalCall.init?.method).toBe("POST");
    expect(retryCall.init?.method).toBe("POST");
    expect(retryCall.init?.body).toBe(body);
  });

  it("does NOT call refresh when fetch throws a network error", async () => {
    installFetchSpy([new TypeError("Failed to fetch")]);

    const onAuthFailed = vi.fn();
    await expect(authFetch("/api/projects", {}, onAuthFailed)).rejects.toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/projects");
    expect(onAuthFailed).not.toHaveBeenCalled();
  });
});
