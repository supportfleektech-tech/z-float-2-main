/**
 * Wallet top-up via M-PESA STK push — end-to-end on real PostgreSQL.
 *
 * Flow under test (the /api/wallet/top-up → webhook callback path):
 *   initiateStkPush(accountReference: "WALLET-TOPUP") → PENDING collection
 *   → Daraja STK success callback → wallet credited via double-entry ledger
 *   (balanced funding journal + wallet-ledger FUND entry typed wallet_top_up)
 *   → collection SUCCESS. Duplicates and payer-cancelled callbacks are safe.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@zfloat/database";
import { ensureSystemChart, getWalletBalance } from "@zfloat/ledger";
import { MockProvider, MpesaProviderAdapter } from "@zfloat/providers";
import { initiateStkPush } from "../src/collections.js";
import { ingestWebhook, processWebhookEvent } from "../src/webhooks.js";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];

async function clean() {
  await pool.query(
    `TRUNCATE outbox_events, webhook_events, recon_items, notifications,
              journal_entries, journals, ledger_accounts, chart_of_accounts,
              wallet_ledger_entries, wallets, tenants, users CASCADE`,
  );
}

async function makeTenant(name: string) {
  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}`,
      status: "ACTIVE",
    })
    .returning({ id: schema.tenants.id });
  const tenantId = tenant!.id;
  await ensureSystemChart(db, tenantId);
  const [wallet] = await db.insert(schema.wallets).values({ tenantId, name: "Main", currency: "KES" }).returning();
  return { tenantId, walletId: wallet!.id };
}

async function ledgerNet(): Promise<string> {
  const r = await pool.query(`SELECT COALESCE(SUM(debit_minor),0) - COALESCE(SUM(credit_minor),0) AS net FROM journal_entries`);
  return String(r.rows[0]?.net);
}

function stkCallback(checkoutRequestId: string, ok: boolean, amountKes = 0, receipt = "SFT3TOPUP1") {
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

describe("wallet top-up via STK push", () => {
  it("STK success callback credits the wallet via the double-entry ledger and tags the entry wallet_top_up", async () => {
    const t = await makeTenant("Topup Co");

    const result = await initiateStkPush(
      db,
      { tenantId: t.tenantId },
      { phoneNumber: "0712345678", amountMinor: 500_00n, accountReference: "WALLET-TOPUP", callbackUrl: "" },
      new MockProvider("success"),
    );
    expect(result.transactionId).toBeTruthy();
    expect(result.providerRef).toMatch(/^ws_CO_MOCK_/);

    const [pending] = await db.select().from(schema.collections).where(eq(schema.collections.id, result.transactionId));
    expect(pending!.status).toBe("PENDING");
    expect(pending!.accountReference).toBe("WALLET-TOPUP");
    expect(pending!.walletId).toBe(t.walletId);
    expect((await getWalletBalance(db, t.walletId, t.tenantId)).availableMinor).toBe(0n);

    // Daraja success callback → worker processing → settlement
    await deliverDarajaCallback(stkCallback(result.providerRef, true, 500, "SFT3TOPUP1"));

    const [settled] = await db.select().from(schema.collections).where(eq(schema.collections.id, result.transactionId));
    expect(settled!.status).toBe("SUCCESS");
    expect(settled!.receiptNumber).toBe("SFT3TOPUP1");
    expect(settled!.settledAt).toBeTruthy();

    // Wallet credited, funding journal balanced (Dr wallet / Cr float liability)
    expect((await getWalletBalance(db, t.walletId, t.tenantId)).availableMinor).toBe(500_00n);
    expect(await ledgerNet()).toBe("0");

    // Wallet-ledger FUND entry typed as a top-up
    const entries = await db
      .select()
      .from(schema.walletLedgerEntries)
      .where(and(eq(schema.walletLedgerEntries.walletId, t.walletId), eq(schema.walletLedgerEntries.refType, "wallet_top_up")));
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatchObject({ entryType: "FUND", amountMinor: 500_00n, deltaAvailableMinor: 500_00n });

    // Replay of the same callback is deduped — no double credit
    const replay = await deliverDarajaCallback(stkCallback(result.providerRef, true, 500, "SFT3TOPUP1"));
    expect(replay.accepted).toBe(false);
    expect((await getWalletBalance(db, t.walletId, t.tenantId)).availableMinor).toBe(500_00n);
    expect(await ledgerNet()).toBe("0");
  });

  it("payer cancels → collection FAILED, no money moves", async () => {
    const t = await makeTenant("Topup Cancel Co");

    const result = await initiateStkPush(
      db,
      { tenantId: t.tenantId },
      { phoneNumber: "0712345678", amountMinor: 1_000_00n, accountReference: "WALLET-TOPUP", callbackUrl: "" },
      new MockProvider("success"),
    );

    await deliverDarajaCallback(stkCallback(result.providerRef, false));

    const [row] = await db.select().from(schema.collections).where(eq(schema.collections.id, result.transactionId));
    expect(row!.status).toBe("FAILED");
    expect(row!.failureReason).toMatch(/cancelled/i);
    expect((await getWalletBalance(db, t.walletId, t.tenantId)).availableMinor).toBe(0n);
    expect(await ledgerNet()).toBe("0");
  });
});
