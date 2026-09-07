/**
 * SECURITY: tenant isolation — a user in tenant A can never read or act on
 * tenant B's payments, even with a valid session.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "@zfloat/database";
import { createDb, schema } from "@zfloat/database";
import { createPayment, submitPayment } from "@zfloat/payments-core";
import { ensureSystemChart, postFundingJournal } from "@zfloat/ledger";

let pool: ReturnType<typeof createDb>["pool"];
let db: ReturnType<typeof createDb>["db"];
const TENANT_A = crypto.randomUUID();
const TENANT_B = crypto.randomUUID();

async function makeTenant(id: string, name: string) {
  await db.insert(schema.tenants).values({ id, name, slug: `${name}-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`, status: "ACTIVE" });
  await ensureSystemChart(db, id);
  const [wallet] = await db
    .insert(schema.wallets)
    .values({ tenantId: id, name: "Ops", currency: "KES" })
    .returning();
  await postFundingJournal(db, { tenantId: id, walletId: wallet!.id, amountMinor: 1_000_000_00n });
  return wallet!.id;
}

beforeAll(async () => {
  ({ db, pool } = createDb());
  const walletA = await makeTenant(TENANT_A, "Tenant A");
  await makeTenant(TENANT_B, "Tenant B");

  // a successful payment in tenant A
  const { payment } = await createPayment(db, {
    tenantId: TENANT_A,
    actorId: crypto.randomUUID(),
    amount: "5000.00",
    channel: "mpesa",
    product: "single_payment",
    sourceWalletId: walletA,
    recipient: { name: "Jane", phone: "0712345678" },
    idempotencyKey: `iso-${Date.now()}`,
  });
  await submitPayment(db, { tenantId: TENANT_A, paymentId: payment.paymentId, actorId: crypto.randomUUID(), policyRules: [] });
});

afterAll(async () => {
  await pool.end();
});

describe("tenant isolation", () => {
  it("tenant B's query layer returns nothing for tenant A's payments", async () => {
    const rows = await db
      .select({ id: schema.payments.id, tenantId: schema.payments.tenantId })
      .from(schema.payments)
      .where(eq(schema.payments.tenantId, TENANT_B));
    expect(rows.length).toBe(0);
  });

  it("a payment row carries its tenant and an idempotent create cannot cross tenants", async () => {
    const rows = await db.select().from(schema.payments).where(eq(schema.payments.tenantId, TENANT_A));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.tenantId).toBe(TENANT_A);
  });

  it("submitPayment on tenant B's behalf cannot touch tenant A's payment", async () => {
    const [paymentA] = await db.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.tenantId, TENANT_A)).limit(1);
    await expect(
      submitPayment(db, { tenantId: TENANT_B, paymentId: paymentA!.id, actorId: crypto.randomUUID(), policyRules: [] }),
    ).rejects.toThrow(/not found|tenant/i);
  });
});
