import { NextRequest } from "next/server";
import { getDb, schema, eq } from "@zfloat/database";
import { requireUser, apiError } from "@/lib/api";

/** Download a generated report as CSV (tenant-scoped, GENERATED only). */
export async function GET(
  _request: NextRequest,
  ctx: { params: { id: string } },
) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const [row] = await db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.id, ctx.params.id))
    .limit(1);
  if (!row || row.tenantId !== user!.tenantId) {
    return apiError(404, "NOT_FOUND", "Report not found");
  }
  if (row.status !== "GENERATED" || !row.payloadRef) {
    return apiError(
      409,
      "REPORT_NOT_READY",
      `Report is ${row.status} — wait for generation`,
    );
  }
  try {
    // payloadRef points at the object in the configured store
    // (local path or s3://key). Resolve through the storage driver.
    const { getObjectStore } = await import("@zfloat/storage");
    const ref = row.payloadRef;
    const key = ref.startsWith("s3://") ? ref.slice("s3://".length) : ref.startsWith("file://") ? ref.slice("file://".length) : ref;
    const store = getObjectStore();
    const bytes = await store.get(key);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="report-${row.id}-${row.reportType}.csv"`,
      },
    });
  } catch {
    return apiError(404, "FILE_MISSING", "Report file is missing on disk");
  }
}
