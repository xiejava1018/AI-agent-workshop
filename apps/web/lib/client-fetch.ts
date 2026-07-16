// lib/client-fetch.ts
//
// 401-refresh-retry fetch wrapper for client pages.
//
// Background (M2.3, Task 5.1):
//   The server-side auth flow uses two HttpOnly cookies:
//     - pw_at (access token, 15 min)
//     - pw_rt (refresh token, 7 days)
//   When pw_at expires the server returns 401. The client can POST
//   /api/auth/refresh to swap a still-valid pw_rt for a new pw_at + pw_rt
//   pair, then retry the original request.
//
// Contract:
//   - authFetch(input, init?, onAuthFailed?)
//     1. Perform the original request.
//     2. If the response is NOT 401 → return it as-is.
//     3. If the response IS 401 → POST /api/auth/refresh.
//        - If refresh succeeds → retry the original request ONCE and return
//          the retried response (even if it is still 401; we never loop).
//          A 401 from the retry means the session is now valid but the
//          resource rejects this user — surface it to the caller.
//        - If refresh fails (non-2xx, or thrown network error) → invoke
//          onAuthFailed and return the original 401 response.
//   - The retry is exactly ONE attempt. Even if the retry also returns 401,
//     we do NOT call refresh a second time. This prevents infinite loops
//     if the server is misconfigured.
//   - onAuthFailed is the "session is dead" signal: refresh itself failed.
//     It is NOT fired when refresh succeeds but the retry 401s — in that
//     case the session IS alive, the caller just got an auth-rejected answer.
//
// Security notes:
//   - This wrapper never reads or writes cookies directly; the browser
//     automatically attaches pw_at/pw_rt to same-origin requests, and the
//     server sets fresh values via Set-Cookie headers on the refresh
//     response. Cookies stay HttpOnly + SameSite=lax (configured server-side).
//   - We do NOT perform any string interpolation of URL inputs into HTML, no
//     dangerouslySetInnerHTML, no eval. The wrapper is a thin pass-through
//     around fetch().
//   - Caller-provided onAuthFailed is responsible for redirecting the user
//     to the login page (e.g. router.push or window.location.assign). We do
//     not assume a navigation target here because the destination is
//     locale-dependent.

/**
 * Options for {@link authFetch}.
 *
 * @property onAuthFailed
 *   Invoked when a 401 cannot be rescued by refresh (refresh itself failed
 *   with a non-2xx status, or both the original and the retry are 401).
 *   Implementers typically redirect to the locale-aware login page and/or
 *   clear any client-side session state.
 */
export type AuthFetchOptions = {
  onAuthFailed?: () => void;
};

/**
 * Perform a fetch with automatic single-attempt 401 → refresh → retry.
 *
 * @param input     The fetch input (URL string or Request).
 * @param init      The fetch init options (method, headers, body, ...).
 * @param onAuthFailedOrOpts
 *   Backward-compatible positional argument: either an `onAuthFailed`
 *   callback, or an `AuthFetchOptions` object.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  onAuthFailedOrOpts?: (() => void) | AuthFetchOptions
): Promise<Response> {
  const onAuthFailed =
    typeof onAuthFailedOrOpts === "function"
      ? onAuthFailedOrOpts
      : onAuthFailedOrOpts?.onAuthFailed;

  // 1. Original attempt.
  const original = await fetch(input, init);

  // 2. Anything other than 401 is returned untouched. In particular, 403
  //    means "auth is fine, you just can't do this" — refreshing won't help.
  if (original.status !== 401) {
    return original;
  }

  // 3. Try to refresh the access token.
  let refreshOk = false;
  try {
    const refreshRes = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
    });
    refreshOk = refreshRes.ok;
  } catch {
    // Network error talking to the refresh endpoint — treat as failed.
    refreshOk = false;
  }

  if (!refreshOk) {
    // Could not renew the session. Notify the caller so it can redirect
    // (locale-aware) and/or clear local session state, then return the
    // original 401 to the caller unchanged.
    if (onAuthFailed) onAuthFailed();
    return original;
  }

  // 4. Single retry of the original request. We do NOT loop here — even if
  //    this retry also returns 401 (e.g. the user lacks permission or the
  //    endpoint is broken), we hand it back as-is. One refresh attempt per
  //    authFetch() call is the contract.
  return fetch(input, init);
}
