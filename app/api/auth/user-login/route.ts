import { NextRequest, NextResponse } from "next/server";
import { getPasswordAuthProvider } from "@/lib/auth-provider";
import "@/lib/auth-provider-bootstrap"; // side-effect: registers LocalPasswordAuthProvider

const provider = getPasswordAuthProvider();

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: "missing credentials" }, { status: 400 });
  }
  try {
    const user = await provider.authenticate({ username, password });
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
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
}
