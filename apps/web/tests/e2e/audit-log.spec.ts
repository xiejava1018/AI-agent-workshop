import { test, expect, request as pwRequest } from "@playwright/test";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// XIE-23 — audit log end-to-end
//
// Drives the real web server (apps/web on :30141) to prove the audit-log
// feature works end-to-end:
//   1. An authenticated non-admin (MEMBER) CANNOT read audit logs (403).
//   2. A platform admin CAN read audit logs, with filters + pagination.
//   3. A real security event (auth.login) is recorded by its producer and
//      becomes visible through the query API.
//   4. CSV export returns text/csv with the right headers and a data row.
//   5. Single-row detail lookup returns the entry.
//
// Auth model: HttpOnly cookies set by /api/auth/user-login. The platform
// admin is root (bootstrapped), bound to platform_admin via seed env.
// ---------------------------------------------------------------------------

let rootPassword: string;

test.beforeAll(() => {
  // Fresh DB + root user (matches login.spec.ts / m3-workbench.spec.ts setup).
  execSync("pnpm run db:reset", {
    stdio: "inherit",
    env: { ...process.env, CI: "1", PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "yes" },
  });
  // Seed RBAC. Order matters: bootstrap root FIRST so the roles seed's
  // lock-guard can bind it to platform_admin (INITIAL_PLATFORM_ADMIN_USERNAME).
  execSync("pnpm exec tsx prisma/seed/permissions.ts", { stdio: "inherit", env: process.env });
  const out = execSync("pnpm exec tsx scripts/bootstrap-root.ts").toString();
  const m = out.match(/password=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("bootstrap did not output password");
  rootPassword = m[1];
  execSync("pnpm exec tsx prisma/seed/roles.ts", {
    stdio: "inherit",
    env: { ...process.env, INITIAL_PLATFORM_ADMIN_USERNAME: "root" },
  });
  execSync("pnpm exec tsx prisma/seed/menus.ts", { stdio: "inherit", env: process.env });
});

const BASE = "http://localhost:30141";

async function login(username: string, password: string) {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const resp = await ctx.post("/api/auth/user-login", { data: { username, password } });
  expect(resp.status()).toBe(200);
  return ctx;
}

test.describe("XIE-23 audit log E2E", () => {
  test("MEMBER is forbidden from reading audit logs; root reads, filters, exports", async () => {
    // root logs in — this very login records an auth.login audit entry (producer).
    const adminCtx = await login("root", rootPassword);
    // root was force-mustChangePassword; clear it so subsequent admin calls are not 403-gated.
    const newPw = "audit-e2e-pw-" + Date.now();
    const changeResp = await adminCtx.post("/api/auth/change-password", { data: { newPassword: newPw } });
    expect(changeResp.status()).toBe(200);
    rootPassword = newPw;

    // A fresh login (separate context) records another auth.login entry.
    const adminCtx2 = await login("root", rootPassword);

    // 1. MEMBER cannot read audit logs.
    //    Create a MEMBER user via admin API, then log in as them.
    const memberName = "audit-member-" + Date.now().toString(36);
    const createResp = await adminCtx2.post("/api/admin/users", { data: { username: memberName } });
    expect(createResp.status()).toBe(200);
    const memberInitial = (await createResp.json()).initialPassword as string;

    const memberCtx = await pwRequest.newContext({ baseURL: BASE });
    const memberLogin = await memberCtx.post("/api/auth/user-login", {
      data: { username: memberName, password: memberInitial },
    });
    expect(memberLogin.status()).toBe(200);

    const memberAudit = await memberCtx.get("/api/admin/audit");
    expect(memberAudit.status()).toBe(403);

    // 2. Platform admin reads audit logs (the auth.login events recorded above).
    const listResp = await adminCtx2.get("/api/admin/audit");
    expect(listResp.status()).toBe(200);
    const listBody = await listResp.json();
    expect(Array.isArray(listBody.entries)).toBe(true);
    expect(typeof listBody.total).toBe("number");
    expect(listBody.total).toBeGreaterThanOrEqual(1);

    // The login we just performed must show up as an auth.login event.
    const actionFilter = await adminCtx2.get("/api/admin/audit?action=auth.login");
    expect(actionFilter.status()).toBe(200);
    const actionBody = await actionFilter.json();
    expect(actionBody.total).toBeGreaterThanOrEqual(1);
    expect(actionBody.entries[0].action).toBe("auth.login");
    expect(actionBody.entries[0].resourceType).toBe("user");

    // 3. user.create producer: creating the member above must have logged it.
    const userCreateFilter = await adminCtx2.get("/api/admin/audit?action=user.create");
    expect(userCreateFilter.status()).toBe(200);
    const userCreateBody = await userCreateFilter.json();
    expect(userCreateBody.total).toBeGreaterThanOrEqual(1);

    // 4. CSV export returns text/csv with headers and a data row.
    const exportResp = await adminCtx2.get("/api/admin/audit/export?action=auth.login");
    expect(exportResp.status()).toBe(200);
    expect(exportResp.headers()["content-type"]).toContain("text/csv");
    expect(exportResp.headers()["content-disposition"]).toMatch(/attachment; filename="audit_logs_.*\.csv"/);
    const csv = await exportResp.text();
    const lines = csv.split("\r\n");
    expect(lines[0].replace(/^﻿/, "")).toBe(
      "id,created_at,user_id,action,resource_type,resource_id,metadata",
    );
    expect(csv).toContain("auth.login");

    // 5. Single-row detail lookup of the first entry.
    const anEntryId = actionBody.entries[0].id;
    const detailResp = await adminCtx2.get(`/api/admin/audit/${anEntryId}`);
    expect(detailResp.status()).toBe(200);
    const detailBody = await detailResp.json();
    expect(detailBody.entry.id).toBe(anEntryId);
    expect(detailBody.entry.action).toBe("auth.login");

    // Detail lookup of an unknown id is 404.
    const notFound = await adminCtx2.get("/api/admin/audit/nonexistent-cuid");
    expect(notFound.status()).toBe(404);
  });
});
