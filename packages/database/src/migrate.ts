/**
 * Migration runner. Applies drizzle migrations + custom SQL migrations
 * in order. Usage: pnpm db:migrate (or with DATABASE_URL overridden).
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

async function main() {
  const config = getConfig();
  const url = process.env.DATABASE_URL ?? config.DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  // 1) Drizzle-generated migrations
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });

  // 2) Custom SQL migrations (data integrity triggers etc.), in filename order
  const customDir = path.resolve(__dirname, "../custom-migrations");
  const files = (await readdir(customDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(path.join(customDir, file), "utf8");
    // Track applied custom migrations idempotently
    await pool.query(`CREATE TABLE IF NOT EXISTS _custom_migrations (name text primary key, applied_at timestamptz default now())`);
    const applied = await pool.query(`SELECT 1 FROM _custom_migrations WHERE name = $1`, [file]);
    if ((applied.rowCount ?? 0) > 0) {
      // eslint-disable-next-line no-console
      console.log(`[migrate] already applied custom migration ${file}`);
      continue;
    }
    // eslint-disable-next-line no-console
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

  // eslint-disable-next-line no-console
  console.log("[migrate] done");
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate] failed:", err);
  process.exit(1);
});
