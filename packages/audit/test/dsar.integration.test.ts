/**
 * Phase 5 (GAP-ANALYSIS) — DSAR operations on real PostgreSQL: export builds
 * a personal-data bundle with financial records REFERENCED (never dumped);
 * erasure scrubs the identity row (no login, nothing identifying), deletes
 * sessions/MFA/roles/notifications/invitations/login+security events, keeps
 * append-only audit events and financial rows (documented exceptions) and
 * records `dsar.erasure.executed`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { count, eq } from "drizzle-orm";
import { createDb, schema } from "@zfloat/database";
import { exportDataSubject, eraseDataSubject } from "../src/dsar.js";
import { writeAuditEvent } from "../src/index.js";

let db: ReturnType<typeof createDb>["db"];
let pool: ReturnType<typeof createDb>["pool"];

const SUBJECT_EMAIL = "subject@dsar.test";

async function roleFor(slug: string, scope = "BUSINESS") {
  const [role] = await db
    .insert(schema.roles)
    .values({ scope, name: `DSAR_ROLE_${slug}`, isSystem: true })
    .onConflictDoNothing()
    .returning({ id: schema.roles.id });
  if (role) return role.id;
  const [existing] = await db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.name, `DSAR_ROLE_${slug}`)).limit(1);
  return existing!.id;
}

async function makeTenant(slug: string): Promise<{ tenantId: string; roleId: string }> {
  const tenantId = crypto.randomUUID();
  await db.insert(schema.tenants).values({ id: tenantId, name: `DSAR ${slug}`, slug: `dsar-${slug}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`, status: "ACTIVE" });
  return { tenantId, roleId: await roleFor(slug) };
}

async function makeUser(id: string, tenantId: string, email: string, fullName: string) {
  const [u] = await db
    .insert(schema.users)
    .values({
      id,
      tenantId,
      email,
      fullName,
      phone: "+254700000000",
      passwordHash: "x".repeat(64),
      status: "ACTIVE",
      mfaEnabled: true,
      mfaSecretEncrypted: "enc",
    })
    .returning();
  return u!;
}

/** Full personal + financial surface for the subject in tenant T1. */
async function fixture(): Promise<{ sid: string; tenantId: string; roleId: string }> {
  const { tenantId, roleId } = await makeTenant("one");
  const sid = crypto.randomUUID();
  await makeUser(sid, tenantId, SUBJECT_EMAIL, "Subject Person");
  await makeUser(crypto.randomUUID(), tenantId, "other@dsar.test", "Other Person");

  await db.insert(schema.userRoles).values({ userId: sid, roleId, tenantId });
  await db.insert(schema.sessions).values({ userId: sid, tenantId, tokenHash: `tok-${crypto.randomUUID()}`, ip: "127.0.0.9", deviceName: "E2E device", expiresAt: new Date(Date.now() + 86_400_000) });
  await db.insert(schema.mfaFactors).values({ userId: sid, type: "TOTP", secretEncrypted: "enc", enabled: true });
  await db.insert(schema.mfaBackupCodes).values({ userId: sid, codeHash: "hash" });
  await db.insert(schema.notifications).values({ userId: sid, tenantId, channel: "IN_APP", templateCode: "welcome", title: "Hi", body: "Welcome", status: "SENT", sentAt: new Date() });
  await db.insert(schema.invitations).values({ tenantId, email: SUBJECT_EMAIL, roleId, tokenHash: `inv-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) });
  await db.insert(schema.loginEvents).values({ tenantId, userId: sid, event: "login.success", ip: "127.0.0.9" });
  await db.insert(schema.securityEvents).values({ tenantId, userId: sid, eventType: "login.failed.rate", severity: "WARN", ip: "127.0.0.9" });
  await writeAuditEvent(db, { tenantId, actorId: sid, action: "payments.executed", resourceType: "payment", resourceId: "P-1", after: { ok: true } });
  await writeAuditEvent(db, { tenantId, actorId: sid, action: "session.revoked", resourceType: "session", resourceId: "S-1" });
  await writeAuditEvent(db, { tenantId, action: "tenants.updated", resourceType: "tenant", resourceId: tenantId });
  // financial rows the subject created (business records — retained)
  await db.insert(schema.payments).values({
    tenantId,
    paymentNumber: "ZF-DSAR-1",
    channel: "mpesa",
    amountMinor: 500_000n,
    totalMinor: 500_000n,
    beneficiarySnapshot: { name: "Payee" },
    createdById: sid,
    providerReference: "DSAR-TXN-1",
    status: "SUCCESS",
  });
  await db.insert(schema.reconRuns).values({ tenantId, periodStart: new Date("2026-08-01"), periodEnd: new Date("2026-08-31"), source: "WEBHOOK", status: "COMPLETED", createdById: sid });
  return { sid, tenantId, roleId };
}

beforeAll(async () => {
  ({ db, pool } = createDb());
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE users, user_roles, roles, sessions, mfa_factors, mfa_backup_codes, notifications, invitations,
            login_events, security_events, audit_events, payments, recon_runs, payment_links, report_schedules,
            webhook_subscriptions, tenants CASCADE`,
  );
});

