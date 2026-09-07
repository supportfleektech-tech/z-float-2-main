/**
 * Secrets CLI — seal/rotate/inspect the platform secret vault.
 *
 *   pnpm secrets gen-key                     # 64-hex AES key for SECRETS_LOCAL_KEY
 *   pnpm secrets list                        # source trace for every platform secret
 *   pnpm secrets set NAME VALUE [--comment ..] [--driver local|kms]
 *   pnpm secrets unset NAME
 *
 * driver defaults to SECRETS_DRIVER (local for dev; kms requires
 * SECRETS_KMS_KEY_ID + AWS credentials — env/role — at runtime).
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySecretsToEnv,
  generateLocalKeyHex,
  secretsTrace,
  writeKmsEnvelope,
  writeLocalEnvelope,
  SECRET_NAMES,
} from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

const dir = process.env.SECRETS_DIR ?? "./data/secrets";

function usage(): never {
  console.error(
    "usage: pnpm secrets <gen-key|list|set NAME VALUE [--comment c] [--driver local|kms]|unset NAME>",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();

  if (cmd === "gen-key") {
    console.log(generateLocalKeyHex());
    return;
  }

  if (cmd === "list") {
    const applied = await applySecretsToEnv();
    const rows = await secretsTrace();
    console.log(`driver=${applied.driver}  dir=${dir}`);
    console.log("env override:", applied.envOverride.length ? applied.envOverride.join(", ") : "—");
    console.log("vault applied:", applied.applied.length ? applied.applied.join(", ") : "—");
    for (const r of rows) {
      console.log(`  ${r.name.padEnd(28)} ${r.source.padEnd(20)} ${r.file ?? ""}`);
    }
    return;
  }

  if (cmd === "unset") {
    const [name] = rest;
    if (!name || !SECRET_NAMES.includes(name as (typeof SECRET_NAMES)[number])) usage();
    const { rmSync } = await import("node:fs");
    const file = path.join(dir, `${name}.json`);
    rmSync(file, { force: true });
    console.log(`removed ${file}`);
    return;
  }

  if (cmd === "set") {
    const name = rest[0];
    const value = rest[1];
    if (!name || !SECRET_NAMES.includes(name as (typeof SECRET_NAMES)[number])) usage();
    if (value === undefined) usage();
    const commentIdx = rest.indexOf("--comment");
    const comment = commentIdx >= 0 ? rest.slice(commentIdx + 1).join(" ") : undefined;
    const driverIdx = rest.indexOf("--driver");
    const driver = driverIdx >= 0 ? rest[driverIdx + 1] : process.env.SECRETS_DRIVER ?? "local";
    if (driver !== "local" && driver !== "kms") usage();
    if (driver === "local") {
      const key = process.env.SECRETS_LOCAL_KEY;
      if (!key) {
        console.error("SECRETS_LOCAL_KEY is not set — generate one with `pnpm secrets gen-key`");
        process.exit(1);
      }
      const file = writeLocalEnvelope({ name, value, dir, keyHex: key, comment });
      console.log(`sealed ${name} -> ${file} (local envelope)`);
    } else {
      const kmsKeyId = process.env.SECRETS_KMS_KEY_ID;
      if (!kmsKeyId) {
        console.error("SECRETS_KMS_KEY_ID is not set (kms driver)");
        process.exit(1);
      }
      const file = await writeKmsEnvelope({ name, value, dir, kmsKeyId, comment });
      console.log(`sealed ${name} -> ${file} (KMS-wrapped envelope, key ${kmsKeyId})`);
    }
    return;
  }

  usage();
}

main().catch((err) => {
  console.error("secrets:", err);
  process.exit(1);
});
