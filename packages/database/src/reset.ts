/**
 * Database reset — destroys ALL data and rebuilds from scratch.
 *
 * Mirrors runbook RB-01: drop + recreate the database, re-apply migrations,
 * then seed demo data (when enabled). Usage: `pnpm db:reset`.
 *
 * WARNING: this drops the target database. Never point it at production.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";
import { getConfig } from "@zfloat/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load root .env so `pnpm db:reset` works from anywhere.
loadDotenv({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

function parseDatabaseUrl(raw: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  };
}

async function main() {
  const config = getConfig();
  const url =
    process.env.RESET_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.DATABASE_URL_TEST ||
    config.DATABASE_URL;
  const { host, port, user, password, database } = parseDatabaseUrl(url);

  // Maintenance connection to the `postgres` db so we can drop/create the target.
  const adminPool = new Pool({
    host,
    port,
    user,
    password,
    database: "postgres",
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  // eslint-disable-next-line no-console
  console.log(`[reset] dropping database "${database}" (ALL DATA WILL BE DESTROYED)`);
  await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`);
  // eslint-disable-next-line no-console
  console.log(`[reset] creating database "${database}"`);
  await adminPool.query(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(user)}`);
  await adminPool.end();

  const packageDir = path.resolve(__dirname, "..");
  // Make migrate + seed target the same database that was just recreated.
  const run = (script: string) => {
    // eslint-disable-next-line no-console
    console.log(`[reset] running ${script}`);
    const result = spawnSync("pnpm", [script], {
      cwd: packageDir,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url },
    });
    if (result.status !== 0) {
      // eslint-disable-next-line no-console
      console.error(`[reset] ${script} failed with exit code ${result.status}`);
      process.exit(result.status ?? 1);
    }
  };

  run("db:migrate");

  if (config.SEED_DEMO_DATA || config.DEMO_MODE) {
    run("db:seed");
    // eslint-disable-next-line no-console
    console.log("[reset] done — database reset, migrated and seeded.");
  } else {
    // eslint-disable-next-line no-console
    console.log("[reset] done — database reset and migrated (SEED_DEMO_DATA not enabled, skipping seed).");
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[reset] failed:", err);
  process.exit(1);
});
