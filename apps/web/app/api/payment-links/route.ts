import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { createPaymentLink, listPaymentLinks } from "@zfloat/payments-core";

/** GET /api/payment-links — tenant's links (newest first). */
export async function GET(_request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const links = await listPaymentLinks(db, user!.tenantId!);
  return apiOk({
    data: links.map((l) => ({
      id: l.id,
      token: l.token,
      name: l.name,
      description: l.description,
      amountMinor: l.amountMinor.toString(),
      currency: l.currency,
      status: l.status,
      maxUses: l.maxUses,
      useCount: l.useCount,
      expiresAt: l.expiresAt,
      createdAt: l.createdAt,
      url: `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/pay/${l.token}`,
    })),
  });
}

/** POST /api/payment-links — create a link. */
export async function POST(request: NextRequest) {
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
  const name = String(b.name ?? "").trim();
  const amountDecimal = String(b.amount ?? "");
  if (!name) return apiError(400, "NAME_REQUIRED", "Give the link a name");
  const amountMinor = Math.round(parseFloat(amountDecimal) * 100);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return apiError(400, "INVALID_AMOUNT", "Enter a valid amount in KES");

  try {
    const link = await createPaymentLink(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      name,
      description: b.description ? String(b.description).trim() : undefined,
      amountMinor: BigInt(amountMinor),
      maxUses: b.maxUses ? Math.max(1, Math.min(1000, Number(b.maxUses))) : undefined,
      expiresAt: b.expiresAt ? new Date(String(b.expiresAt)) : undefined,
    });
    return apiOk(
      {
        data: {
          id: link.id,
          token: link.token,
          name: link.name,
          amountMinor: link.amountMinor.toString(),
          status: link.status,
          url: `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/pay/${link.token}`,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return apiError(400, "LINK_CREATE_FAILED", err instanceof Error ? err.message : "Could not create payment link");
  }
}
