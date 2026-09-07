import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applySecretsToEnv,
  generateLocalKeyHex,
  isInsecureDefault,
  keyFingerprint,
  secretsTrace,
  writeLocalEnvelope,
  SECRET_NAMES,
} from "../src/index.js";

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "zf-secrets-"));
}

function freshEnv(): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = {};
  for (const n of SECRET_NAMES) e[n] = undefined;
  return e;
}

describe("key helpers", () => {
  it("generates 64-hex (32 byte) local keys", () => {
    const k = generateLocalKeyHex();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(keyFingerprint(k)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("flags insecure dev defaults for session/encryption", () => {
    expect(isInsecureDefault("SESSION_SECRET", "dev-only-session-secret-do-not-use-in-prod-000000")).toBe(true);
    expect(isInsecureDefault("SESSION_SECRET", "change-me-32+bytes-of-cryptographic-random")).toBe(true);
    expect(isInsecureDefault("SESSION_SECRET", "a-real-32+byte-production-secret!!")).toBe(false);
    expect(isInsecureDefault("ENCRYPTION_KEY", "0".repeat(64))).toBe(true);
    expect(isInsecureDefault("MPESA_CONSUMER_SECRET", "")).toBe(true);
    expect(isInsecureDefault("MPESA_CONSUMER_SECRET", "abc")).toBe(false);
  });
});

describe("local envelope driver", () => {
  it("seals and resolves a secret into the env", async () => {
    const dir = tmpDir();
    const key = generateLocalKeyHex();
    const file = writeLocalEnvelope({
      name: "MPESA_CONSUMER_SECRET",
      value: "s3cr3t-value",
      dir,
      keyHex: key,
      comment: "rotation test",
    });
    expect(file).toContain("MPESA_CONSUMER_SECRET.json");
    const rec = JSON.parse(readFileSync(file, "utf8"));
    expect(rec.keyWrap).toBe("local");
    expect(JSON.stringify(rec)).not.toContain("s3cr3t-value"); // plaintext never stored

    const env = freshEnv();
    env["SECRETS_DRIVER"] = "local";
    const summary = await applySecretsToEnv({ env, secretsDir: dir, localKey: key });
    expect(summary.applied).toContain("MPESA_CONSUMER_SECRET");
    expect(env["MPESA_CONSUMER_SECRET"]).toBe("s3cr3t-value");
    expect(env["SESSION_SECRET"]).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it("env vars always win over the vault", async () => {
    const dir = tmpDir();
    const key = generateLocalKeyHex();
    writeLocalEnvelope({ name: "S3_SECRET_ACCESS_KEY", value: "vault-value", dir, keyHex: key });
    const env = freshEnv();
    env["SECRETS_DRIVER"] = "local";
    env["S3_SECRET_ACCESS_KEY"] = "explicit-env-value";
    const summary = await applySecretsToEnv({ env, secretsDir: dir, localKey: key });
    expect(summary.envOverride).toContain("S3_SECRET_ACCESS_KEY");
    expect(env["S3_SECRET_ACCESS_KEY"]).toBe("explicit-env-value");
    rmSync(dir, { recursive: true, force: true });
  });

  it("replaces insecure defaults (dev session secret, zero encryption key)", async () => {
    const dir = tmpDir();
    const key = generateLocalKeyHex();
    writeLocalEnvelope({ name: "SESSION_SECRET", value: "real-session-00000000000000000000000000000000", dir, keyHex: key });
    writeLocalEnvelope({ name: "ENCRYPTION_KEY", value: "ab".repeat(32), dir, keyHex: key });
    const env = freshEnv();
    env["SECRETS_DRIVER"] = "local";
    env["SESSION_SECRET"] = "dev-only-session-secret-do-not-use-in-prod-000000"; // insecure default
    env["ENCRYPTION_KEY"] = "0".repeat(64);
    const summary = await applySecretsToEnv({ env, secretsDir: dir, localKey: key });
    expect(summary.applied).toEqual(expect.arrayContaining(["SESSION_SECRET", "ENCRYPTION_KEY"]));
    expect(env["SESSION_SECRET"]).toBe("real-session-00000000000000000000000000000000");
    expect(env["ENCRYPTION_KEY"]).toBe("ab".repeat(32));
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects tampered envelopes loudly (fail closed)", async () => {
    const dir = tmpDir();
    const key = generateLocalKeyHex();
    writeLocalEnvelope({ name: "MPESA_CONSUMER_KEY", value: "ck-123", dir, keyHex: key });
    const file = path.join(dir, "MPESA_CONSUMER_KEY.json");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.data = (raw.data as string).slice(0, -2) + "=="; // corrupt
    writeFileSync(file, JSON.stringify(raw));
    const env = freshEnv();
    env["SECRETS_DRIVER"] = "local";
    await expect(applySecretsToEnv({ env, secretsDir: dir, localKey: key })).rejects.toThrow(
      /decryption failed/,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("wrong-name envelope is rejected", async () => {
    const dir = tmpDir();
    const key = generateLocalKeyHex();
    writeLocalEnvelope({ name: "SMS_API_KEY", value: "x", dir, keyHex: key });
    const file = path.join(dir, "SMS_API_KEY.json");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.name = "OTHER_NAME";
    writeFileSync(file, JSON.stringify(raw));
    const env = freshEnv();
    env["SECRETS_DRIVER"] = "local";
    await expect(applySecretsToEnv({ env, secretsDir: dir, localKey: key })).rejects.toThrow(
      /name\/version mismatch/,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("requires SECRETS_LOCAL_KEY when a local envelope exists", async () => {
    const dir = tmpDir();
    const key = generateLocalKeyHex();
    writeLocalEnvelope({ name: "SMTP_PASS", value: "pw", dir, keyHex: key });
    const env = freshEnv();
    env["SECRETS_DRIVER"] = "local";
    await expect(applySecretsToEnv({ env, secretsDir: dir })).rejects.toThrow(
      /SECRETS_LOCAL_KEY is not set/,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("driver=none never touches anything (default)", async () => {
    const dir = tmpDir();
    const key = generateLocalKeyHex();
    writeLocalEnvelope({ name: "MPESA_CONSUMER_SECRET", value: "x", dir, keyHex: key });
    const env = freshEnv();
    const summary = await applySecretsToEnv({ env, secretsDir: dir, localKey: key });
    expect(summary.driver).toBe("none");
    expect(env["MPESA_CONSUMER_SECRET"]).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it("kms driver with no envelope files is a quiet no-op (no AWS calls)", async () => {
    const dir = tmpDir();
    const env = freshEnv();
    env["SECRETS_DRIVER"] = "kms";
    const summary = await applySecretsToEnv({ env, secretsDir: dir });
    expect(summary.driver).toBe("kms");
    expect(summary.notFound.length).toBe(SECRET_NAMES.length);
    for (const n of SECRET_NAMES) expect(env[n]).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("secretsTrace", () => {
  it("reports env / envelope / unset per name", async () => {
    const dir = tmpDir();
    const key = generateLocalKeyHex();
    writeLocalEnvelope({ name: "AIRTIME_API_KEY", value: "v", dir, keyHex: key });
    const env = freshEnv();
    env["SECRETS_DRIVER"] = "local";
    env["BANK_API_KEY"] = "from-env";
    const rows = await secretsTrace(env, dir);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.source]));
    expect(byName["AIRTIME_API_KEY"]).toBe("envelope:local");
    expect(byName["BANK_API_KEY"]).toBe("env");
    expect(byName["SESSION_SECRET"]).toBe("unset");
    rmSync(dir, { recursive: true, force: true });
  });
});
