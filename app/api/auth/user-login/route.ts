import { NextRequest, NextResponse } from "next/server";
import { getAuthProvider } from "@/lib/auth-provider";
import "@/lib/auth-provider-bootstrap"; // side-effect: registers LocalPasswordAuthProvider

const provider = getAuthProvider();

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: "missing credentials" }, { status: 400 });
  }
  try {
    const user = await provider.authenticate(username, password);
    const jwt = await provider.signJwt(user.id);
    const res = NextResponse.json({
      id: user.id,
      username: user.username,
      mustChangePassword: user.mustChangePassword,
    });
    res.cookies.set("pw_at", jwt, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 15,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
}