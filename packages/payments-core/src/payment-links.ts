/**
 * Payment links — public "request money" pages backed by the sandbox rail.
 * When a payer completes the flow a PAYMENT_LINK collection is settled: the
 * tenant's wallet is funded via a double-entry funding journal (float
 * liability), an eTIMS receipt is issued and the tenant is notified.
 * Token-scoped, expiry/usage-limited, tenant-isolated.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";
import { getWalletBalance } from "@zfloat/ledger";
import { normalizeKenyanPhone } from "@zfloat/validation";
import { generateCollectionNumber, settleCollection } from "./collections.js";

export interface PaymentLinkInput {
  tenantId: string;
  actorId: string;
  name: string;
  description?: string;
  amountMinor: bigint;
  channel?: string;
  maxUses?: number;
  expiresAt?: Date;
}

export function generateLinkToken(): string {
  return `pl_${randomBytes(12).toString("base64url")}`;
}

export async function createPaymentLink(db: Db, input: PaymentLinkInput) {
  const [row] = await db
    .insert(schema.paymentLinks)
    .values({
      tenantId: input.tenantId,
      token: generateLinkToken(),
      name: input.name,
      description: input.description ?? null,
      amountMinor: input.amountMinor,
      currency: "KES",
      channel: input.channel ?? "mpesa",
      status: "ACTIVE",
      maxUses: input.maxUses ?? null,
      expiresAt: input.expiresAt ?? null,
      createdById: input.actorId,
    })
    .returning();
  if (!row) throw new Error("Failed to create payment link");
  return row;
}

export async function listPaymentLinks(db: Db, tenantId: string, limit = 50) {
  return db
    .select({
      id: schema.paymentLinks.id,
      token: schema.paymentLinks.token,
      name: schema.paymentLinks.name,
      description: schema.paymentLinks.description,
      amountMinor: schema.paymentLinks.amountMinor,
      currency: schema.paymentLinks.currency,
      status: schema.paymentLinks.status,
      maxUses: schema.paymentLinks.maxUses,
      useCount: schema.paymentLinks.useCount,
      expiresAt: schema.paymentLinks.expiresAt,
      createdAt: schema.paymentLinks.createdAt,
    })
    .from(schema.paymentLinks)
    .where(eq(schema.paymentLinks.tenantId, tenantId))
    .orderBy(desc(schema.paymentLinks.createdAt))
    .limit(limit);
}

export interface PaymentLinkView {
  id: string;
  tenantName: string;
  name: string;
  description: string | null;
  amountMinor: string;
  currency: string;
  status: string;
}

/** Public read of a link (no auth) — exposes only safe display fields. */
export async function getPaymentLinkView(db: Db, token: string): Promise<PaymentLinkView | null> {
  const [link] = await db
    .select({
      id: schema.paymentLinks.id,
      tenantId: schema.paymentLinks.tenantId,
      name: schema.paymentLinks.name,
      description: schema.paymentLinks.description,
      amountMinor: schema.paymentLinks.amountMinor,
      currency: schema.paymentLinks.currency,
      status: schema.paymentLinks.status,
      maxUses: schema.paymentLinks.maxUses,
      useCount: schema.paymentLinks.useCount,
      expiresAt: schema.paymentLinks.expiresAt,
    })
    .from(schema.paymentLinks)
    .where(eq(schema.paymentLinks.token, token))
    .limit(1);
  if (!link) return null;
  const [tenant] = await db
    .select({ name: schema.tenants.name })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, link.tenantId))
    .limit(1);
  return {
    id: link.id,
    tenantName: tenant?.name ?? "Z-float merchant",
    name: link.name,
    description: link.description,
    amountMinor: link.amountMinor.toString(),
    currency: link.currency,
    status: link.status,
  };
}

/**
 * Complete a payment via a link. Every link payment is a first-class
 * collection (channel PAYMENT_LINK): the use is claimed atomically (maxUses
 * can never be exceeded by concurrent payers), then `settleCollection`
 * credits the wallet + wallet-ledger + balanced funding journal in one tx and
 * emits `collection.received` (→ eTIMS receipt, notification, webhooks).
 * Idempotent per (token, payerRef) via the collection idempotency key.
 */
export async function collectViaPaymentLink(
  db: Db,
  input: { token: string; payerRef: string; payerName?: string; payerPhone?: string },
): Promise<{ fundedMinor: bigint; walletBalanceMinor: string; paymentLinkId: string; collectionId: string; collectionNumber: string }> {
  const [link] = await db
    .select()
    .from(schema.paymentLinks)
    .where(eq(schema.paymentLinks.token, input.token))
    .limit(1);
  if (!link) throw new Error("Payment link not found");
  if (link.status !== "ACTIVE") throw new Error("This payment link is not active");
  if (link.expiresAt && link.expiresAt < new Date()) throw new Error("This payment link has expired");

  const idempotencyKey = `paylink:${input.token}:${input.payerRef}`.slice(0, 128);
  const [prior] = await db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.tenantId, link.tenantId), eq(schema.collections.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (prior) {
    const bal = await getWalletBalance(db, prior.walletId, link.tenantId);
    return {
      fundedMinor: prior.amountMinor,
      walletBalanceMinor: bal.availableMinor.toString(),
      paymentLinkId: link.id,
      collectionId: prior.id,
      collectionNumber: prior.collectionNumber,
    };
  }

  const [wallet] = await db
    .select()
    .from(schema.wallets)
    .where(eq(schema.wallets.tenantId, link.tenantId))
    .orderBy(schema.wallets.createdAt)
    .limit(1);
  if (!wallet) throw new Error("Merchant wallet is not configured");

  // Atomic use claim — the WHERE clause is the concurrency guard.
  const claimed = await db
    .update(schema.paymentLinks)
    .set({ useCount: sql`${schema.paymentLinks.useCount} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(schema.paymentLinks.id, link.id),
        or(isNull(schema.paymentLinks.maxUses), sql`${schema.paymentLinks.useCount} < ${schema.paymentLinks.maxUses}`),
      ),
    )
    .returning({ id: schema.paymentLinks.id });
  if (claimed.length === 0) throw new Error("This payment link has reached its usage limit");

  const [collection] = await db
    .insert(schema.collections)
    .values({
      tenantId: link.tenantId,
      collectionNumber: generateCollectionNumber(),
      walletId: wallet.id,
      channel: "PAYMENT_LINK",
      status: "PENDING",
      amountMinor: link.amountMinor,
      accountReference: link.token.slice(0, 60),
      description: link.name,
      payerName: input.payerName ?? null,
      payerPhone: input.payerPhone ? normalizeKenyanPhone(input.payerPhone) : null,
      paymentLinkId: link.id,
      providerCode: "local-sandbox",
      providerReference: `LNK-${input.token.slice(0, 8).toUpperCase()}-${input.payerRef.slice(0, 6).toUpperCase()}`,
      idempotencyKey,
      requestedById: link.createdById,
    })
    .returning();

  await settleCollection(db, { collectionId: collection!.id, refType: "payment_link", actorId: link.createdById });

  const balance = await getWalletBalance(db, wallet.id, link.tenantId);
  return {
    fundedMinor: link.amountMinor,
    walletBalanceMinor: balance.availableMinor.toString(),
    paymentLinkId: link.id,
    collectionId: collection!.id,
    collectionNumber: collection!.collectionNumber,
  };
}
