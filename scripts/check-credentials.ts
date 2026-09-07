/**
 * Batch-D credential readiness checker.
 *
 * For every credential the platform needs to go live (M-Pesa/Daraja,
 * PesaLink/bank, AWS S3/KMS, SMTP/SES, SMS gateway, watchlist feed, ClamAV,
 * core secrets), reports whether it is present as an explicit env value,
 * sealed in the secrets vault (SECRETS_DIR envelope files), or missing.
 *
 * Usage:  pnpm check:creds            # advisory table
 *         pnpm check:creds --strict   # exit 1 if anything is missing
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { secretsTrace } from "../packages/secrets/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../.env"), quiet: true });

interface CredDef {
  /** Env var name (also the vault envelope name). */
  var: string;
  /** Credential label for humans. */
  label: string;
  /** Where to obtain it (short; full detail in credentials.md). */
  source: string;
  /** Optional format sanity check (reject obvious dev defaults). */
  badIf?: (v: string) => boolean;
}

interface Group {
  name: string;
  /** TODO.md Batch-D item this group unblocks. */
  unblocks: string;
  creds: CredDef[];
}

const INSECURE = (v: string) =>
  v === "" || v === "0".repeat(64) || v.startsWith("dev-only") || v === "change-me-32+bytes-of-cryptographic-random";

const GROUPS: Group[] = [
  {
    name: "Core secrets (required for ANY production deploy)",
    unblocks: "every process boots",
    creds: [
      { var: "SESSION_SECRET", label: "Session signing secret (≥32 chars)", source: "openssl rand -base64 48", badIf: INSECURE },
      { var: "ENCRYPTION_KEY", label: "32-byte hex key for at-rest encryption", source: "openssl rand -hex 32", badIf: INSECURE },
      { var: "DATABASE_URL", label: "Hosted PostgreSQL connection string", source: "hosting provider (Neon/RDS/Supabase/self-hosted)" },
      { var: "REDIS_URL", label: "Hosted Redis/Valkey connection string", source: "hosting provider (Upstash/Redis Cloud/self-hosted)" },
      { var: "ADMIN_PASSWORD", label: "Platform admin bootstrap password", source: "generated; ADMIN_EMAIL decides the account" },
    ],
  },
  {
    name: "M-Pesa Daraja (live certification)",
    unblocks: "TODO D: live M-Pesa (B2C/STK/status/reversal) via MpesaProviderAdapter",
    creds: [
      { var: "MPESA_ENVIRONMENT", label: "'production' once certified", source: "see credentials.md §Daraja", badIf: (v) => v === "sandbox" },
      { var: "MPESA_CONSUMER_KEY", label: "Daraja app consumer key", source: "Safaricom Daraja portal → app (production app after certification)" },
      { var: "MPESA_CONSUMER_SECRET", label: "Daraja app consumer secret", source: "Safaricom Daraja portal", badIf: INSECURE },
      { var: "MPESA_PASSKEY", label: "STK push passkey (base64 of shortcode+passkey)", source: "Safaricom API team (after go-live approval)" },
      { var: "MPESA_SHORTCODE", label: "Live paybill/till shortcode (174379 is sandbox)", source: "Safaricom contract", badIf: (v) => v === "174379" },
      { var: "MPESA_CALLBACK_BASE_URL", label: "Public HTTPS URL of /api/webhooks/mpesa", source: "your deployment domain", badIf: (v) => v.startsWith("http://") || v.includes("localhost") },
      { var: "MPESA_B2C_INITIATOR_NAME", label: "B2C initiator (API user) name", source: "Safaricom (only if using B2C disbursements)" },
      { var: "MPESA_B2C_SECURITY_CREDENTIAL", label: "B2C security credential (encrypted password)", source: "Safaricom (only if using B2C)" },
    ],
  },
  {
    name: "PesaLink / bank rails",
    unblocks: "TODO D: PesaLink, RTGS/EFT bank files (bank-psp adapter)",
    creds: [
      { var: "BANK_API_BASE_URL", label: "Bank/aggregator PesaLink API base URL", source: "bank partner (KCB/Equity/NCBA etc. or aggregator)" },
      { var: "BANK_API_KEY", label: "Bank API client key", source: "bank partner portal" },
      { var: "BANK_API_SECRET", label: "Bank API shared secret (webhook signature)", source: "bank partner portal", badIf: (v) => v === "mock-bank-dev-secret" },
    ],
  },
  {
    name: "AWS S3 (real object storage) + KMS vault",
    unblocks: "TODO D: real S3 reports (MinIO-verified so far); C-2 KMS live proof",
    creds: [
      { var: "STORAGE_DRIVER", label: "'s3'", source: "config", badIf: (v) => v !== "s3" },
      { var: "S3_BUCKET", label: "Bucket name (versioning + SSE-KMS policy)", source: "AWS console, one bucket; tenant prefixes inside" },
      { var: "S3_REGION", label: "AWS region", source: "AWS console" },
      { var: "S3_ACCESS_KEY_ID", label: "IAM user/role access key (least privilege)", source: "AWS IAM (or instance role — then leave unset)" },
      { var: "S3_SECRET_ACCESS_KEY", label: "Matching secret key", source: "AWS IAM", badIf: INSECURE },
      { var: "SECRETS_DRIVER", label: "'kms'", source: "config", badIf: (v) => v !== "kms" },
      { var: "SECRETS_KMS_KEY_ID", label: "KMS key id/arn for the secrets vault", source: "AWS KMS → alias/zfloat-secrets (app role needs kms:Decrypt only)" },
    ],
  },
  {
    name: "Email delivery (SMTP / SES)",
    unblocks: "TODO D: real email receipts + invites + templates",
    creds: [
      { var: "EMAIL_DRIVER", label: "'smtp'", source: "config", badIf: (v) => v !== "smtp" },
      { var: "SMTP_HOST", label: "SMTP host (or SES SMTP endpoint)", source: "email provider / AWS SES" },
      { var: "SMTP_PORT", label: "587 (STARTTLS) or 465", source: "provider docs" },
      { var: "SMTP_USER", label: "SMTP username", source: "provider" },
      { var: "SMTP_PASS", label: "SMTP password / SES SMTP password", source: "provider", badIf: INSECURE },
      { var: "EMAIL_FROM", label: "Verified sender (SES: verified domain)", source: "provider (must verify domain in SES)" },
    ],
  },
  {
    name: "SMS delivery (Africa's Talking / Twilio)",
    unblocks: "TODO D: real SMS receipts (driver already AT-compatible)",
    creds: [
      { var: "SMS_DRIVER", label: "'http'", source: "config", badIf: (v) => v !== "http" },
      { var: "SMS_PROVIDER_URL", label: "Gateway endpoint (AT production sandbox/live URL)", source: "provider dashboard (e.g. https://api.africastalking.com/version1/messaging)" },
      { var: "SMS_API_KEY", label: "Gateway API key", source: "provider dashboard", badIf: INSECURE },
      { var: "SMS_FROM", label: "Approved sender id / shortcode", source: "provider (must be registered; AT sender-id approval)" },
    ],
  },
  {
    name: "Identity verification + watchlist (licensed)",
    unblocks: "TODO D: document verification; real watched-party feed",
    creds: [
      { var: "VERIFY_API_BASE_URL", label: "ID/doc verification partner API URL", source: "licensed partner (e.g. eCitizen/ID-check vendor)" },
      { var: "VERIFY_API_KEY", label: "Verification partner API key", source: "partner onboarding" },
      { var: "WATCHLIST_FEED_URL", label: "Sanctions/PEP feed endpoint (seam: aml_watchlists)", source: "licensed feed vendor" },
      { var: "WATCHLIST_FEED_KEY", label: "Feed credential", source: "vendor" },
    ],
  },
  {
    name: "Infrastructure",
    unblocks: "secure production runtime",
    creds: [
      { var: "COOKIE_SECURE", label: "'true' in production", source: "config", badIf: (v) => v !== "true" },
      { var: "MALWARE_SCANNER_DRIVER", label: "'clamav'", source: "config", badIf: (v) => v !== "clamav" },
      { var: "CLAMAV_HOST", label: "ClamAV daemon host", source: "deployment" },
      { var: "CLAMAV_PORT", label: "clamd TCP port (default 3310)", source: "deployment" },
      { var: "NODE_ENV", label: "'production'", source: "config", badIf: (v) => v !== "production" },
      { var: "DEMO_MODE", label: "'false'", source: "config", badIf: (v) => v !== "false" },
      { var: "SEED_DEMO_DATA", label: "'false'", source: "config", badIf: (v) => v !== "false" },
    ],
  },
];

