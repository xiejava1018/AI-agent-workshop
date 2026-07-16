/**
 * lib/secret-crypto.ts
 *
 * AES-256-GCM envelope encryption for at-rest secrets (platform + user API
 * keys). The cipher format is `<iv-hex>:<authTag-hex>:<ciphertext-hex>` — the
 * same envelope `rpc-manager.decryptUserApiKey` already reads, so ciphertext
 * produced here is interchangeable with the BYOK decrypt path.
 *
 * The master key comes from the `APP_ENCRYPTION_KEY` env var: a 64-char hex
 * string decoding to exactly 32 bytes. A misconfigured deploy throws so it
 * fails closed rather than silently storing weak or plaintext data.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/** GCM standard nonce length in bytes. */
const IV_BYTES = 12;

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
  if (masterKey.length !== 32) {
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
