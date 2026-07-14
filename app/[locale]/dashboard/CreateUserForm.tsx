"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

// Task 5.2: admin create-user form rendered on the dashboard for OWNER/ADMIN
// roles. Posts to /api/admin/users (already gated by DB role check) and
// displays the one-shot initial password in copyable text so the admin can
// hand it to the new user.
//
// Locale placeholder strings are supplied via next-intl's useTranslations
// (matching the convention used by login/change-password pages). The
// client component is isolated from server-only modules; auth gating
// happens server-side in the API route.
export default function CreateUserForm() {
  const t = useTranslations("dashboard.createUser");
  const [username, setUsername] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdUsername, setCreatedUsername] = useState<string | null>(null);
  const [initialPassword, setInitialPassword] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);
    setCreatedUsername(null);
    setInitialPassword(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      if (!res.ok) {
        // Surface the server's error message verbatim when present,
        // otherwise fall back to the HTTP status text.
        let detail = res.statusText || "request failed";
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) detail = data.error;
        } catch {
          // body was not JSON — keep the statusText fallback
        }
        setErrorMessage(detail);
        return;
      }

      const data = (await res.json()) as {
        username: string;
        initialPassword: string;
      };
      setCreatedUsername(data.username);
      setInitialPassword(data.initialPassword);
      setUsername("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "network error";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mt-6 p-4 border rounded">
      <h2 className="text-xl mb-2">{t("title")}</h2>
      <form onSubmit={onSubmit}>
        <div className="mb-3">
          <label className="block mb-1" htmlFor="create-user-username">
            {t("usernameLabel")}
          </label>
          <input
            id="create-user-username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("usernamePlaceholder")}
            required
            minLength={1}
            disabled={isSubmitting}
            className="w-full border rounded px-2 py-1"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting || username.trim().length === 0}
          className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50"
        >
          {isSubmitting ? "…" : t("submit")}
        </button>
      </form>

      {createdUsername && initialPassword && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded">
          <p className="text-green-800">
            {t("success", { username: createdUsername })}
          </p>
          <p className="text-green-800">
            {t("initialPassword", { password: initialPassword })}
          </p>
        </div>
      )}

      {errorMessage && (
        <p className="mt-3 text-red-600">
          {t("error", { message: errorMessage })}
        </p>
      )}
    </section>
  );
}
