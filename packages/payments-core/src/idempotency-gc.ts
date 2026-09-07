/**
 * Idempotency-record garbage collection.
 *
 * idempotency_records entries are written per tenant+scope+key and are never
 * naturally deleted — replays must keep working for the API's documented
 * replay window, but records can't grow forever. Policy:
 *
 *  - STALE (IN_PROGRESS) keys older than `staleHours` are dropped. A stuck
 *    IN_PROGRESS permanently blocks its key (every retry would replay a
 *    half-finished command), so freeing it after a generous window lets a
 *    caller safely retry a request that could never have completed.
 *  - COMPLETED/FAILED (finished) records older than `completedDays` are
 *    dropped (retention). The same key reused after retention is treated as
 *    a brand-new command — documented API behavior.
 */
import { and, lt, or, eq, schema, type Db } from "@zfloat/database";

export interface IdempotencyGcOptions {
  /** IN_PROGRESS records older than this are freed (default 24h). */
  staleHours?: number;
  /** Finished records (COMPLETED/FAILED) older than this are purged (default 90d). */
  completedDays?: number;
}

export const IDEMPOTENCY_GC_DEFAULTS = {
  staleHours: 24,
  completedDays: 90,
} as const;

export async function gcIdempotencyRecords(db: Db, opts: IdempotencyGcOptions = {}): Promise<{ freedStale: number; purgedCompleted: number }> {
  const staleHours = opts.staleHours ?? IDEMPOTENCY_GC_DEFAULTS.staleHours;
  const completedDays = opts.completedDays ?? IDEMPOTENCY_GC_DEFAULTS.completedDays;
  const staleBefore = new Date(Date.now() - staleHours * 3_600_000);
  const completedBefore = new Date(Date.now() - completedDays * 86_400_000);

  const stale = await db
    .delete(schema.idempotencyRecords)
    .where(
      and(
        eq(schema.idempotencyRecords.status, "IN_PROGRESS"),
        lt(schema.idempotencyRecords.createdAt, staleBefore),
      ),
    )
    .returning({ id: schema.idempotencyRecords.id });

  const finished = await db
    .delete(schema.idempotencyRecords)
    .where(
      and(
        or(
          eq(schema.idempotencyRecords.status, "COMPLETED"),
          eq(schema.idempotencyRecords.status, "FAILED"),
        ),
        lt(schema.idempotencyRecords.completedAt, completedBefore),
      ),
    )
    .returning({ id: schema.idempotencyRecords.id });

  return { freedStale: stale.length, purgedCompleted: finished.length };
}
