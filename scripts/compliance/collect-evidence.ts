/**
 * SOC2 / ODPC evidence collector (Batch C-4).
 *
 * Pulls control evidence from the live system into
 * `data/compliance/<ISO-timestamp>/` as CSV/JSON artifacts, each stamped
 * with collection metadata, then writes a MANIFEST.json with per-artifact
 * SHA-256 hashes (chain of custody for the evidence set).
 *
 * Usage:  tsx scripts/compliance/collect-evidence.ts [--limit N]
 * Env:    DATABASE_URL (required), DATABASE_URL_TEST (optional override)
 *
 * NEVER writes secret values: the env snapshot records variable names only
 * (set/unset + truncated sha256 of the value for change detection).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const SECRET_NAME_PREFIXES = ["SECRET", "KEY", "PASSWORD", "TOKEN", "PASS"];

function isSecretName(name: string): boolean {
  return SECRET_NAME_PREFIXES.some((p) => name.startsWith(p)) || /SECRET|PASSWORD|PASSKEY|CREDENTIAL/.test(name);
}

interface Artifact {
  file: string;
  sha256: string;
  rows: number;
  source: string;
}

const run = { startedAt: new Date().toISOString(), collector: "collect-evidence.ts", host: process.env.HOSTNAME ?? "unknown" };
const artifacts: Artifact[] = [];

function stamp(source: string): string {
  return `# Source: ${source}\n# Collected: ${run.startedAt} by ${run.collector} on ${run.host}\n# This file is machine-generated evidence. Do not edit.\n`;
}

function writeArtifact(outDir: string, name: string, body: string, source: string, rows: number) {
  const file = path.join(outDir, name);
  writeFileSync(file, stamp(source) + body);
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  artifacts.push({ file, sha256: sha, rows, source });
  console.log(`  ✓ ${name} (${rows} rows, sha256 ${sha.slice(0, 12)}…)`);
}

function csv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "no_rows\n";
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return keys.join(",") + "\n" + rows.map((r) => keys.map((k) => esc(r[k])).join(",")).join("\n") + "\n";
}

async function main() {
  const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 500);
  const url = process.env.EVIDENCE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const outDir = path.resolve(__dirname, "../../data/compliance", run.startedAt.replace(/[:.]/g, "-"));
  mkdirSync(outDir, { recursive: true });
  console.log(`[evidence] collecting into ${outDir} (limit ${limit}/table)`);

  const pool = new Pool({ connectionString: url, max: 3 });
  const q = async <T extends Record<string, unknown>>(text: string): Promise<T[]> => (await pool.query(text)).rows as T[];

  // ── SOC2: access control / audit trail (CC6.1–6.3, CC7.2) ─────────────
  const audit = await q(`SELECT a.id, a.action, a.resource_type, a.resource_id,
                                COALESCE(u.email, a.actor_id::text) AS actor, a.actor_role,
                                a.ip, a.created_at
                         FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
                         ORDER BY a.created_at DESC LIMIT ${limit}`);
  writeArtifact(outDir, "audit-events.csv", csv(audit), "audit_events (immutable, append-only)", audit.length);

  const logins = await q(`SELECT l.id, u.email, l.event, l.ip, l.created_at
                          FROM login_events l LEFT JOIN users u ON u.id = l.user_id
                          ORDER BY l.created_at DESC LIMIT ${limit}`);
  writeArtifact(outDir, "login-events.csv", csv(logins), "login_events (immutable)", logins.length);

  const security = await q(`SELECT s.id, COALESCE(u.email, s.user_id::text) AS actor, s.event_type, s.severity,
                                   s.details, s.created_at
                            FROM security_events s LEFT JOIN users u ON u.id = s.user_id
                            ORDER BY s.created_at DESC LIMIT ${limit}`);
  writeArtifact(outDir, "security-events.csv", csv(security), "security_events (immutable)", security.length);

  // ── SOC2: access review evidence (CC6.3) ───────────────────────────────
  const access = await q(`SELECT u.id, u.email, u.full_name, u.status AS user_status, t.name AS tenant,
                                 COALESCE(string_agg(DISTINCT r.name, ','), '') AS roles,
                                 u.mfa_enabled, u.last_login_at, u.created_at
                          FROM users u
                          JOIN tenants t ON t.id = u.tenant_id
                          LEFT JOIN user_roles ur ON ur.user_id = u.id
                          LEFT JOIN roles r ON r.id = ur.role_id
                          GROUP BY u.id, t.name, u.email, u.full_name, u.status, u.mfa_enabled, u.last_login_at, u.created_at
                          ORDER BY u.created_at`);
  writeArtifact(outDir, "access-review.csv", csv(access), "users + roles + MFA (current state)", access.length);

  // ── ODPC: records of processing / consent / DSAR evidence ──────────────
  const consent = await q(`SELECT c.id, COALESCE(u.email, c.user_id::text) AS user, c.purpose, c.granted,
                                  c.granted_at, c.revoked_at
                           FROM consent_records c LEFT JOIN users u ON u.id = c.user_id
                           ORDER BY c.granted_at DESC NULLS LAST LIMIT ${limit}`);
  writeArtifact(outDir, "consent-records.csv", csv(consent), "consent_records", consent.length);

  const dsars = await q(`SELECT d.id, COALESCE(u.email, d.user_id::text) AS user, d.type, d.status, d.requested_at, d.completed_at
                         FROM data_requests d LEFT JOIN users u ON u.id = d.user_id
                         ORDER BY d.requested_at DESC LIMIT ${limit}`);  writeArtifact(outDir, "data-requests.csv", csv(dsars), "data_requests (DSAR workflow)", dsars.length);

  const kycCounts = await q(`SELECT status, count(*)::int AS n FROM verification_documents GROUP BY status ORDER BY status`);
  writeArtifact(outDir, "kyc-scan-status.csv", csv(kycCounts), "verification_documents scan statuses", kycCounts.length);

  // ── SOC2: availability / monitoring (A1.2, CC7.3) + config mgmt (CC8.1) ─
  const ops = await q(`SELECT
                         (SELECT count(*) FROM pg_stat_activity)::int AS db_connections,
                         (SELECT count(*) FROM outbox_events WHERE published_at IS NULL)::int AS outbox_pending,
                         (SELECT count(*) FROM wallet_ledger_entries)::int AS ledger_entries,
                         (SELECT count(*) FROM journal_entries)::int AS journal_entries,
                         (SELECT count(*) FROM _custom_migrations)::int AS integrity_migrations`);
  writeArtifact(outDir, "operations-health.csv", csv(ops), "live operational indicators", ops.length);

  const migrations = await q(`SELECT name, applied_at FROM _custom_migrations ORDER BY name`);
  writeArtifact(outDir, "integrity-migrations.csv", csv(migrations), "_custom_migrations (DB integrity rules applied)", migrations.length);

  // ── System inventory + env snapshot (no secrets) ───────────────────────
  const pgVer = (await q(`SELECT version()`))[0]?.version ?? "unknown";
  let gitHead = "n/a";
  try { gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(__dirname, "../..") }).toString().trim(); } catch { /* not a repo */ }
  const pkgVersions: Record<string, string> = {};
  try {
    const root = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    pkgVersions["(root)"] = root.version ?? "private";
  } catch { /* ignore */ }
  const envSnapshot = Object.fromEntries(
    Object.entries(process.env)
      .filter(([k]) => /^[A-Z][A-Z0-9_]*$/.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, v === undefined || v === "" ? "UNSET" : isSecretName(k) ? `set(sha256:${createHash("sha256").update(v).digest("hex").slice(0, 12)})` : "set"]),
  );
  const inventory = {
    collectedAt: run.startedAt,
    host: run.host,
    postgres: String(pgVer).split("\n")[0],
    node: process.version,
    gitHead,
    workspaceVersions: pkgVersions,
  };
  writeArtifact(outDir, "system-inventory.json", JSON.stringify(inventory, null, 2) + "\n", "runtime inventory", 1);
  writeArtifact(outDir, "env-snapshot.json", JSON.stringify(envSnapshot, null, 2) + "\n", "process env names only (values hashed for secrets)", Object.keys(envSnapshot).length);

  // ── Dependency audit (best effort; may be offline) ─────────────────────
  let depAudit = "";
  try {
    depAudit = execFileSync("pnpm", ["audit", "--audit-level", "high"], { cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 120_000 }).toString();
  } catch (err) {
    depAudit = `pnpm audit failed or found issues (exit ${(err as { status?: number }).status ?? "?"}).\n\n` + String((err as { stdout?: string }).stdout ?? err).slice(0, 4000);
  }
  writeArtifact(outDir, "dependency-audit.txt", depAudit, "pnpm audit --audit-level high", 1);

  await pool.end();

  // ── Manifest (chain of custody) ────────────────────────────────────────
  const manifest = { run, artifacts };
  writeFileSync(path.join(outDir, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\n[evidence] done — ${artifacts.length} artifacts in ${outDir}`);
  console.log(`[evidence] manifest: ${path.join(outDir, "MANIFEST.json")}`);
}

main().catch((err) => {
  console.error("[evidence] failed:", err);
  process.exit(1);
});
