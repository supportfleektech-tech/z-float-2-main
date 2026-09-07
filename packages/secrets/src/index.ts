/**
 * @zfloat/secrets — platform secret vault (Batch C2: "KMS-backed secret
 * management instead of env vars").
 *
 * Resolution order per secret name:
 *   1. explicit environment variable (highest precedence — local-dev fallback
 *      and emergency override),
 *   2. envelope file at `${SECRETS_DIR}/${NAME}.json` (AES-256-GCM),
 *      key-wrapped by either:
 *        - the `local` driver: a 64-hex key from SECRETS_LOCAL_KEY
 *          (dev/staging only — never production), or
 *        - the `kms` driver: an AWS KMS key (SECRETS_KMS_KEY_ID) that wraps a
 *          per-secret 256-bit data key (true envelope encryption),
 *   3. absent → the caller keeps its built-in default / fails config load as
 *      it does today (production loadConfig already refuses insecure
 *      SESSION_SECRET/ENCRYPTION_KEY).
 *
 * Secrets are applied to process.env ONCE, at process startup
 * (`applySecretsToEnv`), before config validation — so every existing
 * `getConfig()`/`process.env` consumer keeps working unchanged.
 *
 * Envelope file format (v1):
 *   {
 *     "name": "MPESA_CONSUMER_SECRET",
 *     "v": 1,
 *     "keyWrap": "local" | "kms",
 *     "keyRef": "local" | <KMS key id/arn>,       // provenance
 *     "wrappedKey": "<base64, kms only>",
 *     "iv": "<base64 12B>",
 *     "tag": "<base64 16B>",
 *     "data": "<base64 ciphertext>",
 *     "createdAt": "<ISO>",
 *     "comment": "<optional rotation note>"
 *   }
 *
 * Plaintext is never persisted. Envelope files are safe to commit to a
 * deployment volume / K8s secret; the KMS key id is not itself a secret.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
// NOTE: the AWS SDK is imported lazily inside the kms functions — the vault
// module is also loaded by the web app's edge runtime bundle (instrumentation
// guard), which must never include the SDK.

/* ------------------------------------------------------------------ types */

export type SecretsDriver = "none" | "local" | "kms";

export interface SecretsSummary {
  driver: SecretsDriver;
  /** Secrets decrypted from envelope files and applied to the environment. */
  applied: string[];
  /** Secrets left untouched because an explicit env value was already set. */
  envOverride: string[];
  /** Secrets with neither an env value nor an envelope file (still unset). */
  notFound: string[];
  /** Envelope files that could not be decrypted (empty unless error thrown). */
  errors: string[];
}

export interface ApplySecretsOptions {
  /** Defaults to process.env — pass a plain object in tests. */
  env?: Record<string, string | undefined>;
  /** Defaults to SECRETS_DIR env var, else ./data/secrets. */
  secretsDir?: string;
  /** Override SECRETS_DRIVER (used by tests). */
  driver?: SecretsDriver;
  /** Override SECRETS_LOCAL_KEY (used by tests). */
  localKey?: string;
}

export class SecretsError extends Error {
  constructor(
    message: string,
    readonly code:
      | "BAD_ENVELOPE"
      | "AUTH_TAG_MISMATCH"
      | "LOCAL_KEY_MISSING"
      | "KMS_DECRYPT_FAILED"
      | "KMS_WRAP_FAILED"
      | "UNSUPPORTED_WRAP",
  ) {
    super(message);
    this.name = "SecretsError";
  }
}

/* ------------------------------------------------------- registry of names */

/** Platform secret env names that the vault can back. */
export const SECRET_NAMES = [
  "SESSION_SECRET",
  "ENCRYPTION_KEY",
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "MPESA_PASSKEY",
  "MPESA_B2C_SECURITY_CREDENTIAL",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "SMTP_USER",
  "SMTP_PASS",
  "SMS_API_KEY",
  "BANK_API_KEY",
  "BANK_API_SECRET",
  "AIRTIME_API_KEY",
] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

