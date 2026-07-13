import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { AuthProvider, AuthenticatedUser } from "./auth-provider";
import { prisma } from "./prisma";

const JWT_SECRET = process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod";
const COST = 10;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(JWT_SECRET);
}

export class LocalPasswordAuthProvider implements AuthProvider {
  async authenticate(username: string, password: string): Promise<AuthenticatedUser> {
    let user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      // 首次自动注册（OpenSpec 行为：username 唯一即可自动创建）
      const hash = await bcrypt.hash(password, COST);
      user = await prisma.user.create({
        data: { username, passwordHash: hash },
      });
    } else {
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) throw new Error("invalid credentials");
    }
    return {
      id: user.id,
      username: user.username,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async signJwt(userId: string): Promise<string> {
    return await new SignJWT({ sub: userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secretKey());
  }

  async revoke(userId: string): Promise<void> {
    // M1: no-op; M2 will invalidate token in store
  }
}
