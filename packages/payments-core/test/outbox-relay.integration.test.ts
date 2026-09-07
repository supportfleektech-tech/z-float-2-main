/**
 * Outbox relay integration tests (real PostgreSQL):
 *  - processOutboxBatch dispatches unpublished events in order and marks them
 *    published; respects the batch limit; skips rows past the attempts cap
 *  - a failing handler marks the event failed (attempts++, lastError) and the
 *    event is retried on a later pass
 *  - dispatchOutboxTick arbitrates concurrent pollers with the Postgres
 *    advisory lease: a losing tick is skipped, the winner dispatches exactly
 *    once, and the lease releases when the transaction commits
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@zfloat/database";
import {
  processOutboxBatch,
  dispatchOutboxTick,
  type OutboxHandler,
} from "../src/index.js";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
const TENANT = "11111111-1111-4111-8111-111111111111";

async function clean() {
  await pool.query("TRUNCATE outbox_events CASCADE");
}

async function seed(overrides: Partial<typeof schema.outboxEvents.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.outboxEvents)
    .values({
      eventType: "test.relay",
      aggregateType: "test",
      aggregateId: `agg-${crypto.randomUUID()}`,
      tenantId: TENANT,
      payload: { seq: 1 },
      ...overrides,
    })
    .returning({ id: schema.outboxEvents.id });
  return row!.id;
}

async function published(id: string): Promise<boolean> {
  const [row] = await db
    .select({ publishedAt: schema.outboxEvents.publishedAt })
    .from(schema.outboxEvents)
    .where(eq(schema.outboxEvents.id, id))
    .limit(1);
  return row?.publishedAt !== null;
}

const recording: OutboxHandler = (() => {
  const seen: string[] = [];
  const reset = () => (seen.length = 0);
  return { seen, reset };
})();

beforeAll(async () => {
  ({ db, pool } = createDb());
  await clean();
});

beforeEach(async () => {
  await clean();
  recording.reset();
});

afterAll(async () => {
  await clean();
  await pool.end();
});

describe("processOutboxBatch", () => {
  it("dispatches unpublished events and marks them published", async () => {
    const a = await seed();
    const b = await seed();
    const c = await seed();

    const r = await processOutboxBatch(db, async (ev) => {
      recording.seen.push(ev.id);
    });

    expect(r).toEqual({ dispatched: 3, failed: 0 });
    expect(recording.seen.sort()).toEqual([a, b, c].sort());
    for (const id of [a, b, c]) expect(await published(id)).toBe(true);
  });

  it("respects the batch limit; remaining rows dispatch on the next pass", async () => {
    const a = await seed();
    const b = await seed();

    const first = await processOutboxBatch(db, async () => {}, 1);
    expect(first.dispatched).toBe(1);
    const publishedCount = (await pool.query("select count(*)::int n from outbox_events where published_at is not null")).rows[0].n;
    expect(publishedCount).toBe(1);

    const second = await processOutboxBatch(db, async () => {});
    expect(second.dispatched).toBe(1);
    expect((await published(a)) || (await published(b))).toBe(true);
  });

  it("never touches rows past the attempts cap", async () => {
    await seed({ attempts: 10 });
    const r = await processOutboxBatch(db, async () => {
      throw new Error("should not be called");
    });
    expect(r).toEqual({ dispatched: 0, failed: 0 });
  });

  it("marks a failing event failed and retries it later", async () => {
    const id = await seed();
    let calls = 0;

    const r = await processOutboxBatch(db, async () => {
      calls += 1;
      throw new Error("handler exploded");
    });
    expect(r).toEqual({ dispatched: 0, failed: 1 });
    expect(await published(id)).toBe(false);

    const [row] = await db.select().from(schema.outboxEvents).where(eq(schema.outboxEvents.id, id)).limit(1);
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain("handler exploded");

    // a healthy handler on the next pass succeeds
    const retry = await processOutboxBatch(db, async () => {});
    expect(retry.dispatched).toBe(1);
    expect(await published(id)).toBe(true);
    expect(calls).toBe(1);
  });
});

describe("dispatchOutboxTick (advisory lease arbitration)", () => {
  it("skips a tick another poller owns, then processes after it commits", async () => {
    const id = await seed();

    // Poller A: acquires the lease, then parks inside its handler.
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let handledA = 0;

    const tickA = dispatchOutboxTick(db, {
      handle: async () => {
        handledA += 1;
        enter();
        await gate;
      },
    });

    // Wait until A holds the lease (its handler is running inside its tx).
    await entered;

    // Poller B ticks while A holds the lease → must skip, not double-dispatch.
    const tickB = await dispatchOutboxTick(db, { handle: async () => {} });
    expect(tickB).toEqual({ dispatched: 0, failed: 0, skipped: true });

    // A finishes → exactly one dispatch, event published once.
    release();
    const resultA = await tickA;
    expect(resultA).toEqual({ dispatched: 1, failed: 0, skipped: false });
    expect(handledA).toBe(1);
    expect(await published(id)).toBe(true);

    // A third tick after commit acquires the lease; nothing left to do.
    const tickC = await dispatchOutboxTick(db, { handle: async () => {} });
    expect(tickC.skipped).toBe(false);
    expect(tickC.dispatched).toBe(0);
  });
});
