import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { PasswordAuthProvider, AuthenticatedUser } from "./auth-provider";
import { prisma } from "./prisma";

const JWT_SECRET = process.env.PI_WEB_JWT_SECRET || "m1-dev-secret-rotate-in-prod";
const COST = 10;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(JWT_SECRET);
}

function randomJti(): string {
  return crypto.randomUUID();
}

export class LocalPasswordAuthProvider implements PasswordAuthProvider {
  async authenticate(credential: { username: string; password: string }): Promise<AuthenticatedUser> {
    const user = await prisma.user.findUnique({ where: { username: credential.username } });
    if (!user) {
      throw new Error("invalid credentials");
    }
    const ok = await bcrypt.compare(credential.password, user.passwordHash);
    if (!ok) throw new Error("invalid credentials");
    return {
      userId: user.id,
      displayName: user.username,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async signAccessToken(userId: string): Promise<string> {
    return await new SignJWT({ sub: userId, type: "access", jti: randomJti() })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secretKey());
  }

  async signRefreshToken(userId: string): Promise<string> {
    return await new SignJWT({ sub: userId, type: "refresh", jti: randomJti() })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(secretKey());
  }

  async revoke(userId: string): Promise<void> {
    // M2.3: no-op at provider level; token revocation is handled by RefreshTokenBlacklist.
  }
}
