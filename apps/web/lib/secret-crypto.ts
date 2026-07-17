/**
 * lib/secret-crypto.ts
 *
 * Canonical AES-256-GCM envelope encryption for at-rest secrets — MCP server
 * configs, platform API keys, and user (BYOK) API keys all encrypt/decrypt
 * through this single module. The cipher format is
 * `<iv-hex>:<authTag-hex>:<ciphertext-hex>`; ciphertext produced by
 * `encryptSecret` is decryptable by `decryptSecret` and vice versa, and the
 * BYOK read path (`rpc-manager.loadUserApiKeys`) routes through `decryptSecret`
 * so there is exactly one envelope format in the codebase.
 *
 * The master key comes from the `APP_ENCRYPTION_KEY` env var: a 64-char hex
 * string decoding to exactly 32 bytes. A misconfigured deploy throws so it
 * fails closed rather than silently storing weak or plaintext data. Generate a
 * valid key with `generateEncryptionKey()` (or `openssl rand -hex 32`).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/** GCM standard nonce length in bytes. */
const IV_BYTES = 12;

/** AES-256 key length in bytes (256 bits). */
const KEY_BYTES = 32;

/**
 * Generate a fresh, cryptographically random master key suitable for
 * `APP_ENCRYPTION_KEY`: a 64-char hex string decoding to exactly 32 bytes.
 * Use this once per environment (dev / staging / prod) and store the result
 * in the deploy's secret manager — never commit it. Equivalent shell command:
 * `openssl rand -hex 32`.
 */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString("hex");
}

/**
 * Resolve and validate the 32-byte master key from `APP_ENCRYPTION_KEY`.
 * Throws when the env var is missing or does not decode to 32 bytes.
 */
function getMasterKey(): Buffer {
  const masterKeyHex = process.env.APP_ENCRYPTION_KEY;
  if (!masterKeyHex) {
    throw new Error(
      "APP_ENCRYPTION_KEY env var is required to encrypt/decrypt API keys",
    );
  }
  const masterKey = Buffer.from(masterKeyHex, "hex");
  if (masterKey.length !== KEY_BYTES) {
    throw new Error(
      `APP_ENCRYPTION_KEY must decode to 32 bytes (got ${masterKey.length})`,
    );
  }
  return masterKey;
}

/**
 * Encrypt a plaintext secret into the `<iv>:<authTag>:<ciphertext>` envelope.
 * A fresh random IV is generated per call so identical plaintexts produce
 * distinct ciphertexts.
 */
export function encryptSecret(plaintext: string): string {
  const masterKey = getMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypt a `<iv>:<authTag>:<ciphertext>` envelope back to plaintext. Throws
 * on any decode / auth-tag failure so tampered or corrupt data never passes
 * through as a valid secret.
 */
export function decryptSecret(secretEnc: string): string {
  const masterKey = getMasterKey();
  const parts = secretEnc.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "secretEnc must be `<iv-hex>:<authTag-hex>:<ciphertext-hex>`",
    );
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
