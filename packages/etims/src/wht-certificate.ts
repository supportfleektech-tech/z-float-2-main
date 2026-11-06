/**
 * Withholding Tax Certificate Service
 *
 * Generates WHT certificates (PDF) and manages KRA eSlip remittance.
 */

import { randomBytes } from "node:crypto";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { schema, toJsonSafe, type Db, type Tx } from "@zfloat/database";
import { calculateWht, type WhtCalculationResult } from "./wht.js";

/** Payment creation input for WHT remittance */
export interface CreatePaymentInput {
  tenantId: string;
  actorId: string;
  amount: string;
  currency?: "KES";
  channel: "mpesa" | "till" | "paybill" | "bank";
  product?: string;
  sourceWalletId: string;
  branchId?: string;
  departmentId?: string;
  category?: string;
  remark?: string;
  recipient: {
    name: string;
    phone?: string;
    email?: string;
    bankAccountName?: string;
    bankAccountNumber?: string;
    bankCode?: string;
    tillNumber?: string;
    paybillNumber?: string;
    paybillAccount?: string;
    type?: string;
    kraPin?: string;
    idType?: string;
    idNumber?: string;
    isResident?: boolean;
  };
  idempotencyKey: string;
  providerCode?: string;
  whtCategory?: string;
  whtIsResident?: boolean;
}

export interface CreatedPayment {
  paymentId: string;
  paymentNumber: string;
  status: string;
  amountMinor: string;
  feeMinor: string;
  totalMinor: string;
  whtAmountMinor: string;
  whtCategory: string | null;
  whtRateBps: number | null;
  approvalRequired: boolean;
}

/** Payment creation function signature for WHT remittance */
export type CreatePaymentFn = (db: any, input: CreatePaymentInput) => Promise<{ replayed: boolean; payment: CreatedPayment }>;

export interface WhtCertificateData {
  certificateNumber: string;
  tenantName: string;
  tenantKraPin: string;
  tenantAddress: string;
  beneficiaryName: string;
  beneficiaryKraPin: string | null;
  beneficiaryIdType: string | null;
  beneficiaryIdNumber: string | null;
  category: string;
  grossAmountMinor: bigint;
  whtRateBps: number;
  whtAmountMinor: bigint;
  netAmountMinor: bigint;
  certificateDate: Date;
  paymentNumber: string;
  paymentDate: Date;
}

export interface WhtCertificateResult {
  certificateId: string;
  certificateNumber: string;
  pdfRef: string | null;
}

/** Generate a unique certificate number: WHT-YYYY-NNNNNN */
export function generateCertificateNumber(): string {
  const year = new Date().getFullYear();
  const rand = randomBytes(3).toString("hex").toUpperCase();
  return `WHT-${year}-${rand}`;
}

