import { NextRequest, NextResponse } from "next/server";
import { getPasswordAuthProvider } from "@/lib/auth-provider";
import "@/lib/auth-provider-bootstrap"; // side-effect: registers LocalPasswordAuthProvider
import {
  validateLoginBody,
  INVALID_CREDENTIALS_MESSAGE,
} from "./validation";
import { auditLog } from "@/lib/audit-log";

const provider = getPasswordAuthProvider();

export async function POST(req: NextRequest) {
  // --- Parse JSON body ---
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid request body" },
      { status: 400 }
    );
  }

  // --- Input validation (pure helper, no DB access) ---
  const validated = validateLoginBody(raw);
  if (!validated.ok) {
    return NextResponse.json(validated.body, { status: validated.status });
  }

  try {
    const user = await provider.authenticate({
      username: validated.username,
      password: validated.password,
    });
    const accessToken = await provider.signAccessToken(user.userId);
    const refreshToken = await provider.signRefreshToken(user.userId);
    const res = NextResponse.json({
      id: user.userId,
      username: user.displayName,
      mustChangePassword: user.mustChangePassword,
    });
    res.cookies.set("pw_at", accessToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 15,
    });
    res.cookies.set("pw_rt", refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    void auditLog({
      userId: user.userId,
      action: "auth.login",
      resourceType: "user",
      resourceId: user.userId,
      metadata: { username: validated.username },
    });
    return res;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === INVALID_CREDENTIALS_MESSAGE) {
      void auditLog({
        userId: null,
        action: "auth.login_failed",
        resourceType: "user",
        metadata: { username: validated.username },
      });
      return NextResponse.json(
        { error: "invalid credentials" },
        { status: 401 }
      );
    }
    // Server-side error: log full context, return generic 500 so we never
    // leak DB / bcrypt internals to the client.
    console.error("[user-login] unexpected error", e);
    return NextResponse.json(
      { error: "internal server error" },
      { status: 500 }
    );
  }
}
