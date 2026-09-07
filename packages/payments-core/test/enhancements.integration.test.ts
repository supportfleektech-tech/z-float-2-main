/**
 * Integration tests for the Tier-1 enhancements:
 *  - payment links: public collection funds the tenant wallet via a balanced
 *    journal, respects expiry/limits, and is tenant-isolated.
 *  - statement-import reconciliation: matches rows to payments by provider
 *    reference + amount and surfaces exceptions.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@zfloat/database";
import { ensureSystemChart, getWalletBalance } from "@zfloat/ledger";
import { createPaymentLink, getPaymentLinkView, collectViaPaymentLink } from "../src/payment-links.js";
import { reconcileStatement } from "../src/reconciliation.js";
import { createPayment, submitPayment } from "../src/payments.js";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];

async function clean() {
  await pool.query(
    `TRUNCATE payment_links, webhook_deliveries, webhook_subscriptions, recon_exceptions, recon_matches, recon_items, recon_runs,
             notifications, journal_entries, journals, ledger_accounts, chart_of_accounts, wallets, wallet_reservations,
             payments, beneficiaries, tenants, users
     CASCADE`,
  );
}

/** Create an isolated tenant with its own system chart, wallet and owner. Pure — no globals. */
async function makeTenant(name: string) {
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name, slug: `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`, status: "ACTIVE" })
    .returning({ id: schema.tenants.id });
  const tenantId = tenant!.id;
  await ensureSystemChart(db, tenantId);
  const [wallet] = await db.insert(schema.wallets).values({ tenantId, name: "Main Wallet", currency: "KES" }).returning();
  const [user] = await db
    .insert(schema.users)
    .values({ tenantId, email: `${crypto.randomUUID().slice(0, 8)}@test.co.ke`, fullName: "Test Owner", status: "ACTIVE" })
    .returning({ id: schema.users.id });
  return { tenantId, walletId: wallet!.id, actorId: user!.id };
}

beforeEach(async () => {
  ({ db, pool } = createDb());
  await clean();
});

afterAll(async () => {
  await clean();
  await pool.end();
});

