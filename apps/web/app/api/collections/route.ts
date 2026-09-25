/**
 * Receiving money.
 *  GET  /api/collections?status=&channel=&q=  — list + 30-day stats
 *  POST /api/collections                       — request-to-pay (M-Pesa STK push)
 */
import { getDb } from "@zfloat/database";
import { requirePermission, requireUser, apiError, rateLimit } from "@/lib/api";
import { requestStkCollection, listCollections, collectionStats } from "@zfloat/payments-core";
import { normalizeIdentity } from "@zfloat/validation";
import { collectionProvider, jsonOk, parseKesToMinor, readJson, receivablesError } from "@/lib/receivables";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const sp = new URL(request.url).searchParams;
  const [rows, stats] = await Promise.all([
    listCollections(db, user!.tenantId!, {
      status: sp.get("status") || undefined,
      channel: sp.get("channel") || undefined,
      q: sp.get("q") || undefined,
      limit: Number(sp.get("limit") ?? 100),
    }),
    collectionStats(db, user!.tenantId!),
  ]);
  return jsonOk({ data: rows, stats });
}

export async function POST(request: Request) {
  const { user, response } = await requirePermission("collections.manage");
  if (response) return response;
  if (!(await rateLimit(`stk:${user!.tenantId}`, { windowMs: 60_000, max: 30 }))) {
    return apiError(429, "RATE_LIMITED", "Too many payment requests — wait a minute and try again");
  }
  const b = await readJson(request);
  if (!b) return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  const phone = String(b.phone ?? "").trim();
  if (!phone) return apiError(400, "PHONE_REQUIRED", "Enter the payer's M-Pesa phone number");
  const amountMinor = b.amount !== undefined && b.amount !== "" ? parseKesToMinor(b.amount) : undefined;
  if (amountMinor === null) return apiError(400, "INVALID_AMOUNT", "Enter a valid amount in KES");
  if (amountMinor === undefined && !b.invoiceId) return apiError(400, "INVALID_AMOUNT", "Enter an amount or choose an invoice");
  const idempotencyKey = String(request.headers.get("idempotency-key") ?? b.idempotencyKey ?? crypto.randomUUID());

  const { db } = getDb();
  try {
    const identity = normalizeIdentity({
      idType: b.idType ? String(b.idType) : null,
      idNumber: b.idNumber ? String(b.idNumber) : null,
      kraPin: b.kraPin ? String(b.kraPin) : null,
    });
    const { collection, replayed } = await requestStkCollection(
      db,
      {
        tenantId: user!.tenantId!,
        actorId: user!.userId,
        phone,
        amountMinor,
        description: b.description ? String(b.description).slice(0, 180) : undefined,
        accountReference: b.accountReference ? String(b.accountReference) : undefined,
        invoiceId: b.invoiceId ? String(b.invoiceId) : null,
        customerId: b.customerId ? String(b.customerId) : null,
        payer: { name: b.payerName ? String(b.payerName) : null, ...identity },
        idempotencyKey,
      },
      collectionProvider(),
    );
    return jsonOk({ data: collection, replayed }, { status: replayed ? 200 : 201 });
  } catch (err) {
    return receivablesError(err, "Could not send the payment request");
  }
}
