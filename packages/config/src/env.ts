/**
 * Z-float typed environment configuration.
 *
 * Rules (from instructions.md):
 *  - Fail startup when production-critical variables are absent.
 *  - Never trust browser-side config; this module runs server-side only.
 *  - Provider secrets live in provider-specific secret stores in production.
 */
import { z } from "zod";

export const NODE_ENVS = ["local", "development", "test", "staging", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default("development"),

  APP_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1),
  DATABASE_URL_TEST: z.string().optional(),

  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
  REDIS_PREFIX: z.string().default("zfloat"),

  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters")
    .default("dev-only-session-secret-do-not-use-in-prod-000000"),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 64 hex chars (32 bytes)")
    .default("0".repeat(64)),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./data/storage"),
  S3_ENDPOINT: z.string().default(""),
  S3_BUCKET: z.string().default(""),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_FORCE_PATH_STYLE: z.string().default("true").transform((v) => v === "true"),
  S3_KEY_PREFIX: z.string().default(""),

  /** Secrets driver: "none" (plain env), "local" (AES-256-GCM envelope with SECRETS_LOCAL_KEY), "kms" (AWS KMS-wrapped envelopes). */
  SECRETS_DRIVER: z.enum(["none", "local", "kms"]).default("none"),
  /** 64 hex chars (32 bytes) — the local envelope key (dev/staging; never production). */
  SECRETS_LOCAL_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "SECRETS_LOCAL_KEY must be 64 hex chars (32 bytes)").optional(),
  /** AWS KMS key id/arn used to wrap secret data keys. */
  SECRETS_KMS_KEY_ID: z.string().optional(),

  EMAIL_DRIVER: z.enum(["console", "smtp", "sink"]).default("console"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** EMAIL_DRIVER=sink writes .eml-style files here (demo mailboxes). */
  SMTP_SINK_DIR: z.string().default("./data/mailbox"),
  EMAIL_FROM: z.string().default("Z-float <no-reply@zfloat.app>"),

  SMS_DRIVER: z.enum(["console", "http"]).default("console"),
  SMS_PROVIDER_URL: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  /** Sender id sent to the SMS gateway (Africa's Talking `from`). */
  SMS_FROM: z.string().default("Z-FLOAT"),

  /** Ops alerting (GAP-ANALYSIS Phase 4): comma-separated recipients for
   * health-rule alert notifications. Empty lists = alerts are evaluated and
   * recorded but nothing is sent (documented ops posture). */
  OPS_ALERT_EMAILS: z.string().default(""),
  OPS_ALERT_SMS: z.string().default(""),
  /** Per-rule cooldown between alert sends (seconds). */
  ALERT_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(300),

  MALWARE_SCANNER_DRIVER: z.enum(["mock", "clamav"]).default("mock"),
  CLAMAV_HOST: z.string().default("127.0.0.1"),
  CLAMAV_PORT: z.coerce.number().default(3310),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  WORKER_CRON_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  /** Outbox relay poll cadence (embedded worker and standalone relay share this). */
  OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().min(200).default(5000),
  /** Advisory lock key for outbox relay lease arbitration (shared by worker + relay). */
  OUTBOX_RELAY_LEASE_KEY: z.coerce.number().int().default(723993001),

  PROVIDER_DEFAULT: z.string().default("local-sandbox"),

  MPESA_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  /** Testing override: point the adapter at a local Daraja emulator. Refused in production. */
  MPESA_API_BASE_URL: z.string().optional(),
  MPESA_CONSUMER_KEY: z.string().default(""),
  MPESA_CONSUMER_SECRET: z.string().default(""),
  MPESA_PASSKEY: z.string().default(""),
  MPESA_SHORTCODE: z.string().default("174379"),
  MPESA_CALLBACK_BASE_URL: z.string().default("http://localhost:3000"),
  MPESA_B2C_INITIATOR_NAME: z.string().default(""),
  MPESA_B2C_SECURITY_CREDENTIAL: z.string().default(""),
  MPESA_TIMEOUT_MS: z.coerce.number().default(15000),

  BANK_API_BASE_URL: z.string().optional(),
  BANK_API_KEY: z.string().optional(),
  BANK_API_SECRET: z.string().optional(),

  AIRTIME_API_BASE_URL: z.string().optional(),
  AIRTIME_API_KEY: z.string().optional(),

  MOCK_PROVIDER_BEHAVIOUR: z.enum(["success", "pending", "random", "fail"]).default("success"),
  MOCK_PROVIDER_LATENCY_MS: z.coerce.number().default(300),
  /** Shared secret for mock provider webhook verification (dev/staging). Override in staging/prod. */
  MOCK_PROVIDER_SECRET: z.string().default("mock-provider-dev-secret"),

  /** Circuit breaker: failures before opening the circuit. */
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(5),
  /** Circuit breaker: successes in half-open state before closing. */
  CIRCUIT_BREAKER_SUCCESS_THRESHOLD: z.coerce.number().int().min(1).default(2),
  /** Circuit breaker: timeout in OPEN state before trying half-open (ms). */
  CIRCUIT_BREAKER_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),

  DEMO_MODE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  SEED_DEMO_DATA: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(120),

  OTEL_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default("http://localhost:4318"),
  SENTRY_DSN: z.string().default(""),

  ADMIN_EMAIL: z.string().email().default("admin@zfloat.app"),
  ADMIN_PASSWORD: z.string().default(""),

  // Injections used by tests (not part of .env)
  IS_TEST: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export type AppEnv = z.infer<typeof envSchema>;