/** Values that must never be trusted from env (dev defaults leaking to prod). */
export function isInsecureDefault(name: string, value: string | undefined): boolean {
  if (!value || value.length === 0) return true;
  if (name === "SESSION_SECRET") {
    return (
      value.startsWith("dev-only") ||
      value === "change-me-32+bytes-of-cryptographic-random"
    );
  }
  if (name === "ENCRYPTION_KEY") return /^0+$/.test(value);
  return false;
}

/* ------------------------------------------------------------- key helpers */

/** 64 hex chars (32 bytes) — SECRETS_LOCAL_KEY format. */
export function generateLocalKeyHex(): string {
  return randomBytes(32).toString("hex");
}

/** Fingerprint shown in logs/tooling (never the key itself). */
export function keyFingerprint(keyHex: string): string {
  return createHash("sha256").update(keyHex).digest("hex").slice(0, 12);
}

/* -------------------------------------------------------- envelope writers */

export interface EnvelopeRecord {
  name: string;
  v: 1;
  keyWrap: "local" | "kms";
  keyRef: string;
  wrappedKey?: string;
  iv: string;
  tag: string;
  data: string;
  createdAt: string;
  comment?: string;
}

function envelopePath(dir: string, name: string): string {
  return path.join(dir, `${name}.json`);
}

/** Write a `local`-wrapped envelope (SECRETS_LOCAL_KEY) for a secret value. */
export function writeLocalEnvelope(opts: {
  name: string;
  value: string;
  dir: string;
  keyHex: string;
  comment?: string;
}): string {
  const { name, value, dir, keyHex, comment } = opts;
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new SecretsError(
      `SECRETS_LOCAL_KEY must be 32 bytes (64 hex chars), got ${key.length * 2} chars`,
      "LOCAL_KEY_MISSING",
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const record: EnvelopeRecord = {
    name,
    v: 1,
    keyWrap: "local",
    keyRef: "local",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: data.toString("base64"),
    createdAt: new Date().toISOString(),
    comment,
  };
  mkdirSync(dir, { recursive: true });
  const file = envelopePath(dir, name);
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  return file;
}

/** Write a KMS-wrapped envelope (true envelope encryption) — requires AWS creds. */
export async function writeKmsEnvelope(opts: {
  name: string;
  value: string;
  dir: string;
  kmsKeyId: string;
  comment?: string;
}): Promise<string> {
  const { name, value, dir, kmsKeyId, comment } = opts;
  const { KMSClient, EncryptCommand } = await import("@aws-sdk/client-kms");
  const kms = new KMSClient({});
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrap = await kms.send(
    new EncryptCommand({ KeyId: kmsKeyId, Plaintext: dataKey }),
  );
  if (!wrap.CiphertextBlob) {
    throw new SecretsError(`KMS Encrypt returned no ciphertext for ${name}`, "KMS_WRAP_FAILED");
  }
  const record: EnvelopeRecord = {
    name,
    v: 1,
    keyWrap: "kms",
    keyRef: kmsKeyId,
    wrappedKey: Buffer.from(wrap.CiphertextBlob).toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: data.toString("base64"),
    createdAt: new Date().toISOString(),
    comment,
  };
  mkdirSync(dir, { recursive: true });
  const file = envelopePath(dir, name);
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  return file;
}

/* ----------------------------------------------------------- decryptors */

function decryptLocal(record: EnvelopeRecord, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new SecretsError(
      `SECRETS_LOCAL_KEY must be 32 bytes (64 hex chars), got ${key.length * 2} chars`,
      "LOCAL_KEY_MISSING",
    );
  }
  return decryptAesGcm(record, key);
}

function decryptAesGcm(record: EnvelopeRecord, key: Buffer): string {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(record.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(record.data, "base64")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    // node crypto throws on tag mismatch — re-surface as our error
    throw new SecretsError(
      `envelope ${record.name}: decryption failed (wrong key or tampered file)`,
      "AUTH_TAG_MISMATCH",
    );
  }
}

let kmsClient: import("@aws-sdk/client-kms").KMSClient | null = null;

