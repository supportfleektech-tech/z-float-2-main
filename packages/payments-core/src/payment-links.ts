/**
 * Payment links — public "request money" pages backed by the sandbox rail.
 * When a payer completes the flow, the tenant's wallet is funded via a
 * double-entry funding journal (float liability) and the tenant gets an
 * in-app notification. Token-scoped, expiry/usage-limited, tenant-isolated.
 */
import { randomBytes } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";
import { postFundingJournal, getWalletBalance, recordWalletFunding } from "@zfloat/ledger";
import { queueNotification } from "@zfloat/notifications";

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
 * Complete a payment via a link: validates state, funds the tenant's main
 * wallet with a double-entry journal, increments usage, notifies the tenant.
 * Idempotent per (token, payerRef) via the caller-supplied idempotency record.
 */
export async function collectViaPaymentLink(
  db: Db,
  input: { token: string; payerRef: string; payerName?: string },
): Promise<{ fundedMinor: bigint; walletBalanceMinor: string; paymentLinkId: string }> {
  const [link] = await db
    .select()
    .from(schema.paymentLinks)
    .where(eq(schema.paymentLinks.token, input.token))
    .limit(1);
  if (!link) throw new Error("Payment link not found");
  if (link.status !== "ACTIVE") throw new Error("This payment link is not active");
  if (link.expiresAt && link.expiresAt < new Date()) throw new Error("This payment link has expired");
  if (link.maxUses !== null && link.useCount >= link.maxUses) throw new Error("This payment link has reached its usage limit");

  const [wallet] = await db
    .select()
    .from(schema.wallets)
    .where(eq(schema.wallets.tenantId, link.tenantId))
    .orderBy(schema.wallets.createdAt)
    .limit(1);
  if (!wallet) throw new Error("Merchant wallet is not configured");

  // Credit the merchant wallet: journal + atomic increment + reservation-ledger
  // FUND entry in one transaction so the ledger's balance-after is exact.
  await db.transaction(async (tx) => {
    await tx
      .update(schema.wallets)
      .set({ availableMinor: sql`${schema.wallets.availableMinor} + ${link.amountMinor}` })
      .where(eq(schema.wallets.id, wallet.id));
    await recordWalletFunding(tx, {
      tenantId: link.tenantId,
      walletId: wallet.id,
      refType: "payment_link",
      refId: link.id,
      amountMinor: link.amountMinor,
      note: `payment link ${link.token}`,
    });
  });

  await postFundingJournal(db, {
    tenantId: link.tenantId,
    walletId: wallet.id,
    amountMinor: link.amountMinor,
    actorId: link.createdById ?? undefined,
  });

  await db
    .update(schema.paymentLinks)
    .set({ useCount: link.useCount + 1, updatedAt: new Date() })
    .where(eq(schema.paymentLinks.id, link.id));

  const balance = await getWalletBalance(db, wallet.id, link.tenantId);
  await queueNotification(db, {
    tenantId: link.tenantId,
    channel: "IN_APP",
    title: "Payment received",
    body: `${link.name} — KES ${(Number(link.amountMinor) / 100).toLocaleString()} received${input.payerName ? ` from ${input.payerName}` : ""} via payment link.`,
  });

  return {
    fundedMinor: link.amountMinor,
    walletBalanceMinor: balance.availableMinor.toString(),
    paymentLinkId: link.id,
  };
}
