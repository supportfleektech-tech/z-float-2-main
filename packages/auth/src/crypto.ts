/**
 * Field-level encryption for stored secrets (MFA secrets, provider
 * credentials) using AES-256-GCM with the ENCRYPTION_KEY from config.
 * Format: v1:<iv-hex>:<ciphertext-hex>
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getConfig } from "@zfloat/config";

function keyBytes(): Buffer {
  const hex = getConfig().ENCRYPTION_KEY;
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const [version = "", ivHex = "", tagHex = "", dataHex = ""] = stored.split(":");
  if (version !== "v1" || !ivHex || !tagHex || !dataHex) {
    throw new Error("Unsupported or malformed encrypted value");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

/** Mask sensitive values for logs/UI (e.g. "****last4"). */
export function maskSecret(value: string | undefined, keep = 4): string {
  if (!value) return "";
  if (value.length <= keep) return "*".repeat(value.length);
  return "*".repeat(Math.max(4, value.length - keep)) + value.slice(-keep);
}