describe("payment links", () => {
  it("funds the tenant wallet through a balanced journal and counts the use", async () => {
    const { tenantId, walletId, actorId } = await makeTenant("Link Co");
    const link = await createPaymentLink(db, { tenantId, actorId, name: "Invoice #1", amountMinor: 25000n });

    const before = await getWalletBalance(db, walletId, tenantId);
    const res = await collectViaPaymentLink(db, { token: link.token, payerRef: "payer-A" });
    expect(res.fundedMinor).toBe(25000n);
    const after = await getWalletBalance(db, walletId, tenantId);
    expect(after.availableMinor - before.availableMinor).toBe(25000n);

    const [updated] = await db.select({ useCount: schema.paymentLinks.useCount }).from(schema.paymentLinks).where(eq(schema.paymentLinks.id, link.id));
    expect(updated!.useCount).toBe(1);

    // Ledger stays balanced
    const check = await pool.query(
      `SELECT (sum(CASE WHEN jt='d' THEN amt ELSE 0 END) - sum(CASE WHEN jt='c' THEN amt ELSE 0 END)) AS net
       FROM (SELECT 'd' AS jt, debit_minor AS amt FROM journal_entries UNION ALL SELECT 'c', credit_minor FROM journal_entries) x`,
    );
    expect(check.rows[0]?.net).toBe("0");
  });

  it("rejects an expired link and a limit-exhausted link", async () => {
    const { tenantId, actorId } = await makeTenant("Limits Co");
    const expired = await createPaymentLink(db, {
      tenantId,
      actorId,
      name: "Old",
      amountMinor: 1000n,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(collectViaPaymentLink(db, { token: expired.token, payerRef: "p1" })).rejects.toThrow(/expired/);

    const limited = await createPaymentLink(db, { tenantId, actorId, name: "Once", amountMinor: 1000n, maxUses: 1 });
    await collectViaPaymentLink(db, { token: limited.token, payerRef: "p1" });
    await expect(collectViaPaymentLink(db, { token: limited.token, payerRef: "p2" })).rejects.toThrow(/usage limit/);
  });

  it("is tenant-isolated: another tenant's token cannot fund this tenant", async () => {
    const a = await makeTenant("Tenant A");
    const b = await makeTenant("Tenant B");
    const linkA = await createPaymentLink(db, { tenantId: a.tenantId, actorId: a.actorId, name: "A link", amountMinor: 500n });

    // B tries to collect A's link → validation passes, but wallet lookup is scoped to the
    // link's tenant (A), which is the correct behavior: funds land in A's wallet, never B's.
    await collectViaPaymentLink(db, { token: linkA.token, payerRef: "p-x" });
    const balA = await getWalletBalance(db, a.walletId, a.tenantId);
    const balB = await getWalletBalance(db, b.walletId, b.tenantId);
    expect(balA.availableMinor).toBe(500n);
    expect(balB.availableMinor).toBe(0n);
  });

  it("exposes a safe public view (no tenant internals)", async () => {
    const { tenantId, actorId } = await makeTenant("View Co");
    const link = await createPaymentLink(db, { tenantId, actorId, name: "Safe", amountMinor: 700n });
    const view = await getPaymentLinkView(db, link.token);
    expect(view).toEqual({
      id: link.id,
      tenantName: "View Co",
      name: "Safe",
      description: null,
      amountMinor: "700",
      currency: "KES",
      status: "ACTIVE",
    });
    expect(await getPaymentLinkView(db, "pl_nonexistent")).toBeNull();
  });
});

describe("statement-import reconciliation", () => {
  async function makeSuccessPayment(ctx: { tenantId: string; walletId: string; actorId: string }, ref: string, amountMinor: bigint) {
    const payment = await createPayment(db, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      amount: (Number(amountMinor) / 100).toFixed(2),
      channel: "mpesa",
      recipient: { name: "Test Beneficiary", phone: "+254712345678" },
      sourceWalletId: ctx.walletId,
      idempotencyKey: `st-${ref}`,
    });
    await submitPayment(db, { tenantId: ctx.tenantId, paymentId: payment.payment.paymentId, actorId: ctx.actorId });
    await pool.query(`UPDATE payments SET provider_reference = $1 WHERE id = $2`, [ref, payment.payment.paymentId]);
  }

  it("matches exact rows, flags amount mismatches and unmatched rows", async () => {
    const ctx = await makeTenant("Recon Co");
    await makeSuccessPayment(ctx, "MOCK-REF-1001", 5000n);

    const result = await reconcileStatement(db, {
      tenantId: ctx.tenantId,
      periodStart: new Date(Date.now() - 7 * 86400_000),
      periodEnd: new Date(),
      rows: [
        { providerReference: "MOCK-REF-1001", amountMinor: 5000n, occurredAt: new Date() }, // exact match
        { providerReference: "MOCK-REF-1001", amountMinor: 9999n, occurredAt: new Date() }, // amount mismatch
        { providerReference: "GHOST-REF-777", amountMinor: 1200n, occurredAt: new Date() }, // unmatched
      ],
    });

    expect(result.rowsImported).toBe(3);
    expect(result.matched).toBe(1);
    expect(result.partial).toBe(1);
    expect(result.unmatched).toBe(1);
    expect(result.exceptions).toBe(2);

    const items = await db.select().from(schema.reconItems).where(eq(schema.reconItems.runId, result.runId));
    expect(items.find((i) => i.providerReference === "MOCK-REF-1001" && i.amountMinor === 5000n)?.status).toBe("MATCHED");
    expect(items.find((i) => i.providerReference === "MOCK-REF-1001" && i.amountMinor === 9999n)?.status).toBe("PARTIAL");
    expect(items.find((i) => i.providerReference === "GHOST-REF-777")?.status).toBe("UNMATCHED");

    const exceptions = await db.select().from(schema.reconExceptions).where(eq(schema.reconExceptions.tenantId, ctx.tenantId));
    expect(exceptions.map((e) => e.kind).sort()).toEqual(["AMOUNT_MISMATCH", "UNMATCHED"]);
  });

  it("does not match rows belonging to another tenant", async () => {
    const a = await makeTenant("Tenant A");
    await makeSuccessPayment(a, "TENANT-A-REF", 3000n);
    const b = await makeTenant("Tenant B");
    const result = await reconcileStatement(db, {
      tenantId: b.tenantId,
      periodStart: new Date(Date.now() - 7 * 86400_000),
      periodEnd: new Date(),
      rows: [{ providerReference: "TENANT-A-REF", amountMinor: 3000n, occurredAt: new Date() }],
    });
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(1);
  });
});