/** Format minor units as KES string with commas */
export function formatKes(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = (abs / 100n).toString();
  const cents = (abs % 100n).toString().padStart(2, "0");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}KES ${withCommas}.${cents}`;
}

/** Format date as DD/MM/YYYY */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Format rate in basis points as percentage string (e.g., 500 -> "5%") */
export function formatRateBps(rateBps: number): string {
  const percent = rateBps / 100;
  return percent % 1 === 0 ? `${percent}%` : `${percent.toFixed(2)}%`;
}

/**
 * Create a WHT certificate when a payment with WHT succeeds.
 * Returns the created certificate.
 */
export async function createWhtCertificate(
  db: Db,
  input: {
    tenantId: string;
    paymentId: string;
    actorId?: string | null;
  },
): Promise<WhtCertificateResult> {
  return db.transaction(async (tx) => {
    // Load payment with beneficiary details
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.id, input.paymentId), eq(schema.payments.tenantId, input.tenantId)))
      .for("update")
      .limit(1);

    if (!payment) throw new Error("Payment not found");
    if (!payment.whtCategory || !payment.whtRateBps || payment.whtAmountMinor === 0n) {
      throw new Error("Payment has no WHT to certify");
    }

    // Check if certificate already exists
    const [existing] = await tx
      .select()
      .from(schema.withholdingTaxCertificates)
      .where(eq(schema.withholdingTaxCertificates.paymentId, payment.id))
      .limit(1);

    if (existing) {
      return { certificateId: existing.id, certificateNumber: existing.certificateNumber, pdfRef: existing.pdfRef };
    }

    // Load tenant info
    const [tenant] = await tx
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, input.tenantId))
      .limit(1);

    if (!tenant) throw new Error("Tenant not found");

    const beneficiary = (payment.beneficiarySnapshot ?? {}) as Record<string, unknown>;
    const certificateNumber = generateCertificateNumber();

    const [certificate] = await tx
      .insert(schema.withholdingTaxCertificates)
      .values({
        tenantId: input.tenantId,
        certificateNumber,
        paymentId: payment.id,
        beneficiaryId: payment.beneficiaryId ?? null,
        beneficiaryName: String(beneficiary.name ?? ""),
        beneficiaryKraPin: (beneficiary.kraPin as string) ?? null,
        beneficiaryIdType: (beneficiary.idType as string) ?? null,
        beneficiaryIdNumber: (beneficiary.idNumber as string) ?? null,
        category: payment.whtCategory,
        grossAmountMinor: payment.amountMinor,
        whtRateBps: payment.whtRateBps,
        whtAmountMinor: payment.whtAmountMinor,
        netAmountMinor: payment.amountMinor - payment.whtAmountMinor,
        certificateDate: new Date(),
        status: "GENERATED",
        createdById: input.actorId ?? null,
      })
      .returning();

    if (!certificate) throw new Error("Failed to create WHT certificate");

    // Update payment with certificate reference
    await tx
      .update(schema.payments)
      .set({ whtCertificateId: certificate.id, updatedAt: new Date() })
      .where(eq(schema.payments.id, payment.id));

    // TODO: Generate PDF and upload to storage
    // const pdfRef = await generateAndStoreWhtCertificatePdf(certificate, tenant, payment);
    // await tx.update(schema.withholdingTaxCertificates).set({ pdfRef, status: "ISSUED" }).where(eq(schema.withholdingTaxCertificates.id, certificate.id));

    return { certificateId: certificate.id, certificateNumber: certificate.certificateNumber, pdfRef: null };
  });
}

/**
 * Generate WHT certificate PDF using a simple text-based approach.
 * In production, this would use a proper PDF library like pdfkit or puppeteer.
 */
export async function generateWhtCertificatePdf(certData: WhtCertificateData): Promise<Buffer> {
  // This is a placeholder implementation.
  // In production, use pdfkit, puppeteer, or similar to generate a proper PDF.
  const lines = [
    "WITHHOLDING TAX CERTIFICATE",
    "=".repeat(50),
    "",
    `Certificate No: ${certData.certificateNumber}`,
    `Date: ${formatDate(certData.certificateDate)}`,
    "",
    "WITHHOLDING AGENT (PAYER):",
    `Name: ${certData.tenantName}`,
    `KRA PIN: ${certData.tenantKraPin}`,
    `Address: ${certData.tenantAddress}`,
    "",
    "BENEFICIARY (PAYEE):",
    `Name: ${certData.beneficiaryName}`,
    certData.beneficiaryKraPin ? `KRA PIN: ${certData.beneficiaryKraPin}` : "KRA PIN: Not provided",
    certData.beneficiaryIdType ? `ID Type: ${certData.beneficiaryIdType}` : "",
    certData.beneficiaryIdNumber ? `ID Number: ${certData.beneficiaryIdNumber}` : "",
    "",
    "PAYMENT DETAILS:",
    `Payment Reference: ${certData.paymentNumber}`,
    `Payment Date: ${formatDate(certData.paymentDate)}`,
    `Category: ${certData.category}`,
    `Gross Amount: ${formatKes(certData.grossAmountMinor)}`,
    `WHT Rate: ${formatRateBps(certData.whtRateBps)}`,
    `WHT Amount: ${formatKes(certData.whtAmountMinor)}`,
    `Net Amount Paid: ${formatKes(certData.netAmountMinor)}`,
    "",
    "=".repeat(50),
    "This certificate confirms that the above Withholding Tax",
    "has been deducted and will be remitted to KRA.",
    "",
    "Generated by Z-float",
    `https://zfloat.app`,
  ];

  return Buffer.from(lines.join("\n"), "utf-8");
}

/**
 * Build certificate data from database records
 */
