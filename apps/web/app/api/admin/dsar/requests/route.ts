import { NextRequest } from "next/server";
import { getDb, schema, desc, eq, sql } from "@zfloat/database";
import { requirePlatformAdmin, apiOk, apiError } from "@/lib/api";

/**
 * Admin DSAR intake queue (GAP closeout).
 *  GET   /api/admin/dsar/requests[?status=REQUESTED] — list data-subject requests
 *  PATCH /api/admin/dsar/requests  { id, status, note? } — triage:
 *        REQUESTED → IN_REVIEW → COMPLETED | REJECTED
 * (identity-check first; fulfilment itself runs through the export/erasure
 * endpoints — intake rows never execute anything on their own.)
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const status = request.nextUrl.searchParams.get("status");

  const where = status ? eq(schema.dataRequests.status, status) : sql`true`;
  const rows = await db
    .select({
      id: schema.dataRequests.id,
      type: schema.dataRequests.type,
      status: schema.dataRequests.status,
      requesterEmail: schema.dataRequests.requesterEmail,
      requesterName: schema.dataRequests.requesterName,
      userId: schema.dataRequests.userId,
      note: schema.dataRequests.note,
      payloadRef: schema.dataRequests.payloadRef,
      requestedAt: schema.dataRequests.requestedAt,
      completedAt: schema.dataRequests.completedAt,
    })
    .from(schema.dataRequests)
    .where(where)
    .orderBy(desc(schema.dataRequests.requestedAt))
    .limit(200);

  return apiOk({ data: { requests: rows } });
}

export async function PATCH(request: NextRequest) {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const id = String(b.id ?? "");
  const status = String(b.status ?? "").toUpperCase();
  const note = String(b.note ?? "").trim().slice(0, 2000) || null;

  if (!id) return apiError(400, "ID_REQUIRED", "Provide the request id");
  if (!["IN_REVIEW", "COMPLETED", "REJECTED"].includes(status)) {
    return apiError(400, "INVALID_STATUS", "status must be one of: IN_REVIEW|COMPLETED|REJECTED");
  }

  const [row] = await db
    .update(schema.dataRequests)
    .set({
      status,
      note: note ?? undefined,
      completedAt: status === "COMPLETED" || status === "REJECTED" ? new Date() : undefined,
    })
    .where(eq(schema.dataRequests.id, id))
    .returning();
  if (!row) return apiError(404, "NOT_FOUND", "Request not found");

  return apiOk({ data: { id: row.id, status: row.status } });
}
