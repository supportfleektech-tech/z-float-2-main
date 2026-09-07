/**
 * Recurring report-export scheduling (monthly/weekly) + artifact retention.
 *
 * Due active schedules produce a normal reports row (REQUESTED, schedule_id
 * set) enqueued for reports.generate; retention sweeps delete artifacts older
 * than the schedule's retention window from the object store.
 */
import { and, eq, lt, lte, schema, type Db } from "@zfloat/database";
import { enqueue } from "@zfloat/queue";

export interface ScheduleDispatchResult {
  produced: number;
  purged: number;
}

async function nextRun(frequency: string, from: Date): Promise<Date> {
  if (frequency === "weekly") return new Date(from.getTime() + 7 * 86_400_000);
  // monthly: same day-of-month next month, clamped to month length
  const d = new Date(from);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // next month (0-based + 1)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}

export async function runReportScheduleDispatch(db: Db): Promise<ScheduleDispatchResult> {
  const now = new Date();
  const due = await db
    .select()
    .from(schema.reportSchedules)
    .where(and(eq(schema.reportSchedules.active, true), lte(schema.reportSchedules.nextRunAt, now)))
    .limit(50);

  let produced = 0;
  for (const sched of due) {
    const [report] = await db
      .insert(schema.reports)
      .values({
        tenantId: sched.tenantId,
        reportType: sched.reportType,
        format: "csv",
        status: "REQUESTED",
        requestedById: sched.createdById ?? undefined,
        scheduleId: sched.id,
      })
      .returning({ id: schema.reports.id });
    if (!report) continue;
    await enqueue("reports.generate", {
      correlationId: `sched-${sched.id}-${report.id}`,
      tenantId: sched.tenantId,
      reportId: report.id,
      reportType: sched.reportType,
      scheduleId: sched.id,
    }).catch(() => undefined);
    const next = await nextRun(sched.frequency, new Date(sched.nextRunAt));
    await db
      .update(schema.reportSchedules)
      .set({ nextRunAt: next, updatedAt: new Date() })
      .where(eq(schema.reportSchedules.id, sched.id));
    produced += 1;
  }

  // Retention sweep — scheduled artifacts past their window.
  let purged = 0;
  const { getObjectStore } = await import("@zfloat/storage");
  const store = getObjectStore();
  const schedules = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.active, true)).limit(200);
  for (const sched of schedules) {
    const cutoff = new Date(Date.now() - sched.retentionDays * 86_400_000);
    const expired = await db
      .select({ id: schema.reports.id, payloadRef: schema.reports.payloadRef })
      .from(schema.reports)
      .where(and(eq(schema.reports.scheduleId, sched.id), lt(schema.reports.completedAt, cutoff)))
      .limit(500);
    for (const art of expired) {
      if (art.payloadRef) {
        try {
          // payloadRef: "s3://reports/{id}.csv" or "file://…/{id}.csv" →
          // strip the scheme prefix to recover the store key.
          await store.delete(art.payloadRef.replace(/^[a-z]+:\/\//, ""));
        } catch {
          // object already gone — row cleanup still proceeds
        }
      }
      await db.delete(schema.reports).where(eq(schema.reports.id, art.id));
      purged += 1;
    }
  }

  return { produced, purged };
}
