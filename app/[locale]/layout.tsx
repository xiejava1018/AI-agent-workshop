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

// Pre-render the two supported locale roots. Unknown segments fall through
// to the isSupportedLocale guard below and 404.
export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh-CN" }];
}

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
