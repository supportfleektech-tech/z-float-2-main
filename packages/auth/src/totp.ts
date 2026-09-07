/**
 * TOTP (RFC 6238) — dependency-free implementation on node:crypto.
 * 6-digit codes, 30-second period, SHA-1 (interop with authenticator apps).
 */
import { createHmac, randomBytes } from "node:crypto";

const PERIOD = 30;
const DIGITS = 6;

function base32Encode(buffer: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTOTPSecret(): string {
  return base32Encode(randomBytes(20)); // 160-bit secret
}

export function totpUri(secret: string, account: string, issuer = "Z-float"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&period=${PERIOD}&digits=${DIGITS}`;
}

export function totpCode(secret: string, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / PERIOD);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** Verify a code within ±1 time window (allows clock drift). */
export function verifyTOTP(secret: string, code: string, at = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  for (let w = -1; w <= 1; w++) {
    if (totpCode(secret, at + w * PERIOD * 1000) === code) return true;
  }
  return false;
}
