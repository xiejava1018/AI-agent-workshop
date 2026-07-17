// lib/prisma.test.ts
import { describe, it, expect } from "vitest";
import { prisma } from "./prisma";

describe("prisma singleton", () => {
  it("connects to PostgreSQL database", async () => {
    const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
    expect(result.length).toBeGreaterThan(0);
    // PostgreSQL returns integer literals as JS number (not BigInt like SQLite).
    expect(result[0].ok).toBe(1);
  });
  it("reuses same instance across imports", async () => {
    // The singleton memoizes on globalThis.__prisma (non-prod). A freshly
    // imported module must therefore return the very same client instance.
    // Dynamic import() is used because vitest v4 runs in ESM mode (no require).
    const mod = await import("./prisma");
    expect(mod.prisma).toBe(prisma);
    // The global stash is the source of truth for cross-module reuse.
    expect(globalThis.__prisma).toBe(prisma);
  });
  it("cleans up on disconnect", async () => {
    await prisma.$disconnect();
    // Reconnect for any later tests
    await prisma.$connect();
  });
});
