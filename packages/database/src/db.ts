import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";
import { getConfig } from "@zfloat/config";

export type Db = NodePgDatabase<typeof schema>;
/** The transaction handle type — derive it from Db so it can never drift. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };

export function createDb(databaseUrl?: string): { db: Db; pool: Pool } {
  const config = getConfig();
  const url = databaseUrl ?? (config.IS_TEST ? config.DATABASE_URL_TEST : config.DATABASE_URL);
  const pool = new Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 10_000,
  });
  // Keep idle/errored clients from becoming uncaught 'error' events. Without
  // this listener, a Postgres outage (or a dying connection) crashes the whole
  // process — proven by the PG-outage chaos drill (worker + relay exited 1
  // while the cluster was down; queries reject fine and callers see errors,
  // but the idle-client error event must be owned).
  pool.on("error", (err: Error) => {
    // eslint-disable-next-line no-console
    console.error(`[db] pool client error: ${err.message}`);
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

let singleton: { db: Db; pool: Pool } | null = null;

/** Reuse a single pool per process (avoids exhausting connections). */
export function getDb(): { db: Db; pool: Pool } {
  if (!singleton) {
    singleton = createDb();
  }
  return singleton;
}

export async function closeDb(): Promise<void> {
  if (singleton) {
    await singleton.pool.end();
    singleton = null;
  }
}

export { schema as schemaObj };
