import { getDb, schema, eq, toJsonSafe } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";

/** GET /api/batches/[id] — batch detail with its rows (tenant-scoped). */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const [batch] = await db
    .select()
    .from(schema.paymentBatches)
    .where(eq(schema.paymentBatches.id, params.id))
    .limit(1);
  if (!batch || batch.tenantId !== user!.tenantId) {
    return apiError(404, "NOT_FOUND", "Batch not found");
  }

  const rows = await db
    .select()
    .from(schema.paymentBatchRows)
    .where(eq(schema.paymentBatchRows.batchId, batch.id))
    .orderBy(schema.paymentBatchRows.rowNumber);

  return apiOk({ data: toJsonSafe({ ...batch, rows }) });
}
