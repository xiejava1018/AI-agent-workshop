import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";

// M2.2 follow-up: the root path / resolves to app/page.tsx which
// renders AppShell (the fork's chat UI). To make the chat UI
// accessible under the [locale] segment — and to avoid the M2.2
// middleware's 401 interception on the bare / path — this page
// mounts AppShell inside the [locale] layout (which already provides
// the IntlProvider + mustChangePassword gate context). Fork's
// SessionSidebar (Task 3.1) and AppShell are unchanged.
//
// Note: AppShell is a client component. It calls /api/* endpoints
// directly; the M2.2 middleware's x-must-change-password gate will
// 403 any /api/* call (except auth routes) if the user hasn't
// changed their password yet. This is the intended M2.2 contract —
// users must change password before using the chat.
export default function LocaleHome() {
  return (
    <Suspense>
      <AppShell />
    </Suspense>
  );
}
