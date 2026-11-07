/**
 * Migration runner. Applies drizzle migrations + custom SQL migrations
 * in order. Usage: pnpm db:migrate (or with DATABASE_URL overridden).
 * Supports down migrations via: pnpm db:migrate:down <migration_name>
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";
import { getConfig } from "@zfloat/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load root .env so `pnpm db:migrate` works from anywhere.
loadDotenv({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

interface MigrationOptions {
  direction: "up" | "down";
  targetMigration?: string;
}

async function runMigrations(options: MigrationOptions = { direction: "up" }) {
  const config = getConfig();
  const url = process.env.DATABASE_URL ?? config.DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  // 1) Drizzle-generated migrations
  if (options.direction === "up") {
    await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });
  } else {
    // For down migrations, we'd need drizzle-kit to generate down migrations
    // This is a manual process - see docs
    console.log("[migrate] Skipping drizzle down migrations (manual process required)");
  }

  // 2) Custom SQL migrations (data integrity triggers etc.)
  const customDir = path.resolve(__dirname, "../custom-migrations");
  const downDir = path.resolve(__dirname, "../custom-migrations/down");

  if (options.direction === "up") {
    const files = (await readdir(customDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = await readFile(path.join(customDir, file), "utf8");
      // Track applied custom migrations idempotently
      await pool.query(`CREATE TABLE IF NOT EXISTS _custom_migrations (name text primary key, applied_at timestamptz default now())`);
      const applied = await pool.query(`SELECT 1 FROM _custom_migrations WHERE name = $1`, [file]);
      if ((applied.rowCount ?? 0) > 0) {
        console.log(`[migrate] already applied custom migration ${file}`);
        continue;
      }
      console.log(`[migrate] applying custom migration ${file}`);
      await pool.query("BEGIN");
      try {
        await pool.query(sql);
        await pool.query(`INSERT INTO _custom_migrations (name) VALUES ($1)`, [file]);
        await pool.query("COMMIT");
      } catch (err) {
        await pool.query("ROLLBACK");
        throw err;
      }
    }
  } else {
    // Down migrations - run in reverse order
    const downFiles = (await readdir(downDir)).filter((f) => f.endsWith(".down.sql")).sort().reverse();
    const targetIndex = options.targetMigration
      ? downFiles.findIndex(f => f.startsWith(options.targetMigration!.replace(".down.sql", "")))
      : -1;

    for (const file of downFiles) {
      // If target specified, only run down to that migration
      if (options.targetMigration && file.startsWith(options.targetMigration.replace(".down.sql", ""))) {
        break;
      }

      const sql = await readFile(path.join(downDir, file), "utf8");
      const upFile = file.replace(".down.sql", ".sql");

      // Check if the up migration was applied
      const applied = await pool.query(`SELECT 1 FROM _custom_migrations WHERE name = $1`, [upFile]);
      if ((applied.rowCount ?? 0) === 0) {
        console.log(`[migrate:down] skipping ${file} (up migration not applied)`);
        continue;
      }

      console.log(`[migrate:down] rolling back ${upFile} via ${file}`);
      await pool.query("BEGIN");
      try {
        await pool.query(sql);
        await pool.query(`DELETE FROM _custom_migrations WHERE name = $1`, [upFile]);
        await pool.query("COMMIT");
      } catch (err) {
        await pool.query("ROLLBACK");
        throw err;
      }
    }
  }

  console.log("[migrate] done");
  await pool.end();
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: MigrationOptions = { direction: "up" };

if (args.includes("--down") || args.includes("down")) {
  options.direction = "down";
  const targetIdx = args.findIndex(a => a === "--target");
  if (targetIdx !== -1 && args[targetIdx + 1]) {
    options.targetMigration = args[targetIdx + 1];
  }
}

runMigrations(options).catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});