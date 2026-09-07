/**
 * Password hashing & verification — Node's built-in scrypt (memory-hard,
 * salted, constant-time compare). No third-party crypto dependencies.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const KEYLEN = 64;
const SCRYPT_PARAMS = "n=16384,r=8,p=1"; // ~64MB memory — production-grade default

export interface PasswordHash {
  params: string;
  salt: string; // hex
  hash: string; // hex
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN);
  const record: PasswordHash = { params: SCRYPT_PARAMS, salt: salt.toString("hex"), hash: hash.toString("hex") };
  return `${record.params}$${record.salt}$${record.hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [params = "", saltHex = "", hashHex = ""] = stored.split("$");
  if (!params || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Password strength check (used by signup + admin creation). */
export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 12) issues.push("At least 12 characters");
  if (!/[a-z]/.test(password)) issues.push("A lowercase letter");
  if (!/[A-Z]/.test(password)) issues.push("An uppercase letter");
  if (!/[0-9]/.test(password)) issues.push("A number");
  if (!/[^A-Za-z0-9]/.test(password)) issues.push("A symbol");
  return issues;
}