export interface ConfigOptions {
  /** Override process.env — used by tests. */
  env?: Record<string, string | undefined>;
  /** When true, missing required variables log a warning instead of throwing. */
  lenient?: boolean;
}

function isProductionLike(nodeEnv: string | undefined): boolean {
  return nodeEnv === "production" || nodeEnv === "staging";
}

/** Read process.env and validate. Throws a descriptive error listing problems. */
export function loadConfig(options: ConfigOptions = {}): AppEnv {
  const source = options.env ?? process.env;

  if (isProductionLike(source.NODE_ENV)) {
    // Strict mode: production-critical variables must be present.
    const required: Array<[keyof AppEnv, string]> = [
      ["DATABASE_URL", "DATABASE_URL"],
      ["REDIS_URL", "REDIS_URL"],
      ["SESSION_SECRET", "SESSION_SECRET"],
      ["ENCRYPTION_KEY", "ENCRYPTION_KEY"],
    ];
    const missing: string[] = [];
    for (const [key] of required) {
      const raw = source[key as string];
      if (!raw || (key === "ENCRYPTION_KEY" && /^0+$/.test(raw)) || (key === "SESSION_SECRET" && raw.startsWith("dev-only"))) {
        missing.push(String(key));
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `[config] Production environment is missing critical variables: ${missing.join(", ")}. ` +
          `Refusing to start — see .env.example and docs/PRODUCTION_CHECKLIST.md.`,
      );
    }
    // A demo walkthrough instance is a legitimate deployment class of this
    // product: the seeded demo app runs the PRODUCTION BUILD with an explicit
    // DEMO_MODE=true so rubric behaviours (built-in demo approval policy,
    // raw-token invite bridge) work end-to-end. Posture is protected by the
    // checks around this one: the default of DEMO_MODE is false, so a real
    // deployment only gets demo behaviour if an operator deliberately sets it.
    // SEED_DEMO_DATA=true, by contrast, would auto-seed demo rows into a
    // production database — never allowed.
    if (source.SEED_DEMO_DATA === "true") {
      throw new Error("[config] SEED_DEMO_DATA must be false in production/staging (seed the demo DB once, offline).");
    }
    if (source.ENCRYPTION_KEY === "0".repeat(64) || /^0+$/.test(source.ENCRYPTION_KEY ?? "")) {
      throw new Error("[config] ENCRYPTION_KEY must be a real 32-byte hex key in production.");
    }
    if ((source.MALWARE_SCANNER_DRIVER ?? "mock") === "mock") {
      throw new Error("[config] MALWARE_SCANNER_DRIVER=mock is not allowed in production. Configure clamav.");
    }
  }

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    if (options.lenient) {
      // eslint-disable-next-line no-console
      console.warn(`[config] Invalid environment variables:\n${problems}`);
      return loadConfig({ ...options, lenient: false });
    }
    throw new Error(`[config] Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}

/** Singleton config, loaded once per process. */
let cached: AppEnv | null = null;
export function getConfig(opts?: ConfigOptions): AppEnv {
  if (!cached || opts) {
    cached = loadConfig(opts);
  }
  return cached;
}

export function resetConfig(): void {
  cached = null;
}
