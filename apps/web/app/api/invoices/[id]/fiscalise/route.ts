/** POST /api/invoices/:id/fiscalise — sign a draft/failed document with KRA eTIMS (idempotent for SIGNED). */
import { getDb } from "@zfloat/database";
import { requirePermission } from "@/lib/api";
import { fiscaliseDocument } from "@zfloat/etims";
import { jsonOk, receivablesError } from "@/lib/receivables";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requirePermission("invoices.manage");
  if (response) return response;
  const { db } = getDb();
  try {
    const doc = await fiscaliseDocument(db, { tenantId: user!.tenantId!, documentId: params.id, actorName: user!.fullName ?? undefined });
    return jsonOk({ data: doc });
  } catch (err) {
    return receivablesError(err, "eTIMS signing failed");
  }
}
