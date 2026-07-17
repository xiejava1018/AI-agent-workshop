import { redirect } from "next/navigation";
import { DEFAULT_LOCALE } from "@/lib/i18n";

// M2.2 follow-up: redirect the bare / path to the default locale's
// home page, which now mounts the fork's AppShell (chat UI).
// This ensures:
// 1. Users land on /en (or /zh-CN), not the bare / which would
//    bypass the [locale] layout and the mustChangePassword gate.
// 2. The fork's AppShell is reachable under the [locale] prefix.
export default function RootRedirect() {
  redirect(`/${DEFAULT_LOCALE}`);
}
