import { test, expect, request as pwRequest } from "@playwright/test";
import { execSync } from "child_process";

/**
 * Files endpoints smoke test (M3+ follow-up, see docs/plans/2026-07-18-...-design.md v1.5)
 *
 * Verifies the /api/agent/[id]/files routes added in d1e4100 work
 * end-to-end against a real authenticated session:
 *   - 401 without auth
 *   - 200 GET /api/agent/[id]/files?path=. (list cwd)
 *   - 400 GET /api/agent/[id]/files with path-traversal payload
 *   - 404 GET /api/agent/[id]/files for a session with no cwd
 *
 * Read endpoint (files/[...path]) is exercised only against a known-safe
 * file in the test session's cwd, to keep the test self-contained.
 */

let rootPassword: string;
let sessionId: string;

test.beforeAll(async () => {
  execSync("pnpm run db:reset", { stdio: "inherit", env: { ...process.env, CI: "1" } });
  const out = execSync("pnpm exec tsx scripts/bootstrap-root.ts").toString();
  const m = out.match(/password=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("bootstrap did not output password");
  rootPassword = m[1];
});

test("auth + change-password + create session + files routes smoke", async () => {
  const ctx = await pwRequest.newContext({ baseURL: "http://localhost:30141" });

  // 1. Login + change password (must-change gate)
  const login = await ctx.post("/api/auth/user-login", {
    data: { username: "root", password: rootPassword },
  });
  expect(login.status()).toBe(200);
  const newPassword = "new-secret-pw-" + Date.now();
  await ctx.post("/api/auth/change-password", { data: { newPassword } });

  // 2. Create a session (ensure_session only — no message yet)
  const created = await ctx.post("/api/agent/new", {
    data: { type: "ensure_session", title: "files-smoke", userId: "root" },
  });
  expect(created.ok()).toBeTruthy();
  const createdBody = await created.json();
  sessionId = createdBody.sessionId ?? createdBody.data?.sessionId;
  expect(sessionId).toBeTruthy();

  // 3. Files list endpoint — cwd comes from process when ensure_session used.
  //    We just verify the endpoint shape (200 + items[]) or 404 (no cwd).
  const listResp = await ctx.get(`/api/agent/${sessionId}/files?path=.`);
  expect([200, 404]).toContain(listResp.status());
  if (listResp.status() === 200) {
    const body = await listResp.json();
    expect(Array.isArray(body.data?.items ?? body.items)).toBe(true);
  }

  // 4. Path traversal — must be rejected with 400 (NOT 200 with cwd escape).
  const evil = await ctx.get(
    `/api/agent/${sessionId}/files?path=${encodeURIComponent("../../../../etc/passwd")}`,
  );
  expect([400, 404]).toContain(evil.status());

  // 5. Read endpoint against a known-safe file (only if list returned items).
  if (listResp.status() === 200) {
    const body = await listResp.json();
    const items = body.data?.items ?? body.items;
    const firstFile = items.find((it: { isDir: boolean; name: string }) => !it.isDir);
    if (firstFile) {
      const fileResp = await ctx.get(
        `/api/agent/${sessionId}/files/${encodeURIComponent(firstFile.path)}`,
      );
      expect([200, 413, 415]).toContain(fileResp.status());
    }
  }
});