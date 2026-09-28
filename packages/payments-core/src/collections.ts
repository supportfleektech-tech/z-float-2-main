/**
 * Collections — receiving money (the inbound half of Z-float).
 *
 * Receive paths, all converging on `settleCollection`:
 *   MPESA_STK     request-to-pay: STK push to the payer's handset → callback
 *   MPESA_C2B     payer-initiated paybill/till payment → confirmation URL
 *   PAYMENT_LINK  hosted pay page (payment-links.ts)
 *   BANK_TRANSFER bank credit notification / manual record
 *
 * Money rules (same as the payout side):
 *   - settlement is idempotent (row lock + status check; C2B TransID / M-Pesa
 *     receipt is unique per channel at the DB level);
 *   - a SUCCESS always credits the wallet + wallet-ledger FUND entry + a
 *     balanced funding journal (Dr wallet / Cr float liability) in ONE tx;
 *   - `collection.received` is written to the outbox in the same tx → the
 *     relay issues the KRA eTIMS receipt, notifies, and fans out webhooks.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { schema, toJsonSafe, type Db, type Tx } from "@zfloat/database";
import { postFundingJournal, recordWalletFunding } from "@zfloat/ledger";
import { applyInvoicePayment } from "@zfloat/etims";
import type { C2BConfirmation, CollectionProvider, PaymentProvider } from "@zfloat/providers";
import { normalizeKenyanPhone } from "@zfloat/validation";
import { enqueueOutbox } from "./outbox.js";

export class CollectionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "CollectionError";
  }
}

export type CollectionChannel = "MPESA_STK" | "MPESA_C2B" | "PAYMENT_LINK" | "BANK_TRANSFER";
export type Collection = typeof schema.collections.$inferSelect;

/** M-Pesa per-transaction ceiling (KES 250,000) and 1 KES floor. */
export const COLLECTION_MIN_MINOR = 100n;
export const COLLECTION_MAX_MINOR = 250_000_00n;

