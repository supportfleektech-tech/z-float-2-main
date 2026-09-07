import { NextRequest } from "next/server";
import { getDb, schema, eq, desc } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { enqueue } from "@zfloat/queue";

/** List reports for the current tenant (newest first). */
export async function GET(_request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const rows = await db
    .select({
      id: schema.reports.id,
      reportType: schema.reports.reportType,
      format: schema.reports.format,
      status: schema.reports.status,
      payloadRef: schema.reports.payloadRef,
      rowCount: schema.reports.rowCount,
      createdAt: schema.reports.createdAt,
      completedAt: schema.reports.completedAt,
    })
    .from(schema.reports)
    .where(eq(schema.reports.tenantId, user!.tenantId!))
    .orderBy(desc(schema.reports.createdAt))
    .limit(50);
  return apiOk({ data: rows });
}

/** Request an async report export — the worker generates the CSV. */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const reportType = b.reportType === "fees" ? "fees" : "transactions";

  const [row] = await db
    .insert(schema.reports)
    .values({
      tenantId: user!.tenantId!,
      reportType,
      format: "csv",
      status: "REQUESTED",
      requestedById: user!.userId,
    })
    .returning({ id: schema.reports.id });
  if (!row)
    return apiError(500, "REPORT_CREATE_FAILED", "Could not create report");

  await enqueue("reports.generate", {
    correlationId: `report-${row.id}`,
    tenantId: user!.tenantId!,
    reportId: row.id,
    reportType,
  });
  return apiOk(
    { data: { id: row.id, status: "REQUESTED", reportType, format: "csv" } },
    { status: 201 },
  );
}
