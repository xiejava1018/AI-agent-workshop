// M1: minimal next-intl wiring — exposes a typed loader for messages
// keyed by locale. Full app/[locale]/layout wiring is M2.
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

export type Locale = "en" | "zh-CN";
export const SUPPORTED_LOCALES: Locale[] = ["en", "zh-CN"];
export const DEFAULT_LOCALE: Locale = "en";

const MESSAGES: Record<Locale, Record<string, unknown>> = {
  en: enMessages,
  "zh-CN": zhMessages,
};

export function getMessages(locale: Locale = DEFAULT_LOCALE): Record<string, unknown> {
  return MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
}

// Tiny dot-path lookup: t("login.title", "en") -> "Sign in"
export function t(key: string, locale: Locale = DEFAULT_LOCALE): string {
  const parts = key.split(".");
  let cur: unknown = getMessages(locale);
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key; // missing key — return the key itself for visibility
    }
  }
  return typeof cur === "string" ? cur : key;
}
