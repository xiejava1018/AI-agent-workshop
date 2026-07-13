import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, isSupportedLocale, type Locale } from "@/lib/i18n";

// M2.2 Task 2.1: root layout for the [locale] dynamic segment.
// The fork's top-level app/layout.tsx already renders <html>/<body>, so this
// nested layout must NOT repeat them - it only wraps children with the
// next-intl client provider (locale + messages loaded from messages/{locale}.json).
//
// Task 3.1-3.3 will add [locale]/{login,change-password,dashboard}/page.tsx
// inside this layout.

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

// Auth/i18n UI pages are interactive and must not be statically prerendered:
// next-intl resolves its server config during SSG, which this fork doesn't
// provide (messages come via NextIntlClientProvider, not i18n/request.ts).
// M2.2 Tasks 3.1-3.3: replaced generateStaticParams (which forced prerender
// and tripped the missing-config error) with force-dynamic so the [locale]
// routes render on demand.
export const dynamic = "force-dynamic";

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    notFound();
  }
  const messages = getMessages(locale as Locale);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
