/**
 * Platform-config maker-checker integration tests (real PostgreSQL):
 * staged catalog changes apply only on a SECOND platform admin's approval;
 * the maker can never approve their own change; rejects are no-ops;
 * apply-time conflicts surface as execution_error + audit events.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@zfloat/database";
import { randomUUID } from "node:crypto";
import {
  createPlatformConfigChange,
  decidePlatformConfigChange,
  listPlatformConfigRequests,
  PlatformConfigError,
} from "../src/index.js";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
const MAKER = "11111111-1111-1111-1111-111111111111";
const CHECKER = "22222222-2222-2222-2222-222222222222";
const OTHER_ROLE = "44444444-4444-4444-4444-444444444444";

async function clean() {
  await pool.query(
    `TRUNCATE approval_actions, approval_steps, approval_requests, billers, airtime_catalog, audit_events,
     fee_rules, fee_versions, approval_policies, approval_policy_versions, feature_flags CASCADE`,
  );
}

async function seedTenant(name = "Maker-checker Co") {
  const [t] = await db
    .insert(schema.tenants)
    .values({ name, slug: `mc2-${randomUUID().slice(0, 12)}` })
    .returning();
  return t!;
}

beforeEach(async () => {
  ({ db, pool } = createDb());
  await clean();
});

afterAll(async () => {
  await pool.end();
});

async function billerByCode(code: string) {
  const rows = await db.select().from(schema.billers).where(eq(schema.billers.code, code)).limit(1);
  return rows[0];
}

describe("platform config maker-checker", () => {
  it("billers: create is staged, maker cannot approve, checker approval applies it", async () => {
    const staged = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "biller",
      op: "create",
      payload: {
        code: "kplc-test",
        name: "Kenya Power (test)",
        category: "utilities",
        channel: "paybill",
        accountNumber: "880100",
        enabled: true,
      },
    });

    // staged only — nothing written yet
    expect(await billerByCode("kplc-test")).toBeUndefined();

    const reqs = await listPlatformConfigRequests(db, "PENDING");
    expect(reqs.map((r) => r.id)).toContain(staged.requestId);
    expect(reqs.find((r) => r.id === staged.requestId)?.change?.kind).toBe("biller");

    // maker cannot approve own staged change
    await expect(
      decidePlatformConfigChange(db, {
        requestId: staged.requestId,
        actorId: MAKER,
        actorRoles: ["SUPER_ADMIN"],
        decision: "APPROVE",
      }),
    ).rejects.toThrow(/MAKER_CHECKER_VIOLATION|creator/i);

    // a user without the SUPER_ADMIN role cannot decide
    await expect(
      decidePlatformConfigChange(db, {
        requestId: staged.requestId,
        actorId: OTHER_ROLE,
        actorRoles: ["SUPPORT_ADMIN"],
        decision: "APPROVE",
      }),
    ).rejects.toThrow(/role|ROLE_MISMATCH/i);

    // distinct SUPER_ADMIN approves → applied
    const outcome = await decidePlatformConfigChange(db, {
      requestId: staged.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
    });
    expect(outcome.status).toBe("APPROVED");
    expect(outcome.applied).toBe(true);

    const row = await billerByCode("kplc-test");
    expect(row?.name).toBe("Kenya Power (test)");
    expect(row?.accountNumber).toBe("880100");

    const [req] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, staged.requestId)).limit(1);
    expect(req?.status).toBe("APPROVED");
    expect(req?.executedAt).toBeInstanceOf(Date);
    expect(req?.executionError).toBeNull();

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "catalog.biller.create"));
    expect(audits.length).toBe(1);
    expect(audits[0]!.actorId).toBe(CHECKER);
  });

  it("billers: update is a delta applied on approval; code stays immutable at staging", async () => {
    const [existing] = await db
      .insert(schema.billers)
      .values({ code: "saf-pay", name: "Safaricom", category: "telco", channel: "paybill", accountNumber: "247247", enabled: true })
      .returning();

    const staged = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "biller",
      op: "update",
      targetId: existing!.id,
      payload: { name: "Safaricom PLC", enabled: false },
    });

    await expect(
      createPlatformConfigChange(db, {
        actorId: MAKER,
        kind: "biller",
        op: "update",
        targetId: existing!.id,
        payload: { code: "other-code" },
      }),
    ).rejects.toThrow(PlatformConfigError);

    const outcome = await decidePlatformConfigChange(db, {
      requestId: staged.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
    });
    expect(outcome.applied).toBe(true);

    const [after] = await db.select().from(schema.billers).where(eq(schema.billers.id, existing!.id)).limit(1);
    expect(after?.name).toBe("Safaricom PLC");
    expect(after?.enabled).toBe(false);
    expect(after?.code).toBe("saf-pay"); // unchanged

    // Full-form saves echo the immutable code back — the echo must not trip
    // staging, and code must still never be rewritten on apply.
    const echo = await createPlatformConfigChange(db, {
      kind: "biller",
      op: "update",
      payload: { code: "saf-pay", name: "Safaricom Echo", category: "telco", channel: "paybill", accountNumber: "247247" },
      targetId: existing!.id,
      actorId: MAKER,
    });
    const echoDecided = await decidePlatformConfigChange(db, {
      requestId: echo.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
      comment: "echo ok",
    });
    expect(echoDecided.status).toBe("APPROVED");
    const echoRow = await billerByCode("saf-pay");
    expect(echoRow?.code).toBe("saf-pay");
    expect(echoRow?.name).toBe("Safaricom Echo"); // other fields still applied
  });

  it("billers: delete applies on approval; reject is a no-op", async () => {
    const [row] = await db
      .insert(schema.billers)
      .values({ code: "kplc-del", name: "KPLC", channel: "paybill", accountNumber: "111", enabled: true })
      .returning();

    // reject path
    const rejected = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "biller",
      op: "delete",
      targetId: row!.id,
      payload: {},
    });
    const rejectOutcome = await decidePlatformConfigChange(db, {
      requestId: rejected.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "REJECT",
      comment: "not now",
    });
    expect(rejectOutcome.status).toBe("REJECTED");
    expect(await billerByCode("kplc-del")).toBeDefined(); // untouched

    // approve path
    const staged = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "biller",
      op: "delete",
      targetId: row!.id,
      payload: {},
    });
    const outcome = await decidePlatformConfigChange(db, {
      requestId: staged.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
    });
    expect(outcome.applied).toBe(true);
    expect(await billerByCode("kplc-del")).toBeUndefined();
  });

  it("billers: duplicate code is refused at staging; apply-time conflict fails visibly", async () => {
    await db.insert(schema.billers).values({ code: "dup-code", name: "A", channel: "paybill", accountNumber: "1", enabled: true });

    await expect(
      createPlatformConfigChange(db, {
        actorId: MAKER,
        kind: "biller",
        op: "create",
        payload: { code: "dup-code", name: "B", channel: "till", accountNumber: "2" },
      }),
    ).rejects.toThrow(/already exists/);

    // no live duplicate at staging time…
    const staged = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "biller",
      op: "create",
      payload: { code: "race-code", name: "Racer", channel: "paybill", accountNumber: "3" },
    });
    // …but a concurrent approval wins the unique slot before ours applies.
    await db.insert(schema.billers).values({ code: "race-code", name: "Concurrent", channel: "paybill", accountNumber: "4", enabled: true });

    const outcome = await decidePlatformConfigChange(db, {
      requestId: staged.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
    });
    expect(outcome.applied).toBe(false);
    expect((outcome as { code?: string }).code).toBe("APPLY_FAILED");

    const [req] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, staged.requestId)).limit(1);
    expect(req?.executedAt).toBeNull();
    expect(req?.executionError).toContain("duplicate key");
    const fails = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "platform.config.apply_failed"));
    expect(fails.length).toBe(1);
  });

  it("airtime: staged create with KES denomination applies on approval", async () => {
    const staged = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "airtime",
      op: "create",
      payload: {
        providerCode: "safaricom",
        network: "SAF",
        productCode: "AIRTIME-100",
        name: "Airtime 100",
        type: "AIRTIME",
        amount: 100,
      },
    });
    expect(await db.select().from(schema.airtimeCatalog).where(eq(schema.airtimeCatalog.productCode, "AIRTIME-100")).limit(1)).toEqual([]);

    const outcome = await decidePlatformConfigChange(db, {
      requestId: staged.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
    });
    expect(outcome.applied).toBe(true);

    const rows = await db.select().from(schema.airtimeCatalog).where(eq(schema.airtimeCatalog.productCode, "AIRTIME-100")).limit(1);
    expect(rows[0]?.denominationMinor).toBe(10_000n);
    expect(rows[0]?.network).toBe("SAF");
    expect(rows[0]?.enabled).toBe(true);
  });

  it("staging validates payloads like the direct-write routes did", async () => {
    await expect(
      createPlatformConfigChange(db, {
        actorId: MAKER,
        kind: "biller",
        op: "create",
        payload: { code: "X!", name: "", channel: "paybill", accountNumber: "" },
      }),
    ).rejects.toThrow(/Code must be/);
    await expect(
      createPlatformConfigChange(db, {
        actorId: MAKER,
        kind: "airtime",
        op: "create",
        payload: { providerCode: "s", name: "x", amount: -5 },
      }),
    ).rejects.toThrow(/required|Amount must be/);
    await expect(
      createPlatformConfigChange(db, {
        actorId: MAKER,
        kind: "biller",
        op: "update",
        payload: { name: "No target" },
      }),
    ).rejects.toThrow(/Target id is required/);
    await expect(
      createPlatformConfigChange(db, {
        actorId: MAKER,
        kind: "biller",
        op: "update",
        targetId: randomUUID(),
        payload: { name: "ghost" },
      }),
    ).rejects.toThrow(/Target not found/);
  });
});

describe("platform config maker-checker: fee rules, approval policies, feature flags", () => {
  it("fee rule: staged create applies as version 1 with a feeVersions snapshot + audit", async () => {
    const staged = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "fee_rule",
      op: "create",
      payload: {
        product: "disbursement",
        channel: "mpesa",
        provider: "local-sandbox",
        flatFeeMinor: "2500",
        percentBps: "0",
        minFeeMinor: "0",
        maxFeeMinor: "10000",
        status: "ACTIVE",
        changeComment: "New fee via maker-checker",
      },
    });
    expect(await db.select().from(schema.feeRules).where(eq(schema.feeRules.product, "disbursement")).limit(1)).toEqual([]);

    const outcome = await decidePlatformConfigChange(db, {
      requestId: staged.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
    });
    expect(outcome.applied).toBe(true);

    const [rule] = await db.select().from(schema.feeRules).where(eq(schema.feeRules.product, "disbursement")).limit(1);
    expect(rule?.channel).toBe("mpesa");
    expect(rule?.flatFeeMinor).toBe(2500n);
    expect(rule?.version).toBe(1);

    const versions = await db.select().from(schema.feeVersions).where(eq(schema.feeVersions.feeRuleId, rule!.id));
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe(1);
    expect((versions[0]?.snapshot as { product?: string }).product).toBe("disbursement");
    expect(versions[0]?.changeComment).toBe("New fee via maker-checker");

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "pricing.rule.updated"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(CHECKER); // checker writes under their own authority
  });

  it("fee rule: partial staged update merges with the live row and bumps version", async () => {
    const [seed] = await db
      .insert(schema.feeRules)
      .values({
        product: "collection",
        channel: "paybill",
        provider: "local-sandbox",
        flatFeeMinor: 1500n,
        percentBps: 0n,
        minFeeMinor: 0n,
        maxFeeMinor: 0n,
        version: 1,
      })
      .returning();
    await db.insert(schema.feeVersions).values({
      feeRuleId: seed!.id,
      version: 1,
      snapshot: { seeded: true },
      changeComment: "seed",
      createdById: CHECKER,
    });

    const staged = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "fee_rule",
      op: "update",
      targetId: seed!.id,
      payload: { status: "DISABLED", changeComment: "Freeze during audit" },
    });
    const outcome = await decidePlatformConfigChange(db, {
      requestId: staged.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
    });
    expect(outcome.applied).toBe(true);

    const [after] = await db.select().from(schema.feeRules).where(eq(schema.feeRules.id, seed!.id)).limit(1);
    expect(after?.status).toBe("DISABLED");
    expect(after?.version).toBe(2);
    expect(after?.flatFeeMinor).toBe(1500n); // untouched field survives the merge
    expect(after?.product).toBe("collection");

    const versions = await db.select().from(schema.feeVersions).where(eq(schema.feeVersions.feeRuleId, seed!.id)).orderBy(schema.feeVersions.version);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect((versions[1]?.snapshot as { status?: string }).status).toBe("DISABLED");
  });

  it("approval policy: staged create lands active v1; rules are canonicalized to minor strings", async () => {
    const tenant = await seedTenant();
    const staged = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "approval_policy",
      op: "create",
      payload: {
        tenantId: tenant!.id,
        name: "Ops approvals",
        description: "Tiered maker-checker",
        rules: [
          { minAmount: "1000", maxAmount: "100000", mode: "ANY", requiredRoles: ["APPROVER", "TREASURY"], minApprovers: 2 },
          { minAmount: "100000.01", maxAmount: "", mode: "ANY", requiredRoles: ["SUPER_ADMIN"], minApprovers: 1 },
        ],
      },
    });
    const outcome = await decidePlatformConfigChange(db, {
      requestId: staged.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
    });
    expect(outcome.applied).toBe(true);

    const [policy] = await db.select().from(schema.approvalPolicies).where(eq(schema.approvalPolicies.name, "Ops approvals")).limit(1);
    expect(policy?.active).toBe(true);
    expect(policy?.version).toBe(1);
    expect(policy?.tenantId).toBe(tenant!.id);
    const rules = (policy?.rules ?? []) as Array<Record<string, unknown>>;
    expect(rules).toHaveLength(2);
    expect(rules[0]!.minAmountMinor).toBe("100000"); // KES 1000.00 → minor
    expect(rules[0]!.minApprovers).toBe(2);
    expect(rules[1]!.minAmountMinor).toBe("10000001");
    expect(rules[1]!.maxAmountMinor).toBeNull(); // unbounded

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "approval.policy.create"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(CHECKER);
  });

  it("approval policy: staged rule edit archives the live version and bumps to v2", async () => {
    const tenant = await seedTenant();
    const [policy] = await db
      .insert(schema.approvalPolicies)
      .values({
        tenantId: tenant!.id,
        name: "Payout policy",
        rules: [{ minAmountMinor: "500000", maxAmountMinor: null, mode: "ANY", requiredRoles: ["APPROVER"], minApprovers: 1, order: 0 }],
        version: 1,
        active: true,
      })
      .returning();

    const staged = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "approval_policy",
      op: "update",
      targetId: policy!.id,
      payload: {
        rules: [
          { minAmount: "5000", maxAmount: "", mode: "ANY", requiredRoles: ["APPROVER", "TREASURY"], minApprovers: 2 },
        ],
        comment: "Tighten threshold",
      },
    });
    const outcome = await decidePlatformConfigChange(db, {
      requestId: staged.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
    });
    expect(outcome.applied).toBe(true);

    const [after] = await db.select().from(schema.approvalPolicies).where(eq(schema.approvalPolicies.id, policy!.id)).limit(1);
    expect(after?.version).toBe(2);
    const newRules = (after?.rules ?? []) as Array<Record<string, unknown>>;
    expect(newRules[0]!.requiredRoles).toEqual(["APPROVER", "TREASURY"]);

    const archived = await db.select().from(schema.approvalPolicyVersions).where(eq(schema.approvalPolicyVersions.policyId, policy!.id));
    expect(archived).toHaveLength(1);
    expect(archived[0]?.version).toBe(1); // the OLD live version is what gets archived
    const oldRules = archived[0]?.rulesSnapshot as Array<Record<string, unknown>>;
    expect(oldRules[0]!.requiredRoles).toEqual(["APPROVER"]);
    expect(oldRules[0]!.minAmountMinor).toBe("500000");

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "approval.policy.update"));
    expect(audits).toHaveLength(1);
  });

  it("approval policy: pause and activate are staged toggles with distinct audits", async () => {
    const tenant = await seedTenant();
    const [policy] = await db
      .insert(schema.approvalPolicies)
      .values({
        tenantId: tenant!.id,
        name: "Togglable policy",
        rules: [{ minAmountMinor: null, maxAmountMinor: null, mode: "ANY", requiredRoles: ["APPROVER"], minApprovers: 1, order: 0 }],
        version: 1,
        active: true,
      })
      .returning();

    const pause = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "approval_policy",
      op: "update",
      targetId: policy!.id,
      payload: { active: false, comment: "Pausing onboarding" },
    });
    const paused = await decidePlatformConfigChange(db, {
      requestId: pause.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
    });
    expect(paused.applied).toBe(true);
    const [pRow] = await db.select().from(schema.approvalPolicies).where(eq(schema.approvalPolicies.id, policy!.id)).limit(1);
    expect(pRow?.active).toBe(false);
    expect(pRow?.version).toBe(1); // pause is not a versioned change

    const activate = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "approval_policy",
      op: "update",
      targetId: policy!.id,
      payload: { active: true },
    });
    const activated = await decidePlatformConfigChange(db, {
      requestId: activate.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
    });
    expect(activated.applied).toBe(true);
    const [aRow] = await db.select().from(schema.approvalPolicies).where(eq(schema.approvalPolicies.id, policy!.id)).limit(1);
    expect(aRow?.active).toBe(true);

    const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.resourceType, "approval_policy"));
    expect(audits.map((a) => a.action).sort()).toEqual(["approval.policy.activate", "approval.policy.pause"]);
  });

  it("feature flag: staged toggle applies on approval; only updates are supported", async () => {
    const [flag] = await db
      .insert(schema.featureFlags)
      .values({ key: "instant-settlement", enabled: false, tenantId: null, percentage: 100 })
      .returning();

    const staged = await createPlatformConfigChange(db, {
      actorId: MAKER,
      kind: "feature_flag",
      op: "update",
      targetId: flag!.id,
      payload: { enabled: true },
    });
    const outcome = await decidePlatformConfigChange(db, {
      requestId: staged.requestId,
      actorId: CHECKER,
      actorRoles: ["SUPER_ADMIN"],
      decision: "APPROVE",
    });
    expect(outcome.applied).toBe(true);
    const [after] = await db.select().from(schema.featureFlags).where(eq(schema.featureFlags.id, flag!.id)).limit(1);
    expect(after?.enabled).toBe(true);
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "feature_flag.updated"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(CHECKER);

    await expect(
      createPlatformConfigChange(db, {
        actorId: MAKER,
        kind: "feature_flag",
        op: "create",
        payload: { key: "x", enabled: true },
      }),
    ).rejects.toThrow(/create is not supported for feature flag changes/);
  });

  it("validation: policies need a real tenant; fee/policy deletes and bad payloads are refused", async () => {
    await expect(
      createPlatformConfigChange(db, {
        actorId: MAKER,
        kind: "approval_policy",
        op: "create",
        payload: { tenantId: randomUUID(), name: "Ghost tenant policy", rules: [] },
      }),
    ).rejects.toThrow(/Tenant not found/);

    await expect(
      createPlatformConfigChange(db, {
        actorId: MAKER,
        kind: "fee_rule",
        op: "delete",
        targetId: randomUUID(),
        payload: {},
      }),
    ).rejects.toThrow(/delete is not supported for fee rule changes/);

    await expect(
      createPlatformConfigChange(db, {
        actorId: MAKER,
        kind: "approval_policy",
        op: "delete",
        targetId: randomUUID(),
        payload: {},
      }),
    ).rejects.toThrow(/delete is not supported for approval policy changes/);

    await expect(
      createPlatformConfigChange(db, {
        actorId: MAKER,
        kind: "fee_rule",
        op: "create",
        payload: { channel: "mpesa", flatFeeMinor: "100" },
      }),
    ).rejects.toThrow(/Product is required/);

    await expect(
      createPlatformConfigChange(db, {
        actorId: MAKER,
        kind: "approval_policy",
        op: "create",
        payload: { tenantId: randomUUID(), name: "", rules: [] },
      }),
    ).rejects.toThrow(/Policy name is required/);
  });
});
