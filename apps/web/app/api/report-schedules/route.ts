import { NextRequest } from "next/server";
import { getDb, schema, eq, desc } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";

/** Recurring report exports — monthly/weekly CSV to object storage. */
export async function GET(_request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const schedules = await db
    .select({
      id: schema.reportSchedules.id,
      reportType: schema.reportSchedules.reportType,
      frequency: schema.reportSchedules.frequency,
      retentionDays: schema.reportSchedules.retentionDays,
      nextRunAt: schema.reportSchedules.nextRunAt,
      active: schema.reportSchedules.active,
      createdAt: schema.reportSchedules.createdAt,
    })
    .from(schema.reportSchedules)
    .where(eq(schema.reportSchedules.tenantId, user!.tenantId!))
    .orderBy(desc(schema.reportSchedules.createdAt))
    .limit(50);

  // Last artifact per schedule (for the UI: "last generated").
  const withLast = await Promise.all(
    schedules.map(async (s) => {
      const [last] = await db
        .select({ completedAt: schema.reports.completedAt, rowCount: schema.reports.rowCount })
        .from(schema.reports)
        .where(eq(schema.reports.scheduleId, s.id))
        .orderBy(desc(schema.reports.createdAt))
        .limit(1);
      return { ...s, lastRunAt: last?.completedAt ?? null, lastRowCount: last?.rowCount ?? 0 };
    }),
  );

  return apiOk({ data: withLast });
}

/**
 * POST — create a schedule. Demo mode accepts an explicit `nextRunAt` so the
 * E2E suite can prove the full monthly pipeline without waiting a month.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reportType = body.reportType === "fees" ? "fees" : "transactions";
  const frequency = body.frequency === "weekly" ? "weekly" : "monthly";
  const retentionDays = Number(body.retentionDays ?? 90);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 730) {
    return apiError(400, "INVALID_RETENTION", "retentionDays must be an integer between 1 and 730");
  }

  const isDemo = process.env.DEMO_MODE === "true";
  const now = new Date();
  let nextRunAt: Date;
  if (body.nextRunAt && isDemo) {
    const parsed = new Date(String(body.nextRunAt));
    if (Number.isNaN(parsed.getTime())) return apiError(400, "INVALID_NEXT_RUN", "nextRunAt is not a valid date");
    nextRunAt = parsed;
  } else if (frequency === "weekly") {
    // Next Monday 07:00 EAT (UTC+3)
    const d = new Date(now);
    const daysUntilMonday = (8 - d.getUTCDay()) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + daysUntilMonday);
    d.setUTCHours(4, 0, 0, 0); // 07:00 EAT = 04:00 UTC
    nextRunAt = d;
  } else {
    // 1st of next month, 07:00 EAT
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 4, 0, 0));
    nextRunAt = first;
  }

  const [row] = await db
    .insert(schema.reportSchedules)
    .values({
      tenantId: user!.tenantId!,
      reportType,
      frequency,
      retentionDays,
      nextRunAt,
      createdById: user!.userId,
    })
    .returning();
  if (!row) return apiError(500, "SCHEDULE_CREATE_FAILED", "Could not create schedule");

  return apiOk(
    {
      data: {
        id: row.id,
        reportType,
        frequency,
        retentionDays,
        nextRunAt: nextRunAt.toISOString(),
        active: true,
      },
    },
    { status: 201 },
  );
}
