/** POST /api/invoices/:id/credit-note { reason } — signed documents are immutable; corrections are credit notes. */
import { getDb } from "@zfloat/database";
import { requirePermission, apiError } from "@/lib/api";
import { createCreditNote, fiscaliseDocument } from "@zfloat/etims";
import { jsonOk, readJson, receivablesError } from "@/lib/receivables";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requirePermission("invoices.manage");
  if (response) return response;
  const b = (await readJson(request)) ?? {};
  const reason = String(b.reason ?? "").trim();
  if (reason.length < 3) return apiError(400, "REASON_REQUIRED", "Give a reason for the credit note");
  const { db } = getDb();
  try {
    const note = await createCreditNote(db, { tenantId: user!.tenantId!, actorId: user!.userId, originalDocumentId: params.id, reason });
    try {
      return jsonOk({ data: await fiscaliseDocument(db, { tenantId: user!.tenantId!, documentId: note.id }) }, { status: 201 });
    } catch (err) {
      return jsonOk({ data: note, fiscaliseError: err instanceof Error ? err.message : "eTIMS signing failed" }, { status: 201 });
    }
  } catch (err) {
    return receivablesError(err, "Could not create the credit note");
  }
}
