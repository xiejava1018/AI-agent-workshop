/**
 * Pure validation helpers for the user-login route. No DB, no Next.js deps.
 *
 * Extracted so we can unit-test edge cases (missing/empty/non-string fields)
 * without standing up a Next.js test harness. The route handler calls these
 * helpers before any provider.authenticate() work.
 */

export type LoginValidationError =
  | { ok: false; status: 400; body: { error: string } };

export interface ValidatedLogin {
  ok: true;
  username: string;
  password: string;
}

const MISSING_CREDENTIALS = { error: "missing credentials" } as const;

export function validateLoginBody(body: unknown): LoginValidationError | ValidatedLogin {
  // Body must be an object so we can shape-narrow before field access.
  if (body === null || typeof body !== "object") {
    return { ok: false, status: 400, body: MISSING_CREDENTIALS };
  }

  const { username, password } = body as { username?: unknown; password?: unknown };

  // Both fields must be non-empty strings.
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length === 0 ||
    password.length === 0
  ) {
    return { ok: false, status: 400, body: MISSING_CREDENTIALS };
  }

  return { ok: true, username, password };
}

export const INVALID_CREDENTIALS_MESSAGE = "invalid credentials";
