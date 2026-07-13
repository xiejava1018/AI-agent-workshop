import { test, expect, request as pwRequest } from "@playwright/test";
import { execSync } from "child_process";

let rootPassword: string;

test.beforeAll(() => {
  execSync("pnpm run db:reset", { stdio: "inherit", env: { ...process.env, CI: "1" } });
  const out = execSync("pnpm exec tsx scripts/bootstrap-root.ts").toString();
  const m = out.match(/password=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("bootstrap did not output password");
  rootPassword = m[1];
});

test("API smoke: bootstrap → user-login → change-password → JWT access", async () => {
  // 1. Verify middleware returns 401 on /api/auth/me (a JWT-protected route) without cookie
  const unauthCtx = await pwRequest.newContext({ baseURL: "http://localhost:30141" });
  const noAuthResp = await unauthCtx.get("/api/auth/me");  // any JWT-protected route works
  expect(noAuthResp.status()).toBe(401);

  // 2. Login with the bootstrap root credentials
  const loginCtx = await pwRequest.newContext({ baseURL: "http://localhost:30141" });
  const loginResp = await loginCtx.post("/api/auth/user-login", {
    data: { username: "root", password: rootPassword },
  });
  expect(loginResp.status()).toBe(200);
  const loginBody = await loginResp.json();
  expect(loginBody.username).toBe("root");
  expect(loginBody.mustChangePassword).toBe(true);

  // 3. Verify pw_at cookie is set
  const cookies = await loginCtx.storageState();
  const pwAt = cookies.cookies.find(c => c.name === "pw_at");
  expect(pwAt).toBeTruthy();
  expect(pwAt!.httpOnly).toBe(true);
  expect(pwAt!.sameSite).toBe("Lax");

  // 4. With the cookie, a JWT-protected route should now succeed (or at least return non-401)
  //    We don't have a /me route in M1, so we test against /api/projects which is JWT-protected
  const projectsResp = await loginCtx.get("/api/projects");
  expect(projectsResp.status()).not.toBe(401);

  // 5. Change the password
  const newPassword = "new-secret-pw-" + Date.now();
  const changeResp = await loginCtx.post("/api/auth/change-password", {
    data: { newPassword },
  });
  expect(changeResp.status()).toBe(200);
  const changeBody = await changeResp.json();
  expect(changeBody.ok).toBe(true);

  // 6. The cookie from the old login is still valid (JWT hasn't expired), but the DB now
  //    has the new password hash. To verify the change, logout and re-login with the new password.
  await loginCtx.post("/api/auth/user-logout");
  const reLoginCtx = await pwRequest.newContext({ baseURL: "http://localhost:30141" });
  const reLoginResp = await reLoginCtx.post("/api/auth/user-login", {
    data: { username: "root", password: newPassword },
  });
  expect(reLoginResp.status()).toBe(200);
  const reLoginBody = await reLoginResp.json();
  expect(reLoginBody.username).toBe("root");
  expect(reLoginBody.mustChangePassword).toBe(false);  // cleared by change-password
});
