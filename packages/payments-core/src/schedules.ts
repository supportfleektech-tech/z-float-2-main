/**
 * Payment schedules — create/pause/cancel. The worker materializes due
 * schedules into DRAFT payments (createScheduledPayments in services/worker).
 */
import { and, eq, sql } from "drizzle-orm";
import cronParser from "cron-parser";
import { schema, type Db } from "@zfloat/database";
import { amountDecimalSchema, paymentChannels } from "@zfloat/validation";

export type ScheduleFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";

export interface CreateScheduleInput {
  tenantId: string;
  actorId: string;
  name: string;
  amountMinor: bigint;
  frequency: ScheduleFrequency;
  channel: string;
  startDate: Date;
  endDate?: Date;
  cronExpr?: string;
  beneficiaryId?: string;
  beneficiarySnapshot?: Record<string, unknown>;
  category?: string;
}

/** Next run for a frequency — computed from the schedule start, then advanced after each materialization. */
export function nextRunFor(frequency: ScheduleFrequency, from: Date, cronExpr?: string): Date {
  if (frequency === "CUSTOM") {
    if (cronExpr) {
      try {
        // Real cron evaluation: next date matching the expression strictly after `from`.
        const interval = cronParser.parseExpression(cronExpr, { currentDate: from });
        const next = interval.next().toDate();
        if (Number.isNaN(next.getTime())) throw new Error("invalid cron result");
        return next;
      } catch {
        // Fallback for unparseable expressions: advance 7 days (documented).
        return new Date(from.getTime() + 7 * 86400_000);
      }
    }
    // No expression: advance 7 days so the schedule cannot re-fire immediately
    // (nextRunAt in the past would materialize on every dispatch run).
    return new Date(from.getTime() + 7 * 86400_000);
  }
  const d = new Date(from);
  if (frequency === "DAILY") d.setDate(d.getDate() + 1);
  else if (frequency === "WEEKLY") d.setDate(d.getDate() + 7);
  else if (frequency === "MONTHLY") d.setMonth(d.getMonth() + 1);
  return d;
}

export async function createPaymentSchedule(db: Db, input: CreateScheduleInput): Promise<{ scheduleId: string; nextRunAt: Date }> {
  const parsed = amountDecimalSchema.safeParse((Number(input.amountMinor) / 100).toFixed(2));
  if (!parsed.success) throw new Error("Invalid amount");
  if (!(paymentChannels as readonly string[]).includes(input.channel)) throw new Error(`Unsupported channel: ${input.channel}`);
  if (input.endDate && input.endDate <= input.startDate) throw new Error("End date must be after start date");

  const nextRunAt = nextRunFor(input.frequency, input.startDate, input.cronExpr);
  const [row] = await db
    .insert(schema.paymentSchedules)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      amountMinor: input.amountMinor,
      currency: "KES",
      frequency: input.frequency,
      channel: input.channel,
      startDate: input.startDate,
      endDate: input.endDate,
      cronExpr: input.cronExpr,
      nextRunAt,
      beneficiaryId: input.beneficiaryId,
      beneficiarySnapshot: input.beneficiarySnapshot,
      category: input.category,
      status: "ACTIVE",
      createdById: input.actorId,
    })
    .returning();
  if (!row) throw new Error("Failed to create schedule");
  return { scheduleId: row.id, nextRunAt };
}

export async function pausePaymentSchedule(db: Db, opts: { tenantId: string; scheduleId: string }): Promise<void> {
  await db
    .update(schema.paymentSchedules)
    .set({ status: "PAUSED" })
    .where(and(eq(schema.paymentSchedules.id, opts.scheduleId), eq(schema.paymentSchedules.tenantId, opts.tenantId)));
}

export async function cancelPaymentSchedule(db: Db, opts: { tenantId: string; scheduleId: string }): Promise<void> {
  await db
    .update(schema.paymentSchedules)
    .set({ status: "CANCELLED" })
    .where(and(eq(schema.paymentSchedules.id, opts.scheduleId), eq(schema.paymentSchedules.tenantId, opts.tenantId)));
}

/** Overdue active schedules (used by the worker's schedules.dispatch job). */
export async function listDueSchedules(db: Db, limit = 50): Promise<Array<{ id: string; nextRunAt: Date | null }>> {
  const now = new Date();
  return db
    .select({ id: schema.paymentSchedules.id, nextRunAt: schema.paymentSchedules.nextRunAt })
    .from(schema.paymentSchedules)
    .where(and(eq(schema.paymentSchedules.status, "ACTIVE"), sql`${schema.paymentSchedules.nextRunAt} <= ${now}`))
    .limit(limit);
}
