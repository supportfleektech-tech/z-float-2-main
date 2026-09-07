import { getDb } from "@zfloat/database";
import { fundWallet } from "@zfloat/payments-core";
import { requireUser, apiOk, apiError } from "@/lib/api";

export async function POST(request: Request, { params }: { params: { id: string } }) {
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
  try {
    const result = await fundWallet(db, {
      tenantId: user!.tenantId!,
      walletId: params.id,
      amount: String(b.amount ?? "0"),
      method: String(b.method ?? "BANK_TRANSFER"),
      reference: b.reference ? String(b.reference) : undefined,
      actorId: user!.userId,
    });
    return apiOk({ data: result });
  } catch (err) {
    return apiError(400, "FUND_FAILED", err instanceof Error ? err.message : "Funding failed");
  }
}
