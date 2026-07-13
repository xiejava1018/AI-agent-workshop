import { NextRequest, NextResponse } from "next/server";
import { LocalPasswordAuthProvider } from "@/lib/auth-provider-local";

const provider = new LocalPasswordAuthProvider();

export async function POST(req: NextRequest) {
  // userId 从 cookie 拿不到时静默清 cookie（M1: 无 revoke 表）
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("pw_at");
  return res;
}