interface Row {
  var: string;
  label: string;
  group: string;
  source: string;
  state: "ok" | "vault" | "missing" | "attention";
  value?: string;
}

async function main() {
  const strict = process.argv.includes("--strict");
  const env = process.env;
  const rows: Row[] = [];
  const seen = new Set<string>();

  // Envelope files (vault) that exist on disk, per SECRET_NAMES convention.
  const secretsDir = env["SECRETS_DIR"] ?? "./data/secrets";
  const trace = await secretsTrace(env as Record<string, string | undefined>, secretsDir).catch(() => []);
  const vaulted = new Map(trace.map((t) => [t.name, t.source]));

  for (const g of GROUPS) {
    for (const c of g.creds) {
      seen.add(c.var);
      const raw = env[c.var];
      const inVault = vaulted.get(c.var);
      const bad = raw !== undefined && raw !== "" && c.badIf?.(raw);
      let state: Row["state"] = "missing";
      if (raw && !bad) state = "ok";
      else if (bad) state = "attention"; // present but wrong/dev value
      else if (inVault && inVault !== "unset") state = "vault";
      rows.push({ var: c.var, label: c.label, group: g.name, source: c.source, state });
    }
  }

  console.log("Z-float — Batch-D credential readiness\n");
  const counts = { ok: 0, vault: 0, missing: 0, attention: 0 };
  let lastGroup = "";
  for (const r of rows) {
    if (r.group !== lastGroup) {
      console.log(`\n◆ ${r.group}`);
      lastGroup = r.group;
    }
    counts[r.state] += 1;
    const mark = r.state === "ok" ? "✓ ok" : r.state === "vault" ? "◈ vault" : r.state === "attention" ? "⚠ attention" : "✗ missing";
    console.log(`  ${mark.padEnd(11)} ${r.var.padEnd(32)} ${r.label}`);
  }
  console.log(`\nSummary: ${counts.ok} ok · ${counts.vault} in vault · ${counts.attention} attention · ${counts.missing} missing (of ${rows.length} checked)`);
  console.log(`Missing = ${counts.missing}, Attention = ${counts.attention}`);
  if (strict && counts.missing + counts.attention > 0) process.exit(1);
}

main().catch((err) => {
  console.error("check:creds failed:", err);
  process.exit(1);
});
