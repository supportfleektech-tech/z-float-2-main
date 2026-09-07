/**
 * Report-schedule dispatch integration tests (real PostgreSQL + local object
 * store):
 *  - a due active schedule produces a REQUESTED reports row and advances its
 *    next_run_at (monthly = +1 month, weekly = +7 days)
 *  - inactive / not-yet-due schedules are ignored
 *  - the retention sweep deletes expired scheduled artifacts (row + object)
 *    and keeps artifacts inside the retention window
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, schema, createDb, type Db } from "@zfloat/database";
import { runReportScheduleDispatch } from "../src/index.js";
import { getObjectStore } from "@zfloat/storage";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let TENANT = "";

async function clean() {
  await pool.query(` TRUNCATE report_schedules, reports, tenants CASCADE `);
}

async function seedSchedule(opts: { frequency?: string; retentionDays?: number; nextRunInMs?: number; active?: boolean }) {
  const [s] = await db
    .insert(schema.reportSchedules)
    .values({
      tenantId: TENANT,
      reportType: "transactions",
      frequency: opts.frequency ?? "monthly",
      retentionDays: opts.retentionDays ?? 90,
      nextRunAt: new Date(Date.now() + (opts.nextRunInMs ?? -60_000)),
      active: opts.active ?? true,
    })
    .returning();
  return s!;
}

async function countReports(): Promise<number> {
  const rows = await db.select().from(schema.reports);
  return rows.length;
}

beforeEach(async () => {
  ({ db, pool } = createDb());
  await clean();
  const [t] = await db
    .insert(schema.tenants)
    .values({ name: "Sched Co", slug: `sc-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`, status: "ACTIVE" })
    .returning();
  TENANT = t!.id;
});

afterAll(async () => {
  await clean();
  await pool.end();
});

describe("runReportScheduleDispatch", () => {
  it("produces a REQUESTED report for a due schedule and advances next_run_at monthly", async () => {
    const s = await seedSchedule({ frequency: "monthly" });
    const before = new Date(s.nextRunAt).getTime();

    const out = await runReportScheduleDispatch(db);
    expect(out.produced).toBe(1);
    expect(out.purged).toBe(0);
    expect(await countReports()).toBe(1);

    const [report] = await db.select().from(schema.reports);
    expect(report!.scheduleId).toBe(s.id);
    expect(report!.status).toBe("REQUESTED");
    expect(report!.reportType).toBe("transactions");

    const [after] = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, s.id));
    const advanced = new Date(after!.nextRunAt).getTime() - before;
    expect(advanced).toBeGreaterThan(28 * 86_400_000); // ~+1 month
    expect(advanced).toBeLessThan(32 * 86_400_000);
  });

  it("advances weekly schedules by ~7 days", async () => {
    const s = await seedSchedule({ frequency: "weekly" });
    const before = new Date(s.nextRunAt).getTime();
    await runReportScheduleDispatch(db);
    const [after] = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, s.id));
    const advanced = new Date(after!.nextRunAt).getTime() - before;
    expect(advanced).toBeCloseTo(7 * 86_400_000, -5);
  });

  it("ignores inactive and not-yet-due schedules", async () => {
    await seedSchedule({ active: false });
    await seedSchedule({ nextRunInMs: 60_000 }); // due in a minute
    const out = await runReportScheduleDispatch(db);
    expect(out.produced).toBe(0);
    expect(await countReports()).toBe(0);
  });

  it("does not produce twice for the same schedule in one pass (idempotent by next_run_at)", async () => {
    await seedSchedule({});
    await runReportScheduleDispatch(db);
    const out2 = await runReportScheduleDispatch(db);
    expect(out2.produced).toBe(0);
    expect(await countReports()).toBe(1);
  });

  it("retention sweep purges expired scheduled artifacts (row + object) and keeps fresh ones", async () => {
    const s = await seedSchedule({ retentionDays: 1, nextRunInMs: 60_000 }); // not due — sweep only
    const store = getObjectStore();

    // artifact older than the window (payloadRef: bare store key — local driver)
    const oldKey = `reports/old-${crypto.randomUUID()}.csv`;
    await store.put({ key: oldKey, body: Buffer.from("old"), contentType: "text/csv" });
    await db.insert(schema.reports).values({
      tenantId: TENANT,
      reportType: "transactions",
      format: "csv",
      status: "GENERATED",
      scheduleId: s.id,
      payloadRef: oldKey,
      createdAt: new Date(Date.now() - 10 * 86_400_000),
      completedAt: new Date(Date.now() - 10 * 86_400_000),
    });

    // artifact inside the window
    const freshKey = `reports/fresh-${crypto.randomUUID()}.csv`;
    await store.put({ key: freshKey, body: Buffer.from("fresh"), contentType: "text/csv" });
    await db.insert(schema.reports).values({
      tenantId: TENANT,
      reportType: "transactions",
      format: "csv",
      status: "GENERATED",
      scheduleId: s.id,
      payloadRef: freshKey,
      createdAt: new Date(),
      completedAt: new Date(),
    });

    const out = await runReportScheduleDispatch(db);
    expect(out.produced).toBe(0);
    expect(out.purged).toBe(1);
    expect(await countReports()).toBe(1);
    const [remaining] = await db.select().from(schema.reports);
    expect(remaining!.payloadRef).toBe(freshKey);
    // the old object is gone from the store; the fresh one remains
    await expect(store.head(oldKey)).resolves.toBeNull();
    await expect(store.head(freshKey)).resolves.not.toBeNull();

    // cleanup fresh artifact
    await store.delete(freshKey);
  });
});