async function decryptKms(record: EnvelopeRecord): Promise<string> {
  if (!record.wrappedKey) {
    throw new SecretsError(`envelope ${record.name} (kms) has no wrappedKey`, "BAD_ENVELOPE");
  }
  try {
    const { KMSClient, DecryptCommand } = await import("@aws-sdk/client-kms");
    kmsClient ??= new KMSClient({});
    const res = await kmsClient.send(
      new DecryptCommand({ CiphertextBlob: Buffer.from(record.wrappedKey, "base64") }),
    );
    if (!res.Plaintext) throw new Error("empty plaintext");
    return decryptAesGcm(record, Buffer.from(res.Plaintext));
  } catch (err) {
    throw new SecretsError(
      `envelope ${record.name}: KMS unwrap failed — ${(err as Error).message}`,
      "KMS_DECRYPT_FAILED",
    );
  }
}

async function readEnvelope(dir: string, name: string): Promise<EnvelopeRecord | null> {
  const file = envelopePath(dir, name);
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new SecretsError(`envelope ${file}: not valid JSON`, "BAD_ENVELOPE");
  }
  const rec = raw as EnvelopeRecord;
  if (rec.name !== name || rec.v !== 1) {
    throw new SecretsError(
      `envelope ${file}: name/version mismatch (expected ${name} v1)`,
      "BAD_ENVELOPE",
    );
  }
  if (rec.keyWrap !== "local" && rec.keyWrap !== "kms") {
    throw new SecretsError(
      `envelope ${file}: unsupported keyWrap "${rec.keyWrap}"`,
      "UNSUPPORTED_WRAP",
    );
  }
  return rec;
}

/* --------------------------------------------------------- apply to env */

/**
 * Resolve every platform secret and fill gaps in `env` (env vars win).
 * Call once at process startup, before config validation/adapters are built.
 * Throws on malformed envelopes or KMS failures — fail closed, never run
 * production on silently-missing secrets.
 */
export async function applySecretsToEnv(
  options: ApplySecretsOptions = {},
): Promise<SecretsSummary> {
  const env = options.env ?? process.env;
  const driver: SecretsDriver = options.driver ?? (env["SECRETS_DRIVER"] as SecretsDriver) ?? "none";
  const secretsDir = options.secretsDir ?? env["SECRETS_DIR"] ?? "./data/secrets";
  const localKey = options.localKey ?? env["SECRETS_LOCAL_KEY"];

  const summary: SecretsSummary = {
    driver,
    applied: [],
    envOverride: [],
    notFound: [],
    errors: [],
  };
  if (driver === "none") return summary;

  for (const name of SECRET_NAMES) {
    const existing = env[name];
    if (existing && !isInsecureDefault(name, existing)) {
      summary.envOverride.push(name);
      continue;
    }
    const record = await readEnvelope(secretsDir, name);
    if (!record) {
      summary.notFound.push(name);
      continue;
    }
    let plain: string;
    if (record.keyWrap === "local") {
      if (!localKey) {
        throw new SecretsError(
          `envelope ${name} is local-wrapped but SECRETS_LOCAL_KEY is not set ` +
            `(generate one with \`pnpm secrets gen-key\`)`,
          "LOCAL_KEY_MISSING",
        );
      }
      plain = decryptLocal(record, localKey);
    } else {
      plain = await decryptKms(record);
    }
    env[name] = plain;
    summary.applied.push(name);
  }
  return summary;
}

/* --------------------------------------------------------------- tooling */

/** Human-readable trace of every platform secret's source. */
export async function secretsTrace(
  env: Record<string, string | undefined> = process.env,
  secretsDir?: string,
): Promise<Array<{ name: string; source: string; file?: string }>> {
  const driver = (env["SECRETS_DRIVER"] ?? "none") as SecretsDriver;
  const dir = secretsDir ?? env["SECRETS_DIR"] ?? "./data/secrets";
  const rows: Array<{ name: string; source: string; file?: string }> = [];
  for (const name of SECRET_NAMES) {
    const existing = env[name];
    if (existing && !isInsecureDefault(name, existing)) {
      rows.push({ name, source: "env" });
    } else if (driver !== "none" && existsSync(envelopePath(dir, name))) {
      const rec = await readEnvelope(dir, name).catch(() => null);
      rows.push({
        name,
        source: rec ? `envelope:${rec.keyWrap}` : "envelope:unreadable",
        file: envelopePath(dir, name),
      });
    } else {
      rows.push({ name, source: "unset" });
    }
  }
  return rows;
}
