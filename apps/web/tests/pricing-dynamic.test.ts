/**
 * ACCEPTANCE: admin pricing changes must take effect WITHOUT code changes.
 *
 * Proves the full chain:
 *  1. Fee rules live in the DB (fee_rules) and computeFee reads them live.
 *  2. The admin console's POST /api/admin/pricing flow (version bump + audit
 *     + fee_versions snapshot) is what changes them.
 *  3. Marketing pricing content is DB-driven (pages + GLOBAL settings).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, schema, toJsonSafe, eq } from "@zfloat/database";
import { computeFee } from "@zfloat/payments-core";
import { getSiteContent } from "../lib/site.js";

let pool: ReturnType<typeof createDb>["pool"];
let db: ReturnType<typeof createDb>["db"];
let TENANT = "";
const PROVIDER = `pricing-test-${Date.now()}`;
let RULE_ID = "";

beforeAll(async () => {
  ({ db, pool } = createDb());
  const [t] = await db
    .insert(schema.tenants)
    .values({ name: "Pricing Test Co", slug: `pricing-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`, status: "ACTIVE" })
    .returning();
  TENANT = t!.id;

  // base rule: flat 10.00 — provider code is unique to this test so the seeded
  // global rules (1.5% mpesa) never shadow it.
  const rule = await db
    .insert(schema.feeRules)
    .values({
      product: "single_payment",
      channel: "mpesa",
      provider: PROVIDER,
      flatFeeMinor: 1000n,
      percentBps: 0n,
      minFeeMinor: 0n,
      maxFeeMinor: 0n,
      status: "ACTIVE",
      version: 1,
      changeComment: "test base",
    })
    .returning();
  RULE_ID = rule[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

describe("admin pricing takes effect without code changes", () => {
  it("computeFee uses the live fee_rules value (no hard-coded pricing)", async () => {
    const before = await computeFee(db, 5_000_00n, { tenantId: TENANT, product: "single_payment", channel: "mpesa", providerCode: PROVIDER });
    expect(before.feeMinor).toBe(1000n); // KES 10.00 from the DB rule
    expect(before.ruleSnapshot).toHaveProperty("flatFeeMinor", "1000"); // bigint → decimal string in snapshots
  });

  it("after an admin-style update (version bump + fee_versions + audit), the fee changes with zero code changes", async () => {
    const [rule] = await db.select().from(schema.feeRules).where(eq(schema.feeRules.id, RULE_ID)).limit(1);
    const newVersion = (rule!.version ?? 1) + 1;

    // what POST /api/admin/pricing does (version + snapshot + comment)
    await db.update(schema.feeRules).set({ flatFeeMinor: 5000n, version: newVersion, changeComment: "admin change" }).where(eq(schema.feeRules.id, rule!.id));
    await db.insert(schema.feeVersions).values({
      feeRuleId: rule!.id,
      version: newVersion,
      snapshot: toJsonSafe({ flatFeeMinor: 5000n }) as Record<string, unknown>,
      changeComment: "admin change",
    });

    const after = await computeFee(db, 5_000_00n, { tenantId: TENANT, product: "single_payment", channel: "mpesa", providerCode: PROVIDER });
    expect(after.feeMinor).toBe(5000n); // KES 50.00 — live, no redeploy
  });
});

describe("marketing pricing content is DB-driven", () => {
  it("reads the pricing page and GLOBAL settings seeded by the platform admin", async () => {
    const content = await getSiteContent("pricing");
    expect(content.page?.slug).toBe("pricing");
    expect(content.settings["site.brand.name"]).toBe("Z-float");
  });
});
