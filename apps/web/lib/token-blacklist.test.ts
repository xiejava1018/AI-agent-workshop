// lib/token-blacklist.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "./prisma";
import {
  revokeRefreshToken,
  isRefreshTokenRevoked,
  cleanupExpiredRefreshTokens,
} from "./token-blacklist";

const TEST_JTI_PREFIX = "test-jti-";

async function cleanTestRows(): Promise<void> {
  await prisma.refreshTokenBlacklist.deleteMany({
    where: { jti: { startsWith: TEST_JTI_PREFIX } },
  });
}

beforeEach(async () => {
  await cleanTestRows();
});

afterAll(async () => {
  await cleanTestRows();
  await prisma.$disconnect();
});

describe("token-blacklist", () => {
  describe("isRefreshTokenRevoked", () => {
    it("returns false for an unknown jti", async () => {
      const result = await isRefreshTokenRevoked(`${TEST_JTI_PREFIX}unknown-1`);
      expect(result).toBe(false);
    });

    it("returns true after a jti has been revoked", async () => {
      const jti = `${TEST_JTI_PREFIX}revoked-1`;
      const expiresAt = new Date(Date.now() + 60_000);
      await revokeRefreshToken(jti, expiresAt);
      const result = await isRefreshTokenRevoked(jti);
      expect(result).toBe(true);
    });

    it("is idempotent: revoking the same jti twice does not error", async () => {
      const jti = `${TEST_JTI_PREFIX}idempotent-1`;
      const expiresAt = new Date(Date.now() + 60_000);
      await revokeRefreshToken(jti, expiresAt);
      await expect(revokeRefreshToken(jti, expiresAt)).resolves.toBeUndefined();
      const result = await isRefreshTokenRevoked(jti);
      expect(result).toBe(true);
    });
  });

  describe("cleanupExpiredRefreshTokens", () => {
    it("deletes only rows whose expiresAt is in the past", async () => {
      const past = new Date(Date.now() - 60_000);
      const future = new Date(Date.now() + 60_000);
      await revokeRefreshToken(`${TEST_JTI_PREFIX}cleanup-past-1`, past);
      await revokeRefreshToken(`${TEST_JTI_PREFIX}cleanup-past-2`, past);
      await revokeRefreshToken(`${TEST_JTI_PREFIX}cleanup-future-1`, future);

      const deleted = await cleanupExpiredRefreshTokens();
      expect(deleted).toBe(2);

      // future row still present
      expect(
        await isRefreshTokenRevoked(`${TEST_JTI_PREFIX}cleanup-future-1`)
      ).toBe(true);
      // past rows gone
      expect(
        await isRefreshTokenRevoked(`${TEST_JTI_PREFIX}cleanup-past-1`)
      ).toBe(false);
      expect(
        await isRefreshTokenRevoked(`${TEST_JTI_PREFIX}cleanup-past-2`)
      ).toBe(false);
    });

    it("returns 0 when no expired rows exist", async () => {
      const future = new Date(Date.now() + 60_000);
      await revokeRefreshToken(`${TEST_JTI_PREFIX}no-expire-1`, future);
      const deleted = await cleanupExpiredRefreshTokens();
      expect(deleted).toBe(0);
    });

    it("respects an explicit `now` argument for boundary control", async () => {
      const expiresAt = new Date("2026-01-01T00:00:00.000Z");
      await revokeRefreshToken(`${TEST_JTI_PREFIX}boundary-1`, expiresAt);
      // exactly at expiresAt — should NOT be deleted (lt, not lte)
      const boundary = new Date("2026-01-01T00:00:00.000Z");
      const deleted = await cleanupExpiredRefreshTokens(boundary);
      expect(deleted).toBe(0);
      // one ms past — should be deleted
      const past = new Date("2026-01-01T00:00:00.001Z");
      const deleted2 = await cleanupExpiredRefreshTokens(past);
      expect(deleted2).toBe(1);
    });
  });
});
