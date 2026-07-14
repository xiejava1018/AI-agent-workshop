// lib/token-blacklist.ts
import { prisma } from "./prisma";

/**
 * 把一个 refresh token 的 jti 标记为已撤销。幂等: 重复写入同一 jti 不报错。
 *
 * @param jti JWT 中的 jti claim, 全局唯一
 * @param expiresAt 该 refresh token 的过期时间 (用于后续清理)
 */
export async function revokeRefreshToken(
  jti: string,
  expiresAt: Date
): Promise<void> {
  await prisma.refreshTokenBlacklist.upsert({
    where: { jti },
    create: { jti, expiresAt },
    update: { expiresAt },
  });
}

/**
 * 检查一个 jti 是否已被撤销。未知 jti 返回 false。
 */
export async function isRefreshTokenRevoked(jti: string): Promise<boolean> {
  const row = await prisma.refreshTokenBlacklist.findUnique({
    where: { jti },
    select: { jti: true },
  });
  return row !== null;
}

/**
 * 删除所有 expiresAt < now 的行 (refresh token 自身已过期, 黑名单记录可释放)。
 *
 * @returns 被删除的行数
 */
export async function cleanupExpiredRefreshTokens(
  now: Date = new Date()
): Promise<number> {
  const result = await prisma.refreshTokenBlacklist.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return result.count;
}
