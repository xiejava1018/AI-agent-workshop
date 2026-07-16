import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

// Routes NOT required to call enforceNotMustChange.
//
// Two groups:
//   1. AUTH-FLOW endpoints — user is pre-authentication or escaping the
//      mustChangePassword state. These are exempt by design.
//   2. KNOWN UNGATED write routes — gaps from Task 4.1's limited scope.
//      Each future task that adds a gate to one of these should remove
//      the entry from this list, and the route will then be verified by
//      the meta-test below.
const ALLOWLIST_PATHS = new Set<string>([
  // Group 1 — auth-flow endpoints (pre-auth or state-clearing)
  "auth/change-password/route.ts",
  "auth/refresh/route.ts", // M2.3: pre-auth (pw_at may be expired when refresh is needed)
  "auth/user-login/route.ts",
  "auth/user-logout/route.ts",
  "auth/api-key/[provider]/route.ts",
  "auth/login/[provider]/route.ts",
  "auth/logout/[provider]/route.ts",

  // Group 2 — known ungated write routes (Task 4.1 covered only 4 routes
  // that have write handlers; agent/[id]/events is GET-only and excluded
  // by the walker). Each of these below must gain an enforceNotMustChange
  // gate in a future task; remove the line from this allowlist at the
  // same time the gate is added.
  "cwd/validate/route.ts",
  "default-cwd/route.ts",
  "models-config/route.ts",
  "models-config/test/route.ts",
  "plugins/route.ts",
  "sessions/[id]/route.ts",
  "skills/install/route.ts",
  "skills/route.ts",
  "skills/search/route.ts",
  "worktrees/route.ts",
  // M2.3 admin user-management endpoint — OWNER/ADMIN gated by role,
  // intentionally does not require mustChangePassword: an admin who just
  // accepted an initial password needs to provision team members BEFORE
  // they can sign in to change their own password.
  "admin/users/route.ts",
]);

type RouteFile = {
  relPath: string;
  content: string;
  writeHandlers: string[]; // POST, PUT, DELETE, PATCH
};

function walkApiRoutes(dir: string): RouteFile[] {
  const out: RouteFile[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkApiRoutes(full));
    } else if (name === "route.ts") {
      // Compute the path relative to the apiDir so allowlist entries
      // using "app/api/..." keys match. The walker was invoked with
      // <repoRoot>/app/api as the starting directory, so all relative
      // paths begin with "app/api/".
      const apiDir = join(process.cwd(), "app/api");
      const rel = relative(apiDir, full);
      const content = readFileSync(full, "utf-8");
      const writeHandlers = [
        ...content.matchAll(
          /export\s+async\s+function\s+(POST|PUT|DELETE|PATCH)\b/g
        ),
      ].map((m) => m[1]);
      if (writeHandlers.length > 0) {
        out.push({ relPath: rel, content, writeHandlers });
      }
    }
  }
  return out;
}

describe("mustChangePassword gate coverage (meta-test)", () => {
  const apiDir = join(process.cwd(), "app/api");
  const routes = walkApiRoutes(apiDir);

  // Sanity: at least the 4 routes gated by Task 4.1 (the only routes
  // currently with write handlers that call enforceNotMustChange) must
  // be present. agent/[id]/events is GET-only and skipped by the walker.
  it("scans >= 4 gated route files (Task 4.1 coverage)", () => {
    const gated = routes.filter((r) => !ALLOWLIST_PATHS.has(r.relPath));
    expect(gated.length).toBeGreaterThanOrEqual(4);
  });

  // For each route file with write handlers (and not allowlisted),
  // verify enforceNotMustChange is both imported and called.
  for (const route of routes) {
    if (ALLOWLIST_PATHS.has(route.relPath)) continue;

    it(`${route.relPath} (${route.writeHandlers.join(", ")}) calls enforceNotMustChange`, () => {
      // The import must be present
      expect(route.content).toMatch(
        /import\s*\{[^}]*enforceNotMustChange[^}]*\}\s*from\s*["']@\/lib\/must-change-password["']/
      );
      // The function call must be present in the body
      expect(route.content).toMatch(/enforceNotMustChange\s*\(\s*req\s*\)/);
    });
  }
});