describe("DSAR export", () => {
  it("builds a personal-data bundle with financial records referenced, not dumped", async () => {
    const { sid } = await fixture();
    const bundle = await exportDataSubject(db, { userId: sid });

    expect(bundle.subject.email).toBe(SUBJECT_EMAIL);
    expect(bundle.subject.fullName).toBe("Subject Person");
    expect(bundle.subject.phone).toBe("+254700000000");
    expect(bundle.roles.map((r) => r.roleName)).toContain("DSAR_ROLE_one");
    expect(bundle.sessions).toHaveLength(1);
    expect(bundle.sessions[0]!.ip).toBe("127.0.0.9");
    expect(bundle.notifications).toHaveLength(1);
    expect(bundle.invitations).toHaveLength(1);
    expect(bundle.loginEvents).toHaveLength(1);
    expect(bundle.securityEvents).toHaveLength(1);

    // audit trail: references only the subject's own actions (2 of 3 events)
    expect(bundle.auditTrail.count).toBe(2);
    expect(bundle.auditTrail.byAction).toMatchObject({ "payments.executed": 1, "session.revoked": 1 });

    // financial records referenced by number/status — never amounts or beneficiaries
    expect(bundle.financialRecords.payments).toHaveLength(1);
    expect(bundle.financialRecords.payments[0]).toMatchObject({ paymentNumber: "ZF-DSAR-1", status: "SUCCESS" });
    const raw = JSON.stringify(bundle);
    expect(raw).not.toContain("500000");
    expect(raw).not.toContain("Payee");
    expect(bundle.financialRecords.reconRuns).toHaveLength(1);
  });

  it("looks up by email and rejects ambiguity + unknown", async () => {
    const { sid } = await fixture();
    const [other] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "other@dsar.test")).limit(1);
    // same email in a second tenant → ambiguous
    const { tenantId: t2, roleId: r2 } = await makeTenant("two");
    const clone = crypto.randomUUID();
    await makeUser(clone, t2, "other@dsar.test", "Clone Person");
    await db.insert(schema.userRoles).values({ userId: clone, roleId: r2, tenantId: t2 });

    expect((await exportDataSubject(db, { userId: other!.id })).subject.email).toBe("other@dsar.test");
    await expect(exportDataSubject(db, { email: "other@dsar.test" })).rejects.toMatchObject({ code: "AMBIGUOUS" });
    await expect(exportDataSubject(db, { email: "nobody@dsar.test" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    void sid;
  });
});

describe("DSAR erasure", () => {
  it("requires confirm and forbids self-erasure", async () => {
    const { sid } = await fixture();
    await expect(eraseDataSubject(db, { userId: sid, confirm: "no" })).rejects.toMatchObject({ code: "CONFIRM_REQUIRED" });
    await expect(eraseDataSubject(db, { userId: sid, actorId: sid, confirm: "ERASE" })).rejects.toMatchObject({ code: "SELF_ERASURE_FORBIDDEN" });
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, sid));
    expect(u!.email).toBe(SUBJECT_EMAIL);
  });

  it("scrubs identity + deletes personal rows, retains audit + financial records", async () => {
    const { sid } = await fixture();
    const summary = await eraseDataSubject(db, { userId: sid, actorId: crypto.randomUUID(), confirm: "ERASE" });

    expect(summary.identityScrubbed).toBe(true);
    expect(summary.deleted).toMatchObject({
      sessions: 1,
      mfaFactors: 1,
      mfaBackupCodes: 1,
      userRoles: 1,
      notifications: 1,
      invitations: 1,
    });
    // Immutable security/audit logs are retained under the documented exception
    expect(summary.retained.loginEvents).toBe(1);
    expect(summary.retained.securityEvents).toBe(1);

    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, sid));
    expect(u!.email).toBe(`erased-${sid}@erased.invalid`);
    expect(u!.fullName).toBe("Erasure Request");
    expect(u!.phone).toBeNull();
    expect(u!.passwordHash).toBeNull();
    expect(u!.status).toBe("DISABLED");
    expect(u!.mfaEnabled).toBe(false);

    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, sid))).toHaveLength(0);
    expect(await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, sid))).toHaveLength(0);
    expect(await db.select().from(schema.notifications).where(eq(schema.notifications.userId, sid))).toHaveLength(0);
    expect(await db.select().from(schema.invitations).where(eq(schema.invitations.email, SUBJECT_EMAIL))).toHaveLength(0);

    // financial rows survive with the internal actor reference (documented exception)
    const [p] = await db.select().from(schema.payments).where(eq(schema.payments.paymentNumber, "ZF-DSAR-1"));
    expect(p!.createdById).toBe(sid);

    // audit: original events retained + the erasure event itself recorded
    const [n] = await db.select({ n: count() }).from(schema.auditEvents).where(eq(schema.auditEvents.action, "dsar.erasure.executed"));
    expect(Number(n!.n)).toBe(1);
    const [erasure] = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.action, "dsar.erasure.executed")).limit(1);
    expect(erasure!.resourceId).toBe(sid);
    expect(Number(summary.retained.auditEvents)).toBe(2);

    // the old email can no longer resolve to the subject
    await expect(exportDataSubject(db, { email: SUBJECT_EMAIL })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
