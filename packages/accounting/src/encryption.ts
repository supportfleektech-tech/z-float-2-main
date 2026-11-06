/**
 * Token encryption utilities for accounting connections.
 * Uses AES-256-GCM with the ENCRYPTION_KEY from config.
 */
import { getConfig } from "@zfloat/config";

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

let cachedKey: CryptoKey | null = null;

/** Get or derive the encryption key from config */
async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const config = getConfig();
  const keyHex = config.ENCRYPTION_KEY;
  const keyData = Buffer.from(keyHex, "hex");

  if (keyData.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (64 hex chars)`);
  }

  cachedKey = await crypto.subtle.importKey("raw", keyData, { name: ALGORITHM }, false, [
    "encrypt",
    "decrypt",
  ]);
  return cachedKey;
}

/** Encrypt a string token */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    data,
  );

  // Combine IV + ciphertext + auth tag
  const encryptedArray = new Uint8Array(encrypted);
  const combined = new Uint8Array(IV_LENGTH + encryptedArray.length);
  combined.set(iv, 0);
  combined.set(encryptedArray, IV_LENGTH);

  return Buffer.from(combined).toString("base64");
}

/** Decrypt a token */
export async function decryptToken(encryptedBase64: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = Buffer.from(encryptedBase64, "base64");

  if (combined.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid encrypted token format");
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext,
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/** Encrypt tokens for storage */
export async function encryptTokens(
  accessToken: string,
  refreshToken?: string,
): Promise<{ accessTokenEncrypted: string; refreshTokenEncrypted?: string }> {
  const accessTokenEncrypted = await encryptToken(accessToken);
  let refreshTokenEncrypted: string | undefined;
  if (refreshToken) {
    refreshTokenEncrypted = await encryptToken(refreshToken);
  }
  return { accessTokenEncrypted, refreshTokenEncrypted };
}

/** Decrypt tokens for use */
export async function decryptTokens(
  accessTokenEncrypted: string,
  refreshTokenEncrypted?: string,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const accessToken = await decryptToken(accessTokenEncrypted);
  let refreshToken: string | undefined;
  if (refreshTokenEncrypted) {
    refreshToken = await decryptToken(refreshTokenEncrypted);
  }
  return { accessToken, refreshToken };
}