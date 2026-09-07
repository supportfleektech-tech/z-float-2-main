/**
 * Idempotency GC integration tests (real PostgreSQL):
 *  - stale IN_PROGRESS records are freed after the stale window
 *  - fresh IN_PROGRESS records are kept (a live request is never disturbed)
 *  - finished records older than retention are purged
 *  - recent finished records are kept (replay window stays intact)
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createDb, schema, type Db } from "@zfloat/database";
import { gcIdempotencyRecords, type IdempotencyGcOptions } from "../src/index.js";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let TENANT = "";

async function clean() {
  await pool.query(` TRUNCATE idempotency_records CASCADE `);
}

async function seed(opts: { status: string; ageMs: number; completed?: boolean }) {
  const createdAt = new Date(Date.now() - opts.ageMs);
  await db.insert(schema.idempotencyRecords).values({
    tenantId: TENANT,
    scope: "payment.create",
    key: `gc-${crypto.randomUUID()}`,
    status: opts.status,
    createdAt,
    completedAt: opts.completed ? new Date(Date.now() - opts.ageMs) : null,
  });
}

async function count(): Promise<number> {
  const rows = await db.select().from(schema.idempotencyRecords);
  return rows.length;
}

beforeEach(async () => {
  ({ db, pool } = createDb());
  await clean();
  const [t] = await db
    .insert(schema.tenants)
    .values({ name: "GC Co", slug: `gc-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`, status: "ACTIVE" })
    .returning();
  TENANT = t!.id;
});

afterAll(async () => {
  await clean();
  await pool.end();
});

describe("gcIdempotencyRecords", () => {
  it("frees stale IN_PROGRESS keys older than the stale window", async () => {
    await seed({ status: "IN_PROGRESS", ageMs: 2 * 3_600_000 }); // 2h old
    const gc = await gcIdempotencyRecords(db, { staleHours: 1 });
    expect(gc.freedStale).toBe(1);
    expect(await count()).toBe(0);
  });

  it("keeps fresh IN_PROGRESS records (in-flight requests)", async () => {
    await seed({ status: "IN_PROGRESS", ageMs: 5 * 60_000 }); // 5m old
    const gc = await gcIdempotencyRecords(db, { staleHours: 1 });
    expect(gc.freedStale).toBe(0);
    expect(await count()).toBe(1);
  });

  it("purges COMPLETED records past the retention window", async () => {
    await seed({ status: "COMPLETED", ageMs: 200 * 86_400_000, completed: true }); // 200d old
    const gc = await gcIdempotencyRecords(db, { completedDays: 90 });
    expect(gc.purgedCompleted).toBe(1);
    expect(await count()).toBe(0);
  });

  it("keeps COMPLETED records inside the retention window (replay still works)", async () => {
    await seed({ status: "COMPLETED", ageMs: 7 * 86_400_000, completed: true }); // 7d old
    const gc = await gcIdempotencyRecords(db, { completedDays: 90 });
    expect(gc.purgedCompleted).toBe(0);
    expect(await count()).toBe(1);
  });

  it("is a no-op on an empty table and reports zeroes", async () => {
    const gc = await gcIdempotencyRecords(db, {} as IdempotencyGcOptions);
    expect(gc).toEqual({ freedStale: 0, purgedCompleted: 0 });
  });

  it("defaults apply when options omitted", async () => {
    await seed({ status: "IN_PROGRESS", ageMs: 48 * 3_600_000 }); // 2d stale
    await seed({ status: "FAILED", ageMs: 120 * 86_400_000, completed: true }); // 120d failed
    const gc = await gcIdempotencyRecords(db);
    expect(gc.freedStale).toBe(1);
    expect(gc.purgedCompleted).toBe(1);
  });
});
