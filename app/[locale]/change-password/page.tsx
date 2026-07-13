"use client";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

// Auth forms are inherently interactive, so skip static prerender. Without
// this, Next.js attempts to SSG the page and next-intl looks for an
// i18n/request.ts server config that this fork does not provide.
export const dynamic = "force-dynamic";

export default function ChangePasswordPage() {
  const t = useTranslations("changePassword");
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale || "en";
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const newPassword = fd.get("newPassword");
    const confirm = fd.get("confirm");

    if (newPassword !== confirm) {
      setError(t("tooShort"));
      return;
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      setError(t("tooShort"));
      return;
    }

    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
    if (!res.ok) {
      setError(t("tooShort"));
      return;
    }
    // Redirect under the current [locale] segment
    router.push(`/${locale}/dashboard`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm mx-auto mt-20 p-6 border rounded">
      <h1 className="text-2xl mb-4">{t("title")}</h1>
      <div className="mb-4">
        <label className="block mb-1">{t("newPassword")}</label>
        <input name="newPassword" type="password" required minLength={8} className="w-full border rounded px-2 py-1" />
      </div>
      <div className="mb-4">
        <label className="block mb-1">{t("confirm")}</label>
        <input name="confirm" type="password" required minLength={8} className="w-full border rounded px-2 py-1" />
      </div>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <button type="submit" className="w-full bg-blue-600 text-white rounded py-2">
        {t("submit")}
      </button>
    </form>
  );
}
