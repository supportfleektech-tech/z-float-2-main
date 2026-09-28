/**
 * Collections (receiving money) + KRA eTIMS — integration tests on real PostgreSQL.
 *  - STK request-to-pay → Daraja callback → wallet credit (balanced journal)
 *  - collection.received → eTIMS-signed receipt (sandbox signer)
 *  - C2B paybill confirmation → invoice marked PAID + non-fiscal payment receipt
 *  - idempotency (duplicate callbacks / TransIDs), unmatched → recon orphan
 *  - signed documents are immutable; corrections via credit notes
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@zfloat/database";
import { ensureSystemChart, getWalletBalance } from "@zfloat/ledger";
import { MockProvider, MpesaProviderAdapter, parseC2BConfirmation } from "@zfloat/providers";
import { SandboxEtimsClient, configureDevice, createDocument, fiscaliseDocument, createCreditNote, parseQtyMilli } from "@zfloat/etims";
import {
  requestStkCollection,
  settleCollection,
  recordC2BPayment,
  validateC2BPayment,
  recordBankCollection,
  collectionStats,
} from "../src/collections.js";
import { ingestWebhook, processWebhookEvent } from "../src/webhooks.js";
import { handleOutboxEvent } from "../src/outbox-relay.js";
import { collectViaPaymentLink, createPaymentLink } from "../src/payment-links.js";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
const etims = new SandboxEtimsClient("integration-secret");

async function clean() {
  await pool.query(
    `TRUNCATE etims_documents, etims_devices, collections, customers, payment_links, outbox_events, webhook_events,
             recon_items, notifications, journal_entries, journals, ledger_accounts, chart_of_accounts,
             wallet_ledger_entries, wallets, tenants, users CASCADE`,
  );
}

async function makeTenant(name: string, ref?: string) {
  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}`,
      status: "ACTIVE",
      collectionAccountRef: ref ?? null,
    })
    .returning({ id: schema.tenants.id });
  const tenantId = tenant!.id;
  await ensureSystemChart(db, tenantId);
  const [wallet] = await db.insert(schema.wallets).values({ tenantId, name: "Main", currency: "KES" }).returning();
  const [user] = await db
    .insert(schema.users)
    .values({ tenantId, email: `${crypto.randomUUID().slice(0, 8)}@t.co.ke`, fullName: "Owner", status: "ACTIVE" })
    .returning({ id: schema.users.id });
  return { tenantId, walletId: wallet!.id, actorId: user!.id };
}

async function ledgerNet(): Promise<string> {
  const r = await pool.query(`SELECT COALESCE(SUM(debit_minor),0) - COALESCE(SUM(credit_minor),0) AS net FROM journal_entries`);
  return String(r.rows[0]?.net);
}

async function drainOutbox(tenantId: string) {
  const rows = await db.select().from(schema.outboxEvents).where(eq(schema.outboxEvents.tenantId, tenantId));
  for (const e of rows) {
    if (e.publishedAt) continue;
    await handleOutboxEvent(db, { id: e.id, eventType: e.eventType, tenantId: e.tenantId, payload: e.payload as Record<string, unknown> });
    await db.update(schema.outboxEvents).set({ publishedAt: new Date() }).where(eq(schema.outboxEvents.id, e.id));
  }
}

function stkCallback(checkoutRequestId: string, ok: boolean, amountKes = 0, receipt = "SFT3XYZ123") {
  return JSON.stringify({
    Body: {
      stkCallback: {
        MerchantRequestID: "MR-1",
        CheckoutRequestID: checkoutRequestId,
        ResultCode: ok ? 0 : 1032,
        ResultDesc: ok ? "The service request is processed successfully." : "Request cancelled by user",
        ...(ok
          ? {
              CallbackMetadata: {
                Item: [
                  { Name: "Amount", Value: amountKes },
                  { Name: "MpesaReceiptNumber", Value: receipt },
                  { Name: "PhoneNumber", Value: 254712345678 },
                ],
              },
            }
          : {}),
      },
    },
  });
}

async function deliverDarajaCallback(rawBody: string) {
  const res = await ingestWebhook(db, { provider: new MpesaProviderAdapter("sandbox"), rawBody, headers: {} });
  if (!res.accepted) return res;
  const [event] = await db.query.webhookEvents.findMany({ orderBy: (t, { desc }) => [desc(t.createdAt)], limit: 1 });
  await processWebhookEvent(db, event!.id);
  return res;
}

beforeEach(async () => {
  ({ db, pool } = createDb());
  await clean();
});

afterAll(async () => {
  await clean();
  await pool.end();
});

describe("STK push request-to-pay", () => {
  it("PENDING → Daraja success callback → wallet credited once, balanced ledger, eTIMS receipt", async () => {
    const t = await makeTenant("Stk Co");
    await configureDevice(db, { tenantId: t.tenantId, kraPin: "P051234567Q", deviceSerial: "ZF-TEST-01", client: etims });

    const { collection } = await requestStkCollection(
      db,
      {
        tenantId: t.tenantId,
        actorId: t.actorId,
        phone: "0712345678",
        amountMinor: 1_500_00n,
        description: "Consultation",
        payer: { name: "Jane Wanjiru", idType: "NATIONAL_ID", idNumber: "23456789", kraPin: "A123456789B" },
        idempotencyKey: "stk-test-0001",
      },
      new MockProvider("success"),
    );
    expect(collection.status).toBe("PENDING");
    expect(collection.payerPhone).toBe("+254712345678");
    expect(collection.providerReference).toMatch(/^ws_CO_MOCK_/);

    // replay of the same request returns the same collection
    const replay = await requestStkCollection(
      db,
      { tenantId: t.tenantId, actorId: t.actorId, phone: "0712345678", amountMinor: 1_500_00n, idempotencyKey: "stk-test-0001" },
      new MockProvider("success"),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.collection.id).toBe(collection.id);

    await deliverDarajaCallback(stkCallback(collection.providerReference!, true, 1500, "SFT3AAA111"));
    const dup = await deliverDarajaCallback(stkCallback(collection.providerReference!, true, 1500, "SFT3AAA111"));
    expect(dup.accepted).toBe(false); // provider event dedupe

    const [settled] = await db.select().from(schema.collections).where(eq(schema.collections.id, collection.id));
    expect(settled!.status).toBe("SUCCESS");
    expect(settled!.receiptNumber).toBe("SFT3AAA111");
    const bal = await getWalletBalance(db, t.walletId, t.tenantId);
    expect(bal.availableMinor).toBe(1_500_00n);
    expect(await ledgerNet()).toBe("0");

    // settling again is a no-op
    const again = await settleCollection(db, { collectionId: collection.id });
    expect(again.alreadySettled).toBe(true);
    expect((await getWalletBalance(db, t.walletId, t.tenantId)).availableMinor).toBe(1_500_00n);

    // outbox → signed eTIMS receipt carrying the payer's KRA PIN
    await drainOutbox(t.tenantId);
    const [withReceipt] = await db.select().from(schema.collections).where(eq(schema.collections.id, collection.id));
    expect(withReceipt!.receiptId).toBeTruthy();
    const [receipt] = await db.select().from(schema.etimsDocuments).where(eq(schema.etimsDocuments.id, withReceipt!.receiptId!));
    expect(receipt).toMatchObject({ docType: "RECEIPT", status: "SIGNED", customerKraPin: "A123456789B", invoiceNo: 1, paymentMethod: "06" });
    expect(receipt!.totalMinor).toBe(1_500_00n);
    expect(receipt!.taxMinor).toBe(20690n); // 1500 × 16/116 = 206.90
    expect(receipt!.receiptSignature).toHaveLength(16);
    expect(receipt!.verificationUrl).toContain("P051234567Q00");

    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.tenantId, t.tenantId));
    expect(notes.some((n) => n.title === "Payment received" && n.body.includes(receipt!.number))).toBe(true);
    expect((await collectionStats(db, t.tenantId)).successCount).toBe(1);
  });

  it("payer cancels → FAILED, no money moves", async () => {
    const t = await makeTenant("Cancel Co");
    const { collection } = await requestStkCollection(
      db,
      { tenantId: t.tenantId, actorId: t.actorId, phone: "+254712345678", amountMinor: 500_00n, idempotencyKey: "stk-cancel-01" },
      new MockProvider("success"),
    );
    await deliverDarajaCallback(stkCallback(collection.providerReference!, false));
    const [row] = await db.select().from(schema.collections).where(eq(schema.collections.id, collection.id));
    expect(row!.status).toBe("FAILED");
    expect(row!.failureReason).toMatch(/cancelled/i);
    expect((await getWalletBalance(db, t.walletId, t.tenantId)).availableMinor).toBe(0n);
  });

  it("validates phone and M-Pesa limits; a rejected push is FAILED", async () => {
    const t = await makeTenant("Limits Co");
    const base = { tenantId: t.tenantId, actorId: t.actorId, idempotencyKey: "x" };
    await expect(requestStkCollection(db, { ...base, phone: "123", amountMinor: 100_00n }, new MockProvider())).rejects.toThrow(/valid Kenyan/);
    await expect(
      requestStkCollection(db, { ...base, phone: "0712345678", amountMinor: 250_001_00n, idempotencyKey: "y" }, new MockProvider()),
    ).rejects.toThrow(/250,000/);
    const r = await requestStkCollection(db, { ...base, phone: "0712345678", amountMinor: 10_00n, idempotencyKey: "z-fail-01" }, new MockProvider("fail"));
    expect(r.collection.status).toBe("FAILED");
  });
});

describe("tax invoices + C2B paybill", () => {
  it("fiscalises an invoice, C2B pays it by account ref, issues a payment receipt; duplicates + unknown accounts are safe", async () => {
    const t = await makeTenant("Acme Paybill", "ACME");
    await configureDevice(db, { tenantId: t.tenantId, kraPin: "P051234567Q", deviceSerial: "ZF-TEST-02", client: etims });
    const inv = await createDocument(db, {
      tenantId: t.tenantId,
      actorId: t.actorId,
      docType: "INVOICE",
      customer: { name: "Mombasa Hardware Ltd", kraPin: "P000111222Z", phone: "+254722000111" },
      lines: [
        { description: "Cement 50kg", qtyMilli: parseQtyMilli("10"), unitPriceMinor: 750_00n, taxType: "B" },
        { description: "Delivery", qtyMilli: parseQtyMilli("1"), unitPriceMinor: 1_000_00n, taxType: "B" },
      ],
      pricesIncludeTax: false,
    });
    expect(inv.number).toBe("INV-000001");
    expect(inv.totalMinor).toBe(9_860_00n); // (7500 + 1000) × 1.16
    const signed = await fiscaliseDocument(db, { tenantId: t.tenantId, documentId: inv.id, client: etims });
    expect(signed.status).toBe("SIGNED");
    expect((signed.requestPayload as Record<string, unknown>).custTin).toBe("P000111222Z");

    // Signed documents are immutable (DB trigger)
    await expect(pool.query(`UPDATE etims_documents SET total_minor = 1 WHERE id = $1`, [inv.id])).rejects.toThrow(/immutable/);
    await expect(pool.query(`DELETE FROM etims_documents WHERE id = $1`, [inv.id])).rejects.toThrow(/cannot be deleted/);

    const body = JSON.stringify({
      TransactionType: "Pay Bill",
      TransID: "RKT000C2B1",
      TransTime: "20260925120000",
      TransAmount: "9860.00",
      BusinessShortCode: "174379",
      BillRefNumber: "acme-inv-000001",
      MSISDN: "254722000111",
      FirstName: "Ali",
      LastName: "Hassan",
    });
    const c2b = parseC2BConfirmation(body)!;
    expect((await validateC2BPayment(db, c2b)).accept).toBe(true);
    const res = await recordC2BPayment(db, c2b);
    expect(res.status).toBe("SETTLED");
    expect(res.collection!.invoiceId).toBe(inv.id);
    expect((await recordC2BPayment(db, c2b)).status).toBe("DUPLICATE");

    const [paid] = await db.select().from(schema.etimsDocuments).where(eq(schema.etimsDocuments.id, inv.id));
    expect(paid!.paymentStatus).toBe("PAID");
    expect(paid!.paidMinor).toBe(9_860_00n);
    expect((await getWalletBalance(db, t.walletId, t.tenantId)).availableMinor).toBe(9_860_00n);

    await drainOutbox(t.tenantId);
    const [col] = await db.select().from(schema.collections).where(eq(schema.collections.id, res.collection!.id));
    const [prc] = await db.select().from(schema.etimsDocuments).where(eq(schema.etimsDocuments.id, col!.receiptId!));
    // invoice already fiscalised → non-fiscal payment receipt (no double VAT declaration)
    expect(prc).toMatchObject({ docType: "PAYMENT_RECEIPT", status: "ISSUED", originalDocumentId: inv.id });
    const devices = await db.select().from(schema.etimsDevices).where(eq(schema.etimsDevices.tenantId, t.tenantId));
    expect(devices[0]!.lastInvoiceNo).toBe(1);

    const unknown = parseC2BConfirmation(body.replace("RKT000C2B1", "RKT000C2B2").replace("acme-inv-000001", "NOPE"))!;
    expect((await validateC2BPayment(db, unknown)).resultCode).toBe("C2B00012");
    expect((await recordC2BPayment(db, unknown)).status).toBe("UNMATCHED");
    const orphans = await db.select().from(schema.reconItems).where(and(eq(schema.reconItems.source, "MPESA_C2B"), eq(schema.reconItems.providerReference, "RKT000C2B2")));
    expect(orphans).toHaveLength(1);

    // credit note reverses the invoice with rcptTyCd R + orgInvcNo
    const crn = await createCreditNote(db, { tenantId: t.tenantId, originalDocumentId: inv.id, reason: "Goods returned" });
    const crnSigned = await fiscaliseDocument(db, { tenantId: t.tenantId, documentId: crn.id, client: etims });
    expect(crnSigned.status).toBe("SIGNED");
    expect(crnSigned.requestPayload).toMatchObject({ rcptTyCd: "R", orgInvcNo: 1, invcNo: 2 });
    await expect(createCreditNote(db, { tenantId: t.tenantId, originalDocumentId: inv.id, reason: "again" })).rejects.toThrow(/already/);
    expect(await ledgerNet()).toBe("0");
  });

  it("fiscalisation is fail-closed without a device and bank transfers dedupe by reference", async () => {
    const t = await makeTenant("No Device Co");
    const doc = await createDocument(db, {
      tenantId: t.tenantId,
      docType: "INVOICE",
      lines: [{ description: "Service", qtyMilli: 1000n, unitPriceMinor: 100_00n, taxType: "B" }],
      pricesIncludeTax: true,
    });
    await expect(fiscaliseDocument(db, { tenantId: t.tenantId, documentId: doc.id, client: etims })).rejects.toThrow(/not set up/);

    const bank = await recordBankCollection(db, { tenantId: t.tenantId, actorId: t.actorId, amountMinor: 50_000_00n, bankReference: "FT26268ABC12", invoiceId: doc.id });
    expect(bank.status).toBe("SUCCESS");
    await expect(
      recordBankCollection(db, { tenantId: t.tenantId, actorId: t.actorId, amountMinor: 1_00n, bankReference: "ft26268abc12" }),
    ).rejects.toThrow(/already recorded/);
    // no device → no auto receipt, but money + invoice still settle
    await drainOutbox(t.tenantId);
    const [row] = await db.select().from(schema.collections).where(eq(schema.collections.id, bank.id));
    expect(row!.receiptId).toBeNull();
  });
});

describe("payment links are collections", () => {
  it("records a PAYMENT_LINK collection and never exceeds maxUses under concurrency", async () => {
    const t = await makeTenant("Link Co");
    const link = await createPaymentLink(db, { tenantId: t.tenantId, actorId: t.actorId, name: "Deposit", amountMinor: 1_000_00n, maxUses: 2 });
    const results = await Promise.allSettled(
      ["p-aaaaaaa1", "p-aaaaaaa2", "p-aaaaaaa3", "p-aaaaaaa4"].map((payerRef) => collectViaPaymentLink(db, { token: link.token, payerRef })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const cols = await db.select().from(schema.collections).where(eq(schema.collections.tenantId, t.tenantId));
    expect(cols.filter((c) => c.channel === "PAYMENT_LINK" && c.status === "SUCCESS")).toHaveLength(2);
    expect((await getWalletBalance(db, t.walletId, t.tenantId)).availableMinor).toBe(2_000_00n);
    expect(await ledgerNet()).toBe("0");
  });
});
