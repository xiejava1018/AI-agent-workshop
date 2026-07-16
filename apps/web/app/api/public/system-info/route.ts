// app/api/public/system-info/route.ts
//
// Public system info (no auth required). Used by the Vue dashboard's systemStore
// to populate the browser title / login page / top bar / about dialog.

import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    system_name: "AI-agent-workshop",
    system_logo: "",
    system_copyright: "© 2026 AI-agent-workshop",
    system_description: "Multi-tenant AI coding agent workshop",
    allowed_hosts: "all",
  });
}