export function generateCollectionNumber(now = new Date()): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `COL-${d}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function resolveWallet(db: Db | Tx, tenantId: string, walletId?: string | null) {
  const conds = [eq(schema.wallets.tenantId, tenantId)];
  if (walletId) conds.push(eq(schema.wallets.id, walletId));
  const [wallet] = await db.select().from(schema.wallets).where(and(...conds)).orderBy(schema.wallets.createdAt).limit(1);
  if (!wallet) throw new CollectionError("No wallet available to receive funds", "WALLET_NOT_FOUND");
  if (wallet.status !== "ACTIVE") throw new CollectionError("The receiving wallet is not active", "WALLET_INACTIVE");
  return wallet;
}

export interface PayerIdentity {
  name?: string | null;
  phone?: string | null;
  idType?: string | null;
  idNumber?: string | null;
  kraPin?: string | null;
}

async function payerFromCustomer(db: Db | Tx, tenantId: string, customerId?: string | null): Promise<PayerIdentity & { customerId: string | null }> {
  if (!customerId) return { customerId: null };
  const [c] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.id, customerId), eq(schema.customers.tenantId, tenantId)))
    .limit(1);
  if (!c) throw new CollectionError("Customer not found", "CUSTOMER_NOT_FOUND");
  return { customerId: c.id, name: c.name, phone: c.phone, idType: c.idType, idNumber: c.idNumber, kraPin: c.kraPin };
}

async function loadInvoice(db: Db | Tx, tenantId: string, invoiceId?: string | null) {
  if (!invoiceId) return null;
  const [inv] = await db
    .select()
    .from(schema.etimsDocuments)
    .where(and(eq(schema.etimsDocuments.id, invoiceId), eq(schema.etimsDocuments.tenantId, tenantId)))
    .limit(1);
  if (!inv || inv.docType !== "INVOICE") throw new CollectionError("Invoice not found", "INVOICE_NOT_FOUND");
  if (inv.status === "CANCELLED") throw new CollectionError("This invoice was cancelled", "INVOICE_CANCELLED");
  if (inv.paymentStatus === "PAID") throw new CollectionError(`Invoice ${inv.number} is already fully paid`, "INVOICE_PAID");
  return inv;
}

export interface RequestCollectionInput {
  tenantId: string;
  actorId: string;
  walletId?: string | null;
  /** Payer phone (any Kenyan format). */
  phone: string;
  /** Defaults to the invoice's outstanding balance when invoiceId is given. */
  amountMinor?: bigint;
  accountReference?: string;
  description?: string;
  invoiceId?: string | null;
  customerId?: string | null;
  payer?: PayerIdentity;
  idempotencyKey: string;
  kind?: "paybill" | "till";
}

/**
 * Request-to-pay via M-Pesa STK push. Creates the PENDING collection first
 * (so a crash mid-request never loses the correlation), then pushes the
 * prompt. The final outcome arrives on the webhook (or the sandbox simulator).
 */
export async function requestStkCollection(
  db: Db,
  input: RequestCollectionInput,
  provider: PaymentProvider & CollectionProvider,
): Promise<{ collection: Collection; replayed: boolean; customerMessage?: string }> {
  const [prior] = await db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.tenantId, input.tenantId), eq(schema.collections.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (prior) return { collection: prior, replayed: true };

  const phone = normalizeKenyanPhone(input.phone);
  if (!phone) throw new CollectionError("Enter a valid Kenyan mobile number for the payer", "INVALID_PHONE");

  const invoice = await loadInvoice(db, input.tenantId, input.invoiceId);
  const amountMinor = input.amountMinor ?? (invoice ? invoice.totalMinor - invoice.paidMinor : 0n);
  if (amountMinor < COLLECTION_MIN_MINOR) throw new CollectionError("Amount must be at least KES 1", "AMOUNT_TOO_SMALL");
  if (amountMinor > COLLECTION_MAX_MINOR) throw new CollectionError("M-Pesa allows at most KES 250,000 per transaction", "AMOUNT_TOO_LARGE");

  const wallet = await resolveWallet(db, input.tenantId, input.walletId);
  const fromCustomer = await payerFromCustomer(db, input.tenantId, input.customerId ?? invoice?.customerId);
  const payer: PayerIdentity = {
    name: input.payer?.name ?? fromCustomer.name ?? invoice?.customerName ?? null,
    idType: input.payer?.idType ?? fromCustomer.idType ?? invoice?.customerIdType ?? null,
    idNumber: input.payer?.idNumber ?? fromCustomer.idNumber ?? invoice?.customerIdNumber ?? null,
    kraPin: input.payer?.kraPin ?? fromCustomer.kraPin ?? invoice?.customerKraPin ?? null,
  };
  const accountReference = (input.accountReference?.trim() || invoice?.number || "Z-FLOAT").slice(0, 60);

  let collection: Collection;
  try {
    const [row] = await db
      .insert(schema.collections)
      .values({
        tenantId: input.tenantId,
        collectionNumber: generateCollectionNumber(),
        walletId: wallet.id,
        channel: "MPESA_STK",
        status: "PENDING",
        amountMinor,
        accountReference,
        description: input.description?.slice(0, 500) ?? (invoice ? `Payment for ${invoice.number}` : null),
        customerId: fromCustomer.customerId,
        payerName: payer.name ?? null,
        payerPhone: phone,
        payerIdType: payer.idType ?? null,
        payerIdNumber: payer.idNumber ?? null,
        payerKraPin: payer.kraPin ?? null,
        invoiceId: invoice?.id ?? null,
        providerCode: provider.code,
        idempotencyKey: input.idempotencyKey,
        requestedById: input.actorId,
      })
      .returning();
    collection = row!;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      const [again] = await db
        .select()
        .from(schema.collections)
        .where(and(eq(schema.collections.tenantId, input.tenantId), eq(schema.collections.idempotencyKey, input.idempotencyKey)))
        .limit(1);
      if (again) return { collection: again, replayed: true };
    }
    throw err;
  }

  try {
    const res = await provider.requestCollection({
      collectionId: collection.id,
      reference: collection.collectionNumber,
      amountMinor,
      currency: "KES",
      phone,
      accountReference,
      description: collection.description ?? accountReference,
      kind: input.kind,
    });
    if (res.status === "FAILED") {
      const failed = await failCollection(db, { collectionId: collection.id, reason: res.errorMessage ?? "Request rejected by provider", raw: res.raw });
      return { collection: failed, replayed: false };
    }
    const [updated] = await db
      .update(schema.collections)
      .set({ providerReference: res.providerReference ?? null, updatedAt: new Date() })
      .where(eq(schema.collections.id, collection.id))
      .returning();
    if (res.status === "SUCCESS") {
      const settled = await settleCollection(db, { collectionId: collection.id, raw: res.raw });
      return { collection: settled.collection, replayed: false, customerMessage: res.customerMessage };
    }
    return { collection: updated!, replayed: false, customerMessage: res.customerMessage };
  } catch (err) {
    const failed = await failCollection(db, {
      collectionId: collection.id,
      reason: err instanceof Error ? err.message : "Provider error",
    });
    return { collection: failed, replayed: false };
  }
}

export interface SettleCollectionInput {
  collectionId: string;
  /** Provider receipt (e.g. M-Pesa SFT3XYZ123). */
  receiptNumber?: string | null;
  /** Actual amount received — may differ from the request (STK rounds up to whole KES). */
  amountMinor?: bigint | null;
  payerName?: string | null;
  payerPhone?: string | null;
  raw?: Record<string, unknown> | null;
  actorId?: string | null;
  /** wallet-ledger ref type override (payment links keep "payment_link"). */
  refType?: string;
}

/**
 * Credit the wallet for a received payment. Idempotent: settling an already
 * SUCCESS collection is a no-op. A late success after a FAILED/EXPIRED
 * timeout still credits — the money really moved at the provider.
 */
export async function settleCollection(db: Db, input: SettleCollectionInput): Promise<{ collection: Collection; alreadySettled: boolean }> {
  return db.transaction(async (tx) => {
    const [col] = await tx.select().from(schema.collections).where(eq(schema.collections.id, input.collectionId)).for("update");
    if (!col) throw new CollectionError("Collection not found", "NOT_FOUND");
    if (col.status === "SUCCESS") return { collection: col, alreadySettled: true };
    if (col.status === "CANCELLED") throw new CollectionError("Collection was cancelled", "CANCELLED");

    const amount = input.amountMinor && input.amountMinor > 0n ? input.amountMinor : col.amountMinor;
    await tx
      .update(schema.wallets)
      .set({ availableMinor: sql`${schema.wallets.availableMinor} + ${amount}`, updatedAt: new Date() })
      .where(eq(schema.wallets.id, col.walletId));
    await recordWalletFunding(tx, {
      tenantId: col.tenantId,
      walletId: col.walletId,
      refType: input.refType ?? "collection",
      refId: col.paymentLinkId && input.refType === "payment_link" ? col.paymentLinkId : col.id,
      amountMinor: amount,
      note: `${col.channel} ${col.collectionNumber}${input.receiptNumber ? ` · ${input.receiptNumber}` : ""}`,
    });
    // Nested transaction → savepoint: the journal commits atomically with the wallet credit.
    await postFundingJournal(tx as unknown as Db, {
      tenantId: col.tenantId,
      walletId: col.walletId,
      amountMinor: amount,
      actorId: input.actorId ?? col.requestedById ?? undefined,
    });

    const [updated] = await tx
      .update(schema.collections)
      .set({
        status: "SUCCESS",
        amountMinor: amount,
        receiptNumber: input.receiptNumber ?? col.receiptNumber,
        payerName: col.payerName ?? input.payerName ?? null,
        payerPhone: col.payerPhone ?? (input.payerPhone ? normalizeKenyanPhone(input.payerPhone) : null),
        rawCallback: input.raw ? (toJsonSafe(input.raw) as Record<string, unknown>) : col.rawCallback,
        failureReason: null,
        settledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.collections.id, col.id))
      .returning();

    if (col.invoiceId) {
      await applyInvoicePayment(tx, { tenantId: col.tenantId, invoiceId: col.invoiceId, amountMinor: amount, collectionId: col.id });
    }

    await enqueueOutbox(tx, {
      eventType: "collection.received",
      aggregateType: "collection",
      aggregateId: col.id,
      tenantId: col.tenantId,
      payload: {
        collectionId: col.id,
        collectionNumber: col.collectionNumber,
        channel: col.channel,
        amountMinor: amount.toString(),
        currency: col.currency,
        receiptNumber: input.receiptNumber ?? col.receiptNumber,
        payerName: updated!.payerName,
        payerPhone: updated!.payerPhone,
        invoiceId: col.invoiceId,
        accountReference: col.accountReference,
      },
    });
    return { collection: updated!, alreadySettled: false };
  });
}

export async function failCollection(
  db: Db,
  input: { collectionId: string; reason: string; raw?: Record<string, unknown> | null },
): Promise<Collection> {
  return db.transaction(async (tx) => {
    const [col] = await tx.select().from(schema.collections).where(eq(schema.collections.id, input.collectionId)).for("update");
    if (!col) throw new CollectionError("Collection not found", "NOT_FOUND");
    if (col.status !== "PENDING") return col;
    const [updated] = await tx
      .update(schema.collections)
      .set({
        status: "FAILED",
        failureReason: input.reason.slice(0, 500),
        rawCallback: input.raw ? (toJsonSafe(input.raw) as Record<string, unknown>) : col.rawCallback,
        updatedAt: new Date(),
      })
      .where(eq(schema.collections.id, col.id))
      .returning();
    await enqueueOutbox(tx, {
      eventType: "collection.failed",
      aggregateType: "collection",
      aggregateId: col.id,
      tenantId: col.tenantId,
      payload: { collectionId: col.id, collectionNumber: col.collectionNumber, reason: input.reason, amountMinor: col.amountMinor.toString() },
    });
    return updated!;
  });
}

/** Find a PENDING/any collection by provider reference (STK CheckoutRequestID). */
export async function findCollectionByProviderReference(db: Db, providerReference: string): Promise<Collection | null> {
  const [row] = await db
    .select()
    .from(schema.collections)
    .where(eq(schema.collections.providerReference, providerReference))
    .orderBy(desc(schema.collections.createdAt))
    .limit(1);
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* C2B (payer-initiated paybill / till)                                */
/* ------------------------------------------------------------------ */

/**
 * Resolve a C2B account number ("BillRefNumber") to a tenant (+ invoice).
 * Accepted forms (case-insensitive):
 *   ACME               → tenant ACME, unlinked collection
 *   ACME-INV-000007    → tenant ACME, invoice INV-000007
 *   ACME#7 / ACME.7 / ACME 7 → tenant ACME, invoice INV-000007
 */
export async function resolveC2BAccount(
  db: Db,
  billRef: string,
): Promise<{ tenantId: string; invoiceId: string | null; invoiceNumber: string | null } | null> {
  const ref = billRef.trim().toUpperCase();
  if (!ref) return null;
  const m = /^([A-Z0-9]{2,20}?)(?:[-#. ](.+))?$/.exec(ref);
  if (!m) return null;
  const head = m[1]!;
  const tail = m[2]?.trim() ?? "";
  const [tenant] = await db
    .select({ id: schema.tenants.id, status: schema.tenants.status })
    .from(schema.tenants)
    .where(eq(schema.tenants.collectionAccountRef, head))
    .limit(1);
  if (!tenant || tenant.status === "SUSPENDED" || tenant.status === "CLOSED") return null;
  if (!tail) return { tenantId: tenant.id, invoiceId: null, invoiceNumber: null };
  const inv = /^(?:INV-?)?0*(\d{1,6})$/.exec(tail);
  if (!inv) return { tenantId: tenant.id, invoiceId: null, invoiceNumber: null };
  const invoiceNumber = `INV-${inv[1]!.padStart(6, "0")}`;
  const [doc] = await db
    .select({ id: schema.etimsDocuments.id })
    .from(schema.etimsDocuments)
    .where(
      and(
        eq(schema.etimsDocuments.tenantId, tenant.id),
        eq(schema.etimsDocuments.number, invoiceNumber),
        eq(schema.etimsDocuments.docType, "INVOICE"),
      ),
    )
    .limit(1);
  return { tenantId: tenant.id, invoiceId: doc?.id ?? null, invoiceNumber: doc ? invoiceNumber : null };
}

/** Daraja C2B validation — accept only accounts we can attribute. */
export async function validateC2BPayment(db: Db, c2b: C2BConfirmation): Promise<{ accept: boolean; resultCode: string; resultDesc: string }> {
  if (c2b.amountMinor < COLLECTION_MIN_MINOR) return { accept: false, resultCode: "C2B00013", resultDesc: "Rejected: invalid amount" };
  const target = await resolveC2BAccount(db, c2b.billRefNumber);
  if (!target) return { accept: false, resultCode: "C2B00012", resultDesc: "Rejected: invalid account number" };
  return { accept: true, resultCode: "0", resultDesc: "Accepted" };
}

/**
 * Daraja C2B confirmation → SUCCESS collection (idempotent by TransID).
 * Unattributable payments become reconciliation orphans instead of being lost.
 */
export async function recordC2BPayment(
  db: Db,
  c2b: C2BConfirmation,
): Promise<{ status: "SETTLED" | "DUPLICATE" | "UNMATCHED"; collection?: Collection }> {
  const [dupe] = await db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.channel, "MPESA_C2B"), eq(schema.collections.receiptNumber, c2b.transId)))
    .limit(1);
  if (dupe) return { status: "DUPLICATE", collection: dupe };

  const target = await resolveC2BAccount(db, c2b.billRefNumber);
  if (!target) {
    const [orphan] = await db
      .select({ id: schema.reconItems.id })
      .from(schema.reconItems)
      .where(and(eq(schema.reconItems.source, "MPESA_C2B"), eq(schema.reconItems.providerReference, c2b.transId)))
      .limit(1);
    if (!orphan) {
      await db.insert(schema.reconItems).values({
        tenantId: "00000000-0000-0000-0000-000000000000",
        source: "MPESA_C2B",
        providerReference: c2b.transId,
        amountMinor: c2b.amountMinor,
        currency: "KES",
        occurredAt: new Date(),
        status: "UNKNOWN",
        notes: `C2B payment with unknown account "${c2b.billRefNumber}" from ${c2b.msisdn}`,
      });
    }
    return { status: "UNMATCHED" };
  }

  const wallet = await resolveWallet(db, target.tenantId);
  const phone = normalizeKenyanPhone(c2b.msisdn) ?? null;
  // Match the payer to a known customer by phone → identity (ID / KRA PIN) on the receipt.
  const [customer] = phone
    ? await db
        .select()
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, target.tenantId), eq(schema.customers.phone, phone)))
        .limit(1)
    : [];
  let invoiceId = target.invoiceId;
  if (invoiceId) {
    const [inv] = await db
      .select({ paymentStatus: schema.etimsDocuments.paymentStatus })
      .from(schema.etimsDocuments)
      .where(eq(schema.etimsDocuments.id, invoiceId))
      .limit(1);
    if (inv?.paymentStatus === "PAID") invoiceId = null; // over-payment: keep as unlinked credit
  }
  let row: Collection;
  try {
    const [inserted] = await db
      .insert(schema.collections)
      .values({
        tenantId: target.tenantId,
        collectionNumber: generateCollectionNumber(),
        walletId: wallet.id,
        channel: "MPESA_C2B",
        status: "PENDING",
        amountMinor: c2b.amountMinor,
        accountReference: c2b.billRefNumber.slice(0, 60),
        description: target.invoiceNumber ? `Paybill payment for ${target.invoiceNumber}` : `Paybill payment (${c2b.transType || "C2B"})`,
        customerId: customer?.id ?? null,
        payerName: c2b.payerName || customer?.name || null,
        payerPhone: phone,
        payerIdType: customer?.idType ?? null,
        payerIdNumber: customer?.idNumber ?? null,
        payerKraPin: customer?.kraPin ?? null,
        invoiceId,
        providerCode: "mpesa-safaricom",
        providerReference: c2b.transId,
        receiptNumber: c2b.transId,
        idempotencyKey: `c2b:${c2b.transId}`,
        rawCallback: toJsonSafe(c2b.raw) as Record<string, unknown>,
      })
      .returning();
    row = inserted!;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      const [again] = await db
        .select()
        .from(schema.collections)
        .where(and(eq(schema.collections.channel, "MPESA_C2B"), eq(schema.collections.receiptNumber, c2b.transId)))
        .limit(1);
      return { status: "DUPLICATE", collection: again };
    }
    throw err;
  }
  const { collection } = await settleCollection(db, { collectionId: row.id, receiptNumber: c2b.transId, raw: c2b.raw });
  return { status: "SETTLED", collection };
}

/* ------------------------------------------------------------------ */
/* Bank transfers (manual record / bank notification)                   */
/* ------------------------------------------------------------------ */

export async function recordBankCollection(
  db: Db,
  input: {
    tenantId: string;
    actorId: string;
    amountMinor: bigint;
    bankReference: string;
    payer?: PayerIdentity;
    customerId?: string | null;
    invoiceId?: string | null;
    description?: string;
  },
): Promise<Collection> {
  if (input.amountMinor < COLLECTION_MIN_MINOR) throw new CollectionError("Amount must be at least KES 1", "AMOUNT_TOO_SMALL");
  const ref = input.bankReference.trim();
  if (ref.length < 4) throw new CollectionError("Bank reference is required", "REFERENCE_REQUIRED");
  const invoice = await loadInvoice(db, input.tenantId, input.invoiceId);
  const wallet = await resolveWallet(db, input.tenantId);
  const fromCustomer = await payerFromCustomer(db, input.tenantId, input.customerId ?? invoice?.customerId);
  let row: Collection;
  try {
    const [inserted] = await db
      .insert(schema.collections)
      .values({
        tenantId: input.tenantId,
        collectionNumber: generateCollectionNumber(),
        walletId: wallet.id,
        channel: "BANK_TRANSFER",
        status: "PENDING",
        amountMinor: input.amountMinor,
        accountReference: invoice?.number ?? ref.slice(0, 60),
        description: input.description ?? (invoice ? `Bank transfer for ${invoice.number}` : "Bank transfer"),
        customerId: fromCustomer.customerId,
        payerName: input.payer?.name ?? fromCustomer.name ?? invoice?.customerName ?? null,
        payerPhone: input.payer?.phone ? normalizeKenyanPhone(input.payer.phone) : fromCustomer.phone ?? null,
        payerIdType: input.payer?.idType ?? fromCustomer.idType ?? null,
        payerIdNumber: input.payer?.idNumber ?? fromCustomer.idNumber ?? null,
        payerKraPin: input.payer?.kraPin ?? fromCustomer.kraPin ?? invoice?.customerKraPin ?? null,
        invoiceId: invoice?.id ?? null,
        providerCode: "bank-psp",
        providerReference: ref,
        receiptNumber: ref.toUpperCase().slice(0, 40),
        idempotencyKey: `bank:${ref.toUpperCase()}`,
        requestedById: input.actorId,
      })
      .returning();
    row = inserted!;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new CollectionError("A bank transfer with this reference was already recorded", "DUPLICATE_REFERENCE");
    }
    throw err;
  }
  return (await settleCollection(db, { collectionId: row.id, receiptNumber: row.receiptNumber, actorId: input.actorId })).collection;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function listCollections(
  db: Db,
  tenantId: string,
  opts: { status?: string; channel?: string; q?: string; limit?: number } = {},
): Promise<Collection[]> {
  const conds = [eq(schema.collections.tenantId, tenantId)];
  if (opts.status) conds.push(eq(schema.collections.status, opts.status));
  if (opts.channel) conds.push(eq(schema.collections.channel, opts.channel));
  if (opts.q) {
    const like = `%${opts.q.replace(/[%_]/g, "")}%`;
    conds.push(
      or(
        ilike(schema.collections.collectionNumber, like),
        ilike(schema.collections.payerName, like),
        ilike(schema.collections.payerPhone, like),
        ilike(schema.collections.payerIdNumber, like),
        ilike(schema.collections.payerKraPin, like),
        ilike(schema.collections.receiptNumber, like),
        ilike(schema.collections.accountReference, like),
      )!,
    );
  }
  return db
    .select()
    .from(schema.collections)
    .where(and(...conds))
    .orderBy(desc(schema.collections.createdAt))
    .limit(Math.min(opts.limit ?? 100, 500));
}

export async function collectionStats(db: Db, tenantId: string) {
  const since = new Date(Date.now() - 30 * 86400_000);
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({
      receivedToday: sql<string>`COALESCE(SUM(CASE WHEN ${schema.collections.status} = 'SUCCESS' AND ${schema.collections.settledAt} >= ${startOfDay} THEN ${schema.collections.amountMinor} ELSE 0 END), 0)`,
      received30d: sql<string>`COALESCE(SUM(CASE WHEN ${schema.collections.status} = 'SUCCESS' THEN ${schema.collections.amountMinor} ELSE 0 END), 0)`,
      pendingMinor: sql<string>`COALESCE(SUM(CASE WHEN ${schema.collections.status} = 'PENDING' THEN ${schema.collections.amountMinor} ELSE 0 END), 0)`,
      successCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.collections.status} = 'SUCCESS')`,
      pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.collections.status} = 'PENDING')`,
      failedCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.collections.status} = 'FAILED')`,
    })
    .from(schema.collections)
    .where(and(eq(schema.collections.tenantId, tenantId), gte(schema.collections.createdAt, since)));
  return {
    receivedTodayMinor: String(row?.receivedToday ?? "0"),
    received30dMinor: String(row?.received30d ?? "0"),
    pendingMinor: String(row?.pendingMinor ?? "0"),
    successCount: Number(row?.successCount ?? 0),
    pendingCount: Number(row?.pendingCount ?? 0),
    failedCount: Number(row?.failedCount ?? 0),
  };
}

/** Expire STK requests the payer never answered (Daraja prompts time out after ~60s). */
export async function expireStaleCollections(db: Db, olderThanMs = 10 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db
    .update(schema.collections)
    .set({ status: "EXPIRED", failureReason: "Payer did not complete the M-Pesa prompt", updatedAt: new Date() })
    .where(and(eq(schema.collections.status, "PENDING"), eq(schema.collections.channel, "MPESA_STK"), sql`${schema.collections.createdAt} < ${cutoff}`))
    .returning({ id: schema.collections.id });
  return rows.length;
}
