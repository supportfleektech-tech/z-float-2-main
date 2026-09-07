import { commentOnReconException } from "@zfloat/payments-core";
import { apiError, apiOk } from "@/lib/api";
import { reconApiContext, reconErrorResponse } from "@/lib/recon-api";

interface Params {
  params: Promise<{ id: string }>;
}

/** POST /api/reconciliation/exceptions/[id]/comment — note in any status,
 * no state change. */
export async function POST(req: Request, { params }: Params) {
  const guard = await reconApiContext(true);
  if ("response" in guard) return guard.response;
  const { db, actorId, tenantId } = guard.ctx;
  const { id } = await params;
  let note = "";
  try {
    const body = (await req.json()) as { note?: unknown };
    note = typeof body.note === "string" ? body.note : "";
  } catch {
    return apiError(400, "BAD_BODY", "JSON body with a `note` field is required");
  }
  try {
    const detail = await commentOnReconException(db, { exceptionId: id, tenantId: tenantId ?? undefined, actorId, note });
    return apiOk({ data: detail });
  } catch (err) {
    return reconErrorResponse(err);
  }
}
