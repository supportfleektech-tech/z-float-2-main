/**
 * eTIMS document service — tax invoices, sales receipts, credit notes and
 * payment receipts, fiscalised through the configured OSCU/VSCU client.
 *
 * Fiscalisation is a two-phase operation so no DB lock is held across the
 * network call to KRA:
 *   phase 1 (tx): lock the document + device, allocate the sequential KRA
 *                 invcNo (reused on retries), persist the request payload,
 *                 mark QUEUED.
 *   network     : saveTrnsSalesOsdc.
 *   phase 2 (tx): persist the signature → SIGNED (immutable from then on,
 *                 trigger-enforced), or record the error (QUEUED = retryable,
 *                 FAILED = rejected by KRA, needs a human).
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { schema, toJsonSafe, type Db, type Tx } from "@zfloat/database";
import { decryptSecret, encryptSecret } from "@zfloat/auth";
import { createEtimsClient, EtimsError, type EtimsClient } from "./client.js";
import { buildSalesPayload, buildVerificationUrl, PAYMENT_TYPE_CODES } from "./payload.js";
import { computeDocument, isTaxType, TAX_TYPES, TAX_RATES, type ComputedLine, type LineInput, type TaxBucket, type TaxType } from "./tax.js";

export type EtimsDocType = "INVOICE" | "RECEIPT" | "CREDIT_NOTE" | "PAYMENT_RECEIPT";

const PREFIX: Record<EtimsDocType, string> = {
  INVOICE: "INV",
  RECEIPT: "RCT",
  CREDIT_NOTE: "CRN",
  PAYMENT_RECEIPT: "PRC",
};

export class EtimsServiceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "EtimsServiceError";
  }
}

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

export interface DeviceView {
  id: string;
  kraPin: string;
  branchId: string;
  deviceSerial: string;
  driver: string;
  status: string;
  sdcId: string | null;
  mrcNo: string | null;
  taxpayerName: string | null;
  lastInvoiceNo: number;
  autoReceipt: boolean;
  defaultTaxType: string;
  lastError: string | null;
  initialisedAt: Date | null;
}

function toDeviceView(d: typeof schema.etimsDevices.$inferSelect): DeviceView {
  return {
    id: d.id,
    kraPin: d.kraPin,
    branchId: d.branchId,
    deviceSerial: d.deviceSerial,
    driver: d.driver,
    status: d.status,
    sdcId: d.sdcId,
    mrcNo: d.mrcNo,
    taxpayerName: d.taxpayerName,
    lastInvoiceNo: d.lastInvoiceNo,
    autoReceipt: d.autoReceipt,
    defaultTaxType: d.defaultTaxType,
    lastError: d.lastError,
    initialisedAt: d.initialisedAt,
  };
}

export async function getDevice(db: Db | Tx, tenantId: string, branchId = "00"): Promise<DeviceView | null> {
  const [d] = await db
    .select()
    .from(schema.etimsDevices)
    .where(and(eq(schema.etimsDevices.tenantId, tenantId), eq(schema.etimsDevices.branchId, branchId)))
    .limit(1);
  return d ? toDeviceView(d) : null;
}

export interface ConfigureDeviceInput {
  tenantId: string;
  kraPin: string;
  branchId?: string;
  deviceSerial: string;
  autoReceipt?: boolean;
  defaultTaxType?: TaxType;
  client?: EtimsClient;
}

/** Register (or re-initialise) the tenant's OSCU/VSCU device and obtain the cmcKey. */
export async function configureDevice(db: Db, input: ConfigureDeviceInput): Promise<DeviceView> {
  const client = input.client ?? createEtimsClient();
  const branchId = (input.branchId ?? "00").padStart(2, "0").slice(0, 2);
  if (input.defaultTaxType && !isTaxType(input.defaultTaxType)) throw new EtimsServiceError("Unknown tax type", "INVALID_TAX_TYPE");
  const [row] = await db
    .insert(schema.etimsDevices)
    .values({
      tenantId: input.tenantId,
      kraPin: input.kraPin,
      branchId,
      deviceSerial: input.deviceSerial,
      driver: client.driver,
      status: "PENDING",
      autoReceipt: input.autoReceipt ?? true,
      defaultTaxType: input.defaultTaxType ?? "B",
    })
    .onConflictDoUpdate({
      target: [schema.etimsDevices.tenantId, schema.etimsDevices.branchId],
      set: {
        kraPin: input.kraPin,
        deviceSerial: input.deviceSerial,
        driver: client.driver,
        status: "PENDING",
        ...(input.autoReceipt !== undefined ? { autoReceipt: input.autoReceipt } : {}),
        ...(input.defaultTaxType ? { defaultTaxType: input.defaultTaxType } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new EtimsServiceError("Failed to save device", "SAVE_FAILED");

  try {
    const init = await client.initialise({ tin: input.kraPin, bhfId: branchId, deviceSerial: input.deviceSerial });
    const [updated] = await db
      .update(schema.etimsDevices)
      .set({
        status: "ACTIVE",
        cmcKeyEncrypted: encryptSecret(init.cmcKey),
        sdcId: init.sdcId || null,
        mrcNo: init.mrcNo || null,
        taxpayerName: init.taxpayerName ?? null,
        lastError: null,
        initialisedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.etimsDevices.id, row.id))
      .returning();
    // The seller PIN is also the tenant's KRA PIN.
    await db
      .update(schema.tenants)
      .set({ kraPin: input.kraPin })
      .where(and(eq(schema.tenants.id, input.tenantId), sql`${schema.tenants.kraPin} IS NULL`));
    return toDeviceView(updated!);
  } catch (err) {
    await db
      .update(schema.etimsDevices)
      .set({ status: "FAILED", lastError: err instanceof Error ? err.message : String(err), updatedAt: new Date() })
      .where(eq(schema.etimsDevices.id, row.id));
    throw err;
  }
}

export async function updateDeviceSettings(
  db: Db,
  input: { tenantId: string; branchId?: string; autoReceipt?: boolean; defaultTaxType?: TaxType },
): Promise<DeviceView | null> {
  if (input.defaultTaxType && !isTaxType(input.defaultTaxType)) throw new EtimsServiceError("Unknown tax type", "INVALID_TAX_TYPE");
  const [d] = await db
    .update(schema.etimsDevices)
    .set({
      ...(input.autoReceipt !== undefined ? { autoReceipt: input.autoReceipt } : {}),
      ...(input.defaultTaxType ? { defaultTaxType: input.defaultTaxType } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.etimsDevices.tenantId, input.tenantId), eq(schema.etimsDevices.branchId, input.branchId ?? "00")))
    .returning();
  return d ? toDeviceView(d) : null;
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export interface DocumentCustomer {
  customerId?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  kraPin?: string | null;
  idType?: string | null;
  idNumber?: string | null;
}

export interface CreateDocumentInput {
  tenantId: string;
  actorId?: string | null;
  docType: "INVOICE" | "RECEIPT";
  customer?: DocumentCustomer;
  lines: LineInput[];
  pricesIncludeTax: boolean;
  /** KRA pmtTyCd; defaults to 02 (credit) for invoices, 06 (mobile money) for receipts. */
  paymentMethod?: string;
  dueAt?: Date | null;
  notes?: string | null;
  collectionId?: string | null;
}

export function generatePublicToken(): string {
  return `doc_${randomBytes(12).toString("base64url")}`;
}

async function nextNumber(tx: Tx, tenantId: string, docType: EtimsDocType): Promise<string> {
  const prefix = PREFIX[docType];
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`etims:${tenantId}:${prefix}`}))`);
  const res = await tx.execute(
    sql`SELECT COALESCE(MAX(CAST(SUBSTRING(number FROM '[0-9]+$') AS integer)), 0) AS n
        FROM etims_documents WHERE tenant_id = ${tenantId} AND doc_type = ${docType}`,
  );
  const n = Number((res.rows[0] as { n?: number | string } | undefined)?.n ?? 0) + 1;
  return `${prefix}-${String(n).padStart(6, "0")}`;
}

async function emitOutbox(tx: Tx | Db, eventType: string, tenantId: string, aggregateId: string, payload: Record<string, unknown>) {
  await tx.insert(schema.outboxEvents).values({
    eventType,
    aggregateType: "etims_document",
    aggregateId,
    tenantId,
    payload: toJsonSafe(payload) as Record<string, unknown>,
  });
}

export type EtimsDocument = typeof schema.etimsDocuments.$inferSelect;

/** Create a DRAFT document (taxes computed, number allocated). */
export async function createDocument(db: Db, input: CreateDocumentInput): Promise<EtimsDocument> {
  const computed = computeDocument(input.lines, { pricesIncludeTax: input.pricesIncludeTax });
  return db.transaction(async (tx) => {
    const number = await nextNumber(tx, input.tenantId, input.docType);
    const [doc] = await tx
      .insert(schema.etimsDocuments)
      .values({
        tenantId: input.tenantId,
        docType: input.docType,
        number,
        status: "DRAFT",
        paymentStatus: input.docType === "RECEIPT" ? "PAID" : "UNPAID",
        customerId: input.customer?.customerId ?? null,
        customerName: input.customer?.name ?? null,
        customerPhone: input.customer?.phone ?? null,
        customerEmail: input.customer?.email ?? null,
        customerKraPin: input.customer?.kraPin ?? null,
        customerIdType: input.customer?.idType ?? null,
        customerIdNumber: input.customer?.idNumber ?? null,
        lines: toJsonSafe(computed.lines) as unknown as Record<string, unknown>,
        taxSummary: toJsonSafe(computed.taxSummary) as Record<string, unknown>,
        subtotalMinor: computed.subtotalMinor,
        taxMinor: computed.taxMinor,
        totalMinor: computed.totalMinor,
        paidMinor: input.docType === "RECEIPT" ? computed.totalMinor : 0n,
        paymentMethod: input.paymentMethod ?? (input.docType === "RECEIPT" ? PAYMENT_TYPE_CODES.MOBILE_MONEY : PAYMENT_TYPE_CODES.CREDIT),
        dueAt: input.dueAt ?? null,
        notes: input.notes ?? null,
        collectionId: input.collectionId ?? null,
        publicToken: generatePublicToken(),
        createdById: input.actorId ?? null,
      })
      .returning();
    if (!doc) throw new EtimsServiceError("Failed to create document", "CREATE_FAILED");
    return doc;
  });
}

async function loadDocForTenant(db: Db | Tx, tenantId: string, id: string): Promise<EtimsDocument> {
  const [doc] = await db
    .select()
    .from(schema.etimsDocuments)
    .where(and(eq(schema.etimsDocuments.id, id), eq(schema.etimsDocuments.tenantId, tenantId)))
    .limit(1);
  if (!doc) throw new EtimsServiceError("Document not found", "NOT_FOUND");
  return doc;
}

/**
 * Fiscalise (sign) a document with KRA. Idempotent: SIGNED documents are
 * returned unchanged; retries reuse the already-allocated invcNo.
 */
export async function fiscaliseDocument(
  db: Db,
  input: { tenantId: string; documentId: string; actorName?: string; client?: EtimsClient },
): Promise<EtimsDocument> {
  const client = input.client ?? createEtimsClient();

  const prepared = await db.transaction(async (tx) => {
    const [doc] = await tx
      .select()
      .from(schema.etimsDocuments)
      .where(and(eq(schema.etimsDocuments.id, input.documentId), eq(schema.etimsDocuments.tenantId, input.tenantId)))
      .for("update");
    if (!doc) throw new EtimsServiceError("Document not found", "NOT_FOUND");
    if (doc.status === "SIGNED") return { done: doc } as const;
    if (doc.docType === "PAYMENT_RECEIPT") throw new EtimsServiceError("Payment receipts are not fiscal documents", "NOT_FISCAL");
    if (doc.status === "CANCELLED") throw new EtimsServiceError("Cancelled documents cannot be fiscalised", "CANCELLED");

    const [device] = await tx
      .select()
      .from(schema.etimsDevices)
      .where(and(eq(schema.etimsDevices.tenantId, input.tenantId), eq(schema.etimsDevices.branchId, "00")))
      .for("update");
    if (!device || device.status !== "ACTIVE" || !device.cmcKeyEncrypted) {
      throw new EtimsError("eTIMS is not set up for this business — configure your KRA PIN and device first", "DEVICE_NOT_INITIALISED", false);
    }
    let invoiceNo = doc.invoiceNo;
    if (invoiceNo === null) {
      invoiceNo = device.lastInvoiceNo + 1;
      await tx.update(schema.etimsDevices).set({ lastInvoiceNo: invoiceNo, updatedAt: new Date() }).where(eq(schema.etimsDevices.id, device.id));
    }
    let originalInvoiceNo: number | null = null;
    if (doc.docType === "CREDIT_NOTE" && doc.originalDocumentId) {
      const [orig] = await tx
        .select({ invoiceNo: schema.etimsDocuments.invoiceNo })
        .from(schema.etimsDocuments)
        .where(eq(schema.etimsDocuments.id, doc.originalDocumentId))
        .limit(1);
      originalInvoiceNo = orig?.invoiceNo ?? null;
    }
    const [tenant] = await tx.select({ name: schema.tenants.name }).from(schema.tenants).where(eq(schema.tenants.id, input.tenantId)).limit(1);
    const payload = buildSalesPayload(device.kraPin, device.branchId, {
      invoiceNo,
      originalInvoiceNo,
      traderInvoiceNo: doc.number,
      kind: doc.docType === "CREDIT_NOTE" ? "CREDIT_NOTE" : "SALE",
      customerKraPin: doc.customerKraPin,
      customerName: doc.customerName,
      customerPhone: doc.customerPhone,
      paymentTypeCode: doc.paymentMethod ?? PAYMENT_TYPE_CODES.MOBILE_MONEY,
      issuedAt: new Date(),
      lines: doc.lines as unknown as ComputedLine[],
      taxSummary: doc.taxSummary as unknown as Record<TaxType, TaxBucket>,
      totalTaxableMinor: doc.totalMinor,
      totalTaxMinor: doc.taxMinor,
      totalMinor: doc.totalMinor,
      remark: doc.notes,
      registeredBy: { id: doc.createdById ?? "zfloat", name: input.actorName ?? "Z-float" },
      tradeName: tenant?.name ?? null,
    });
    await tx
      .update(schema.etimsDocuments)
      .set({
        status: "QUEUED",
        invoiceNo,
        deviceId: device.id,
        requestPayload: toJsonSafe(payload) as Record<string, unknown>,
        submissionAttempts: doc.submissionAttempts + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.etimsDocuments.id, doc.id));
    return {
      done: null,
      payload,
      device: { tin: device.kraPin, bhfId: device.branchId, deviceSerial: device.deviceSerial, cmcKey: decryptSecret(device.cmcKeyEncrypted) },
    } as const;
  });

  if (prepared.done) return prepared.done;

  try {
    const sig = await client.saveSale(prepared.device, prepared.payload);
    const signed = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(schema.etimsDocuments)
        .set({
          status: "SIGNED",
          receiptNo: sig.rcptNo,
          totalReceiptNo: sig.totRcptNo,
          internalData: sig.intrlData,
          receiptSignature: sig.rcptSign,
          sdcId: sig.sdcId || null,
          mrcNo: sig.mrcNo || null,
          cuInvoiceNo: `${sig.sdcId}/${sig.rcptNo}`,
          signedAt: new Date(),
          verificationUrl: buildVerificationUrl(client.environment, prepared.device.tin, prepared.device.bhfId, sig.rcptSign),
          sandbox: client.driver === "sandbox",
          lastError: null,
          responsePayload: toJsonSafe(sig.raw) as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(schema.etimsDocuments.id, input.documentId))
        .returning();
      await emitOutbox(tx, "invoice.fiscalised", input.tenantId, input.documentId, {
        documentId: input.documentId,
        number: row!.number,
        docType: row!.docType,
        cuInvoiceNo: row!.cuInvoiceNo,
        totalMinor: row!.totalMinor.toString(),
        sandbox: row!.sandbox,
      });
      return row!;
    });
    return signed;
  } catch (err) {
    const retryable = err instanceof EtimsError ? err.retryable : true;
    await db
      .update(schema.etimsDocuments)
      .set({ status: retryable ? "QUEUED" : "FAILED", lastError: err instanceof Error ? err.message : String(err), updatedAt: new Date() })
      .where(eq(schema.etimsDocuments.id, input.documentId));
    throw err;
  }
}

/** Queue a document for (re)fiscalisation by the outbox relay (retries transient KRA outages). */
export async function requestFiscalisation(db: Db | Tx, tenantId: string, documentId: string): Promise<void> {
  await emitOutbox(db, "etims.fiscalise_requested", tenantId, documentId, { documentId });
}

/** Full credit note against a SIGNED invoice/receipt. */
export async function createCreditNote(
  db: Db,
  input: { tenantId: string; actorId?: string | null; originalDocumentId: string; reason: string },
): Promise<EtimsDocument> {
  const original = await loadDocForTenant(db, input.tenantId, input.originalDocumentId);
  if (original.status !== "SIGNED" || (original.docType !== "INVOICE" && original.docType !== "RECEIPT")) {
    throw new EtimsServiceError("Only signed invoices or receipts can be credited", "NOT_CREDITABLE");
  }
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.etimsDocuments.id, status: schema.etimsDocuments.status })
      .from(schema.etimsDocuments)
      .where(and(eq(schema.etimsDocuments.originalDocumentId, original.id), eq(schema.etimsDocuments.docType, "CREDIT_NOTE")))
      .limit(1);
    if (existing && existing.status !== "FAILED" && existing.status !== "CANCELLED") {
      throw new EtimsServiceError("This document already has a credit note", "ALREADY_CREDITED");
    }
    const number = await nextNumber(tx, input.tenantId, "CREDIT_NOTE");
    const [doc] = await tx
      .insert(schema.etimsDocuments)
      .values({
        tenantId: input.tenantId,
        docType: "CREDIT_NOTE",
        number,
        originalDocumentId: original.id,
        status: "DRAFT",
        paymentStatus: "N/A",
        customerId: original.customerId,
        customerName: original.customerName,
        customerPhone: original.customerPhone,
        customerEmail: original.customerEmail,
        customerKraPin: original.customerKraPin,
        customerIdType: original.customerIdType,
        customerIdNumber: original.customerIdNumber,
        lines: original.lines as Record<string, unknown>,
        taxSummary: original.taxSummary as Record<string, unknown>,
        subtotalMinor: original.subtotalMinor,
        taxMinor: original.taxMinor,
        totalMinor: original.totalMinor,
        paymentMethod: original.paymentMethod,
        notes: `Credit note for ${original.number}: ${input.reason}`.slice(0, 500),
        publicToken: generatePublicToken(),
        createdById: input.actorId ?? null,
      })
      .returning();
    return doc!;
  });
}

/** Record money received against an invoice (allowed on SIGNED docs — trigger permits payment fields). */
export async function applyInvoicePayment(
  tx: Tx | Db,
  input: { tenantId: string; invoiceId: string; amountMinor: bigint; collectionId?: string },
): Promise<void> {
  const [inv] = await tx
    .select()
    .from(schema.etimsDocuments)
    .where(and(eq(schema.etimsDocuments.id, input.invoiceId), eq(schema.etimsDocuments.tenantId, input.tenantId)))
    .for("update");
  if (!inv || inv.docType !== "INVOICE") return;
  const paid = inv.paidMinor + input.amountMinor;
  await tx
    .update(schema.etimsDocuments)
    .set({ paidMinor: paid, paymentStatus: paid >= inv.totalMinor ? "PAID" : "PARTIAL", updatedAt: new Date() })
    .where(eq(schema.etimsDocuments.id, inv.id));
}

const CHANNEL_PAYMENT_TYPE: Record<string, string> = {
  MPESA_STK: PAYMENT_TYPE_CODES.MOBILE_MONEY,
  MPESA_C2B: PAYMENT_TYPE_CODES.MOBILE_MONEY,
  PAYMENT_LINK: PAYMENT_TYPE_CODES.MOBILE_MONEY,
  BANK_TRANSFER: PAYMENT_TYPE_CODES.OTHER,
};

/**
 * Issue the receipt for a settled collection.
 *  - Collection pays a tax invoice → non-fiscal PAYMENT_RECEIPT referencing
 *    the invoice's CU number (the sale was already fiscalised when the
 *    invoice was issued; signing it again would double-declare VAT).
 *  - Walk-in / unlinked collection → fiscal RECEIPT signed via eTIMS.
 * Returns null when the tenant has no active device or auto-receipts are off.
 */
export async function issueReceiptForCollection(
  db: Db,
  input: { collectionId: string; client?: EtimsClient },
): Promise<EtimsDocument | null> {
  const created = await db.transaction(async (tx) => {
    const [col] = await tx.select().from(schema.collections).where(eq(schema.collections.id, input.collectionId)).for("update");
    if (!col || col.status !== "SUCCESS") return null;
    if (col.receiptId) {
      const [existing] = await tx.select().from(schema.etimsDocuments).where(eq(schema.etimsDocuments.id, col.receiptId)).limit(1);
      return existing ? { doc: existing, fiscal: false } : null;
    }
    const [device] = await tx
      .select()
      .from(schema.etimsDevices)
      .where(and(eq(schema.etimsDevices.tenantId, col.tenantId), eq(schema.etimsDevices.branchId, "00")))
      .limit(1);
    if (!device || device.status !== "ACTIVE" || !device.autoReceipt) return null;

    const customer = {
      customerId: col.customerId,
      customerName: col.payerName,
      customerPhone: col.payerPhone,
      customerKraPin: col.payerKraPin,
      customerIdType: col.payerIdType,
      customerIdNumber: col.payerIdNumber,
    };

    if (col.invoiceId) {
      const [inv] = await tx.select().from(schema.etimsDocuments).where(eq(schema.etimsDocuments.id, col.invoiceId)).limit(1);
      const number = await nextNumber(tx, col.tenantId, "PAYMENT_RECEIPT");
      const zero = Object.fromEntries(TAX_TYPES.map((t) => [t, { rate: TAX_RATES[t].toString(), taxableMinor: "0", taxMinor: "0" }]));
      const [doc] = await tx
        .insert(schema.etimsDocuments)
        .values({
          tenantId: col.tenantId,
          docType: "PAYMENT_RECEIPT",
          number,
          originalDocumentId: col.invoiceId,
          status: "ISSUED",
          paymentStatus: "N/A",
          ...customer,
          customerName: col.payerName ?? inv?.customerName ?? null,
          customerKraPin: col.payerKraPin ?? inv?.customerKraPin ?? null,
          lines: toJsonSafe([
            {
              seq: 1,
              description: `Payment received for ${inv?.number ?? "invoice"}${inv?.cuInvoiceNo ? ` (CU ${inv.cuInvoiceNo})` : ""}`,
              qtyMilli: "1000",
              unitPriceMinor: col.amountMinor.toString(),
              totalMinor: col.amountMinor.toString(),
            },
          ]) as unknown as Record<string, unknown>,
          taxSummary: zero,
          subtotalMinor: col.amountMinor,
          taxMinor: 0n,
          totalMinor: col.amountMinor,
          paidMinor: col.amountMinor,
          paymentMethod: CHANNEL_PAYMENT_TYPE[col.channel] ?? PAYMENT_TYPE_CODES.OTHER,
          collectionId: col.id,
          notes: col.receiptNumber ? `Provider receipt ${col.receiptNumber}` : null,
          publicToken: generatePublicToken(),
          sandbox: device.driver === "sandbox",
          signedAt: new Date(),
        })
        .returning();
      await tx.update(schema.collections).set({ receiptId: doc!.id, updatedAt: new Date() }).where(eq(schema.collections.id, col.id));
      return { doc: doc!, fiscal: false };
    }

    const taxType = (isTaxType(device.defaultTaxType) ? device.defaultTaxType : "B") as TaxType;
    const computed = computeDocument(
      [
        {
          description: (col.description || `Payment ${col.accountReference ?? col.collectionNumber}`).slice(0, 200),
          qtyMilli: 1000n,
          unitPriceMinor: col.amountMinor,
          taxType,
        },
      ],
      { pricesIncludeTax: true },
    );
    const number = await nextNumber(tx, col.tenantId, "RECEIPT");
    const [doc] = await tx
      .insert(schema.etimsDocuments)
      .values({
        tenantId: col.tenantId,
        docType: "RECEIPT",
        number,
        status: "DRAFT",
        paymentStatus: "PAID",
        ...customer,
        lines: toJsonSafe(computed.lines) as unknown as Record<string, unknown>,
        taxSummary: toJsonSafe(computed.taxSummary) as Record<string, unknown>,
        subtotalMinor: computed.subtotalMinor,
        taxMinor: computed.taxMinor,
        totalMinor: computed.totalMinor,
        paidMinor: computed.totalMinor,
        paymentMethod: CHANNEL_PAYMENT_TYPE[col.channel] ?? PAYMENT_TYPE_CODES.OTHER,
        collectionId: col.id,
        notes: col.receiptNumber ? `Provider receipt ${col.receiptNumber}` : null,
        publicToken: generatePublicToken(),
      })
      .returning();
    await tx.update(schema.collections).set({ receiptId: doc!.id, updatedAt: new Date() }).where(eq(schema.collections.id, col.id));
    return { doc: doc!, fiscal: true };
  });

  if (!created) return null;
  if (!created.fiscal || created.doc.status === "SIGNED") return created.doc;
  try {
    return await fiscaliseDocument(db, { tenantId: created.doc.tenantId, documentId: created.doc.id, client: input.client });
  } catch (err) {
    // Money has already moved — never fail the collection because KRA is
    // down. Transient errors are retried via the outbox.
    if (!(err instanceof EtimsError) || err.retryable) await requestFiscalisation(db, created.doc.tenantId, created.doc.id);
    return loadDocForTenant(db, created.doc.tenantId, created.doc.id);
  }
}

export async function getDocument(db: Db, tenantId: string, id: string): Promise<EtimsDocument | null> {
  try {
    return await loadDocForTenant(db, tenantId, id);
  } catch {
    return null;
  }
}

export async function getDocumentByToken(db: Db, token: string): Promise<EtimsDocument | null> {
  const [doc] = await db.select().from(schema.etimsDocuments).where(eq(schema.etimsDocuments.publicToken, token)).limit(1);
  return doc ?? null;
}

export async function listDocuments(
  db: Db,
  tenantId: string,
  opts: { docType?: string; status?: string; q?: string; limit?: number } = {},
): Promise<EtimsDocument[]> {
  const conds = [eq(schema.etimsDocuments.tenantId, tenantId)];
  if (opts.docType) conds.push(eq(schema.etimsDocuments.docType, opts.docType));
  if (opts.status) conds.push(eq(schema.etimsDocuments.status, opts.status));
  if (opts.q) {
    const like = `%${opts.q.replace(/[%_]/g, "")}%`;
    conds.push(
      or(
        ilike(schema.etimsDocuments.number, like),
        ilike(schema.etimsDocuments.customerName, like),
        ilike(schema.etimsDocuments.customerKraPin, like),
        ilike(schema.etimsDocuments.customerPhone, like),
        ilike(schema.etimsDocuments.cuInvoiceNo, like),
      )!,
    );
  }
  return db
    .select()
    .from(schema.etimsDocuments)
    .where(and(...conds))
    .orderBy(desc(schema.etimsDocuments.createdAt))
    .limit(Math.min(opts.limit ?? 100, 500));
}

/** Sweep QUEUED documents older than `olderThanMs` and fiscalise them (cron safety net). */
export async function retryQueuedDocuments(db: Db, opts: { limit?: number; olderThanMs?: number; maxAttempts?: number; client?: EtimsClient } = {}) {
  const cutoff = new Date(Date.now() - (opts.olderThanMs ?? 60_000));
  const rows = await db
    .select({ id: schema.etimsDocuments.id, tenantId: schema.etimsDocuments.tenantId })
    .from(schema.etimsDocuments)
    .where(
      and(
        eq(schema.etimsDocuments.status, "QUEUED"),
        sql`${schema.etimsDocuments.updatedAt} < ${cutoff}`,
        sql`${schema.etimsDocuments.submissionAttempts} < ${opts.maxAttempts ?? 10}`,
      ),
    )
    .limit(opts.limit ?? 25);
  let signed = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await fiscaliseDocument(db, { tenantId: r.tenantId, documentId: r.id, client: opts.client });
      signed++;
    } catch {
      failed++;
    }
  }
  return { scanned: rows.length, signed, failed };
}