export async function buildCertificateData(
  db: Db,
  certificateId: string,
): Promise<WhtCertificateData | null> {
  const [cert] = await db
    .select({
      certificate: schema.withholdingTaxCertificates,
      payment: schema.payments,
      tenant: schema.tenants,
    })
    .from(schema.withholdingTaxCertificates)
    .innerJoin(schema.payments, eq(schema.withholdingTaxCertificates.paymentId, schema.payments.id))
    .innerJoin(schema.tenants, eq(schema.withholdingTaxCertificates.tenantId, schema.tenants.id))
    .where(eq(schema.withholdingTaxCertificates.id, certificateId))
    .limit(1);

  if (!cert) return null;

  const { certificate, payment, tenant } = cert;

  const settings = (tenant.settings ?? {}) as Record<string, unknown>;
  return {
    certificateNumber: certificate.certificateNumber,
    tenantName: tenant.name,
    tenantKraPin: tenant.kraPin ?? "Not registered",
    tenantAddress: (settings.address as string) ?? "Not provided",
    beneficiaryName: certificate.beneficiaryName,
    beneficiaryKraPin: certificate.beneficiaryKraPin,
    beneficiaryIdType: certificate.beneficiaryIdType,
    beneficiaryIdNumber: certificate.beneficiaryIdNumber,
    category: certificate.category,
    grossAmountMinor: certificate.grossAmountMinor,
    whtRateBps: certificate.whtRateBps,
    whtAmountMinor: certificate.whtAmountMinor,
    netAmountMinor: certificate.netAmountMinor,
    certificateDate: certificate.certificateDate,
    paymentNumber: payment.paymentNumber,
    paymentDate: payment.createdAt,
  };
}

/**
 * Get WHT certificates for a tenant (with pagination)
 */
