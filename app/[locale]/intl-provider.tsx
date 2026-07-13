"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

// Client-side wrapper for next-intl's NextIntlClientProvider. Required
// because next-intl v4's server-side provider expects an i18n/request.ts
// config file that this fork deliberately omits (messages are loaded
// directly from messages/{locale}.json via lib/i18n.ts). Wrapping the
// provider in a client component keeps the import out of the server tree
// so the missing-config error never fires.
//
// The server layout still resolves the locale + messages via lib/i18n.ts
// and passes them as plain serializable props to this client component.
export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Record<string, unknown>;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
