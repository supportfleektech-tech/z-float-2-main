/**
 * POST /api/collections/:id/simulate { outcome: "success" | "fail" }
 * Sandbox only: completes a PENDING request-to-pay exactly as the provider
 * callback would (the local sandbox has no phone to enter a PIN on).
 * Refused for collections created through a real provider.
 */
import { getDb, schema, and, eq } from "@zfloat/database";
import { requirePermission, apiError } from "@/lib/api";
import { settleCollection, failCollection } from "@zfloat/payments-core";
import { jsonOk, readJson, receivablesError } from "@/lib/receivables";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requirePermission("collections.manage");
  if (response) return response;
  const b = (await readJson(request)) ?? {};
  const { db } = getDb();
  const [row] = await db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.id, params.id), eq(schema.collections.tenantId, user!.tenantId!)))
    .limit(1);
  if (!row) return apiError(404, "NOT_FOUND", "Collection not found");
  if (row.providerCode !== "local-sandbox") {
    return apiError(403, "NOT_SANDBOX", "Only sandbox payment requests can be simulated — real ones complete on the payer's phone");
  }
  if (row.status !== "PENDING") return apiError(409, "NOT_PENDING", `This request is already ${row.status}`);
  try {
    if (b.outcome === "fail") {
      const failed = await failCollection(db, { collectionId: row.id, reason: "Request cancelled by user (sandbox)" });
      return jsonOk({ data: failed });
    }
    const receipt = `SBX${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
    const { collection } = await settleCollection(db, { collectionId: row.id, receiptNumber: receipt, actorId: user!.userId });
    return jsonOk({ data: collection });
  } catch (err) {
    return receivablesError(err);
  }
}
