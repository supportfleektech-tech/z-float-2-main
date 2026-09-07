import { reopenReconException } from "@zfloat/payments-core";
import { apiError, apiOk } from "@/lib/api";
import { reconApiContext, reconErrorResponse } from "@/lib/recon-api";

interface Params {
  params: Promise<{ id: string }>;
}

/** POST /api/reconciliation/exceptions/[id]/reopen — RESOLVED → OPEN for
 * further investigation (optional note; defaults sensibly). */
export async function POST(req: Request, { params }: Params) {
  const guard = await reconApiContext(true);
  if ("response" in guard) return guard.response;
  const { db, actorId, tenantId } = guard.ctx;
  const { id } = await params;
  let note: string | undefined;
  try {
    const body = (await req.json()) as { note?: unknown };
    if (body.note !== undefined) note = typeof body.note === "string" ? body.note : undefined;
  } catch {
    return apiError(400, "BAD_BODY", "JSON body expected");
  }
  try {
    const detail = await reopenReconException(db, { exceptionId: id, tenantId: tenantId ?? undefined, actorId, note });
    return apiOk({ data: detail });
  } catch (err) {
    return reconErrorResponse(err);
  }
}
