import { getDb } from "@zfloat/database";
import { runReconciliation } from "@zfloat/payments-core";
import { requireUser, apiOk, apiError } from "@/lib/api"; export async function POST() { const { response } = await requireUser(); if (response) return response; const { db } = getDb(); try { const result = await runReconciliation(db); return apiOk({ data: { ...result, message: `Matched ${result.matched}, raised ${result.exceptions} exception(s).` } }); } catch (err) { return apiError(400, "RECON_FAILED", err instanceof Error ? err.message : "Reconciliation failed"); }
}