export async function listWhtCertificates(
  db: Db,
  tenantId: string,
  opts: { limit?: number; offset?: number; status?: string; fromDate?: Date; toDate?: Date } = {},
): Promise<Array<typeof schema.withholdingTaxCertificates.$inferSelect>> {
  const conditions = [eq(schema.withholdingTaxCertificates.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(schema.withholdingTaxCertificates.status, opts.status));
  if (opts.fromDate) conditions.push(gte(schema.withholdingTaxCertificates.certificateDate, opts.fromDate));
  if (opts.toDate) conditions.push(lte(schema.withholdingTaxCertificates.certificateDate, opts.toDate));

  return db
    .select()
    .from(schema.withholdingTaxCertificates)
    .where(and(...conditions))
    .orderBy(sql`${schema.withholdingTaxCertificates.certificateDate} DESC`)
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

/**
 * Get a single WHT certificate by ID
 */
export async function getWhtCertificate(
  db: Db,
  tenantId: string,
  certificateId: string,
): Promise<typeof schema.withholdingTaxCertificates.$inferSelect | null> {
  const [cert] = await db
    .select()
    .from(schema.withholdingTaxCertificates)
    .where(and(eq(schema.withholdingTaxCertificates.id, certificateId), eq(schema.withholdingTaxCertificates.tenantId, tenantId)))
    .limit(1);

  return cert ?? null;
}

/**
 * Mark certificate as issued (after PDF generation)
 */
export async function issueWhtCertificate(
  db: Db,
  certificateId: string,
  pdfRef: string,
): Promise<void> {
  await db
    .update(schema.withholdingTaxCertificates)
    .set({ status: "ISSUED", pdfRef, issuedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.withholdingTaxCertificates.id, certificateId));
}

/**
 * Void a WHT certificate
 */
export async function voidWhtCertificate(
  db: Db,
  certificateId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await db
    .update(schema.withholdingTaxCertificates)
    .set({ status: "VOIDED", voidedAt: new Date(), voidReason: reason, updatedAt: new Date() })
    .where(eq(schema.withholdingTaxCertificates.id, certificateId));
}

/* ------------------------------------------------------------------ */
/* WHT Remittance (KRA eSlip)                                         */
/* ------------------------------------------------------------------ */

export interface WhtRemittanceInput {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  actorId: string;
}

export interface WhtRemittanceResult {
  remittanceId: string;
  remittanceNumber: string;
  totalWhtMinor: bigint;
  certificateCount: number;
}

/** Generate remittance number: WHT-REM-YYYY-MM-NNNNNN */
export function generateRemittanceNumber(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const rand = randomBytes(3).toString("hex").toUpperCase();
  return `WHT-REM-${year}-${month}-${rand}`;
}

/**
 * Create a WHT remittance for a period (aggregates all certificates in the period).
 * This is the "one-click KRA tax payment" preparation step.
 */
export async function createWhtRemittance(
  db: Db,
  input: WhtRemittanceInput,
): Promise<WhtRemittanceResult> {
  return db.transaction(async (tx) => {
    // Find all issued certificates in the period that aren't yet remitted
    const certificates = await tx
      .select()
      .from(schema.withholdingTaxCertificates)
      .where(
        and(
          eq(schema.withholdingTaxCertificates.tenantId, input.tenantId),
          eq(schema.withholdingTaxCertificates.status, "ISSUED"),
          gte(schema.withholdingTaxCertificates.certificateDate, input.periodStart),
          lte(schema.withholdingTaxCertificates.certificateDate, input.periodEnd),
          // Not yet included in a remittance
          sql`NOT EXISTS (
            SELECT 1 FROM ${schema.whtRemittanceItems}
            WHERE ${schema.whtRemittanceItems.certificateId} = ${schema.withholdingTaxCertificates.id}
          )`,
        ),
      );

    if (certificates.length === 0) {
      throw new Error("No unremitted WHT certificates found for this period");
    }

    const totalWhtMinor = certificates.reduce((sum, c) => sum + c.whtAmountMinor, 0n);
    const remittanceNumber = generateRemittanceNumber();

    const [remittance] = await tx
      .insert(schema.whtRemittances)
      .values({
        tenantId: input.tenantId,
        remittanceNumber,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        totalWhtMinor,
        status: "DRAFT",
        createdById: input.actorId,
      })
      .returning();

    if (!remittance) throw new Error("Failed to create WHT remittance");

    // Link certificates to remittance
    await tx.insert(schema.whtRemittanceItems).values(
      certificates.map((c) => ({
        remittanceId: remittance.id,
        certificateId: c.id,
        whtAmountMinor: c.whtAmountMinor,
      })),
    );

    return {
      remittanceId: remittance.id,
      remittanceNumber: remittance.remittanceNumber,
      totalWhtMinor,
      certificateCount: certificates.length,
    };
  });
}

/**
 * Submit WHT remittance to KRA via eSlip (biller aggregator).
 * Creates a payment to KRA eSlip paybill (572572).
 */
export async function submitWhtRemittanceToKra(
  db: Db,
  input: { remittanceId: string; actorId: string; sourceWalletId: string },
  createPaymentFn: CreatePaymentFn,
): Promise<{ paymentId: string; paymentNumber: string }> {
  const [remittance] = await db
    .select()
    .from(schema.whtRemittances)
    .where(eq(schema.whtRemittances.id, input.remittanceId))
    .for("update")
    .limit(1);

  if (!remittance) throw new Error("Remittance not found");
  if (remittance.status !== "DRAFT") throw new Error(`Cannot submit remittance in status ${remittance.status}`);

  // Create a payment to KRA eSlip paybill
  // This uses the existing payment creation flow with the KRA eSlip biller
  const paymentResult = await createPaymentFn(db, {
    tenantId: remittance.tenantId,
    actorId: input.actorId,
    amount: (Number(remittance.totalWhtMinor) / 100).toFixed(2), // Convert minor to decimal string
    channel: "paybill",
    product: "wht_remittance",
    sourceWalletId: input.sourceWalletId,
    category: "WHT_REMITTANCE",
    remark: `WHT remittance ${remittance.remittanceNumber} for period ${remittance.periodStart.toISOString().slice(0, 10)} to ${remittance.periodEnd.toISOString().slice(0, 10)}`,
    recipient: {
      name: "Kenya Revenue Authority",
      paybillNumber: "572572",
      paybillAccount: remittance.remittanceNumber, // Use remittance number as account reference
      type: "government",
    },
    idempotencyKey: `wht-remit-${remittance.id}`,
  });

  // Update remittance with payment reference
  await db
    .update(schema.whtRemittances)
    .set({ paymentId: paymentResult.payment.paymentId, status: "SUBMITTED", updatedAt: new Date() })
    .where(eq(schema.whtRemittances.id, input.remittanceId));

  // Payment created as DRAFT - caller should submit if needed
  return { paymentId: paymentResult.payment.paymentId, paymentNumber: paymentResult.payment.paymentNumber };
}

/**
 * Mark remittance as paid (called from webhook/callback when KRA eSlip payment succeeds)
 */
export async function markWhtRemittancePaid(
  db: Db,
  input: { remittanceId: string; kraEsleepReference: string; kraEsleepReceiptNumber: string; paymentId: string },
): Promise<void> {
  await db
    .update(schema.whtRemittances)
    .set({
      status: "PAID",
      kraEsleepReference: input.kraEsleepReference,
      kraEsleepReceiptNumber: input.kraEsleepReceiptNumber,
      paidAt: new Date(),
      paymentId: input.paymentId,
      updatedAt: new Date(),
    })
    .where(eq(schema.whtRemittances.id, input.remittanceId));
}

/**
 * Get remittances for a tenant
 */
export async function listWhtRemittances(
  db: Db,
  tenantId: string,
  opts: { limit?: number; offset?: number; status?: string } = {},
): Promise<Array<typeof schema.whtRemittances.$inferSelect>> {
  const conditions = [eq(schema.whtRemittances.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(schema.whtRemittances.status, opts.status));

  return db
    .select()
    .from(schema.whtRemittances)
    .where(and(...conditions))
    .orderBy(sql`${schema.whtRemittances.createdAt} DESC`)
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}