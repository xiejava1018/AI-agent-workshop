"use client";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { authFetch } from "@/lib/client-fetch";

// Auth forms are inherently interactive (credentials entry + server round-trip),
// so skip static prerender. Without this, Next.js attempts to SSG the page and
// next-intl looks for an i18n/request.ts server config that this fork does not
// provide (messages are supplied via NextIntlClientProvider in the layout).
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const t = useTranslations("login");
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale || "en";
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/user-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: fd.get("username"),
        password: fd.get("password"),
      }),
    });
    if (!res.ok) {
      setError(t("error"));
      return;
    }
    const body = await res.json();

    // M2.3 Task 5.1: verify the freshly-issued session with one authenticated
    // call. If the access token happens to be stale (clock skew, race with
    // refresh rotation, etc.) authFetch transparently retries via
    // /api/auth/refresh. If refresh itself fails, we land back on the login
    // page — the user just re-authenticates.
    //
    // Using a light read-only authenticated endpoint keeps the verification
    // cheap. /api/projects is gated by middleware and returns 200 + an empty
    // array for users with no team memberships.
    try {
      await authFetch(
        "/api/projects",
        { method: "GET", credentials: "same-origin" },
        () => {
          // Refresh failed — bounce back to this same login page. No state to
          // clear client-side; the server already cleared pw_at / pw_rt via
          // Set-Cookie maxAge=0 on the refresh 401 response.
          router.replace(`/${locale}/login`);
        }
      );
    } catch {
      // Network error talking to /api/projects after a successful login is
      // unusual but recoverable — fall through to the same redirect so the
      // user can retry from a known-good page.
      router.replace(`/${locale}/login`);
      return;
    }

    // Redirect under the current [locale] segment. /<locale> mounts the full
    // chat AppShell (SessionSidebar + ChatWindow + FileExplorer + …). The
    // dashboard page is the M2.2 admin-only summary view, not the user's
    // home — preserve the spec's change-password gate, but otherwise send
    // everyone straight to /<locale>, not /<locale>/dashboard.
    router.push(body.mustChangePassword ? `/${locale}/change-password` : `/${locale}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm mx-auto mt-20 p-6 border rounded">
      <h1 className="text-2xl mb-4">{t("title")}</h1>
      <div className="mb-4">
        <label className="block mb-1">{t("username")}</label>
        <input name="username" required className="w-full border rounded px-2 py-1" />
      </div>
      <div className="mb-4">
        <label className="block mb-1">{t("password")}</label>
        <input name="password" type="password" required className="w-full border rounded px-2 py-1" />
      </div>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <button type="submit" className="w-full bg-blue-600 text-white rounded py-2">
        {t("submit")}
      </button>
    </form>
  );
}
