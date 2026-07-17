/**
 * lib/secret-crypto.test.ts
 *
 * Task 4.4 — AES-256-GCM envelope round-trip + tamper/config-guard tests.
 */

import { describe, it, expect, beforeAll } from "vitest";

// 32-byte (64 hex char) test master key.
const TEST_KEY = "0".repeat(64);

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = TEST_KEY;
});

describe("secret-crypto", () => {
  it("round-trips plaintext through encrypt/decrypt", async () => {
    const { encryptSecret, decryptSecret } = await import("./secret-crypto");
    const plaintext = "sk-live-abc123-secret-value";
    const enc = encryptSecret(plaintext);
    expect(enc).not.toContain(plaintext);
    expect(enc.split(":").length).toBe(3);
    expect(decryptSecret(enc)).toBe(plaintext);
  });

  it("produces distinct ciphertexts for identical plaintext (random IV)", async () => {
    const { encryptSecret } = await import("./secret-crypto");
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
  });

  it("throws on a tampered auth tag", async () => {
    const { encryptSecret, decryptSecret } = await import("./secret-crypto");
    const enc = encryptSecret("tamper-me");
    const [iv, tag, ct] = enc.split(":");
    // Flip a hex char in the auth tag.
    const flipped = tag[0] === "0" ? `1${tag.slice(1)}` : `0${tag.slice(1)}`;
    expect(() => decryptSecret(`${iv}:${flipped}:${ct}`)).toThrow();
  });

  it("throws on a malformed envelope", async () => {
    const { decryptSecret } = await import("./secret-crypto");
    expect(() => decryptSecret("not-a-valid-envelope")).toThrow();
  });

  it("throws when APP_ENCRYPTION_KEY is missing", async () => {
    const prev = process.env.APP_ENCRYPTION_KEY;
    delete process.env.APP_ENCRYPTION_KEY;
    try {
      const { encryptSecret } = await import("./secret-crypto");
      expect(() => encryptSecret("x")).toThrow(/APP_ENCRYPTION_KEY/);
    } finally {
      process.env.APP_ENCRYPTION_KEY = prev;
    }
  });

  it("throws when APP_ENCRYPTION_KEY is not 32 bytes", async () => {
    const prev = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = "abcd"; // 2 bytes
    try {
      const { encryptSecret } = await import("./secret-crypto");
      expect(() => encryptSecret("x")).toThrow(/32 bytes/);
    } finally {
      process.env.APP_ENCRYPTION_KEY = prev;
    }
  });

  it("generateEncryptionKey produces a valid 32-byte hex key usable as master key", async () => {
    const { generateEncryptionKey, encryptSecret, decryptSecret } =
      await import("./secret-crypto");
    const key = generateEncryptionKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(key, "hex").length).toBe(32);

    // A freshly generated key must round-trip a secret end-to-end.
    const prev = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = key;
    try {
      const enc = encryptSecret("generated-key-secret");
      expect(decryptSecret(enc)).toBe("generated-key-secret");
    } finally {
      process.env.APP_ENCRYPTION_KEY = prev;
    }
  });

  it("generateEncryptionKey returns a distinct key each call", async () => {
    const { generateEncryptionKey } = await import("./secret-crypto");
    expect(generateEncryptionKey()).not.toBe(generateEncryptionKey());
  });
});
