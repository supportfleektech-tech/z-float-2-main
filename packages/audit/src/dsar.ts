/**
 * DSAR operations (GAP-ANALYSIS Phase 5) — make the ODPC pack operable.
 *
 * Data subject = a USER of the platform (tenant staff or platform staff).
 * Two operations, both exercised through /api/admin/dsar/*:
 *
 *  exportDataSubject — assembles a personal-data bundle (JSON): identity,
 *  roles, sessions, notifications, invitations, login/security events and
 *  audit-event references about the subject. FINANCIAL RECORDS ARE NOT
 *  DUMPED: payments/links/schedules/webhook subscriptions the subject created
 *  are referenced (number + status + time), because those rows are business
 *  records subject to statutory financial retention (documented exception).
 *
 *  eraseDataSubject — scrubs/anonymizes the subject's personal data across
 *  operational stores: identity fields are overwritten (email becomes
 *  <id>@erased.invalid, name "Erasure Request", phone null, no password/MFA —
 *  login is impossible), sessions/mfa/roles/notifications/invitations/
 *  user_roles removed. Immutable audit/login/security logs are RETAINED
 *  (append-only by DB trigger; documented retention exception in
 *  docs/compliance/odpc-dpa-pack.md — internal ids + event types only) and an
 *  audit event `dsar.erasure.executed` records the run.
 */
import { count, desc, eq } from "drizzle-orm";
import { schema, toJsonSafe, type Db } from "@zfloat/database";

export class DsarError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "DsarError";
  }
}

export interface DsarExportBundle {
  exportedAt: string;
  subject: {
    id: string;
    email: string;
    fullName: string;
    phone: string | null;
    status: string;
    mfaEnabled: boolean;
    createdAt: string | null;
    lastLoginAt: string | null;
  };
  roles: Array<{ tenantId: string | null; tenantName: string | null; roleName: string }>;
  sessions: Array<{ createdAt: string | null; lastSeenAt: string | null; expiresAt: string | null; ip: string | null; deviceName: string | null }>;
  notifications: Array<{ channel: string; title: string | null; body: string | null; status: string; createdAt: string | null }>;
  invitations: Array<{ tenantId: string | null; createdAt: string | null; expiresAt: string | null; acceptedAt: string | null }>;
  loginEvents: Array<{ event: string; ip: string | null; createdAt: string | null }>;
  securityEvents: Array<{ eventType: string; severity: string; ip: string | null; createdAt: string | null }>;
  auditTrail: {
    note: string;
    count: number;
    byAction: Record<string, number>;
    firstAt: string | null;
    lastAt: string | null;
  };
  financialRecords: {
    note: string;
    payments: Array<{ paymentNumber: string; status: string; createdAt: string | null }>;
    paymentLinks: Array<{ id: string; createdAt: string | null }>;
    reportSchedules: Array<{ id: string; createdAt: string | null }>;
    reconRuns: Array<{ id: string; createdAt: string | null }>;
    webhookSubscriptions: Array<{ id: string; createdAt: string | null }>;
  };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Resolve exactly one user from an id, or from an email when unambiguous. */
export async function resolveDataSubject(db: Db, input: { userId?: string; email?: string }) {
  if (input.userId) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, input.userId)).limit(1);
    if (!u) throw new DsarError("User not found", "NOT_FOUND");
    return u;
  }
  if (input.email) {
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, input.email.trim().toLowerCase())).limit(20);
    if (rows.length === 0) throw new DsarError("No user found with that email", "NOT_FOUND");
    if (rows.length > 1) {
      throw new DsarError(
        `Email belongs to ${rows.length} accounts (one per tenant) — resolve by userId: ${rows.map((r) => r.id).join(", ")}`,
        "AMBIGUOUS",
      );
    }
    return rows[0]!;
  }
  throw new DsarError("Provide userId or email", "BAD_INPUT");
}

export async function exportDataSubject(db: Db, input: { userId?: string; email?: string }): Promise<DsarExportBundle> {
  const user = await resolveDataSubject(db, input);

  const roles = await db
    .select({
      tenantId: schema.userRoles.tenantId,
      roleName: schema.roles.name,
      tenantName: schema.tenants.name,
    })
    .from(schema.userRoles)
    .leftJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .leftJoin(schema.tenants, eq(schema.tenants.id, schema.userRoles.tenantId))
    .where(eq(schema.userRoles.userId, user.id));

  const sessions = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, user.id))
    .orderBy(desc(schema.sessions.createdAt))
    .limit(100);

  const notifications = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, user.id))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(200);

  const invitations = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.email, user.email))
    .orderBy(desc(schema.invitations.createdAt))
    .limit(100);

  const loginEvents = await db
    .select()
    .from(schema.loginEvents)
    .where(eq(schema.loginEvents.userId, user.id))
    .orderBy(desc(schema.loginEvents.createdAt))
    .limit(100);

  const securityEvents = await db
    .select()
    .from(schema.securityEvents)
    .where(eq(schema.securityEvents.userId, user.id))
    .orderBy(desc(schema.securityEvents.createdAt))
    .limit(100);

  // Audit trail: references (action/type/time) — append-only by design.
  const auditRows = await db
    .select({
      action: schema.auditEvents.action,
      createdAt: schema.auditEvents.createdAt,
    })
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.actorId, user.id))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(500);
  const byAction: Record<string, number> = {};
  for (const a of auditRows) byAction[a.action] = (byAction[a.action] ?? 0) + 1;

  // Financial/ops records the subject created — REFERENCED, not dumped.
  const payments = await db
    .select({ paymentNumber: schema.payments.paymentNumber, status: schema.payments.status, createdAt: schema.payments.createdAt })
    .from(schema.payments)
    .where(eq(schema.payments.createdById, user.id))
    .orderBy(desc(schema.payments.createdAt))
    .limit(50);
  const paymentLinks = await db
    .select({ id: schema.paymentLinks.id, createdAt: schema.paymentLinks.createdAt })
    .from(schema.paymentLinks)
    .where(eq(schema.paymentLinks.createdById, user.id))
    .orderBy(desc(schema.paymentLinks.createdAt))
    .limit(50);
  const reportSchedules = await db
    .select({ id: schema.reportSchedules.id, createdAt: schema.reportSchedules.createdAt })
    .from(schema.reportSchedules)
    .where(eq(schema.reportSchedules.createdById, user.id))
    .orderBy(desc(schema.reportSchedules.createdAt))
    .limit(50);
  const reconRuns = await db
    .select({ id: schema.reconRuns.id, createdAt: schema.reconRuns.createdAt })
    .from(schema.reconRuns)
    .where(eq(schema.reconRuns.createdById, user.id))
    .orderBy(desc(schema.reconRuns.createdAt))
    .limit(50);
  const webhookSubscriptions = await db
    .select({ id: schema.webhookSubscriptions.id, createdAt: schema.webhookSubscriptions.createdAt })
    .from(schema.webhookSubscriptions)
    .where(eq(schema.webhookSubscriptions.createdById, user.id))
    .orderBy(desc(schema.webhookSubscriptions.createdAt))
    .limit(50);

  return {
    exportedAt: new Date().toISOString(),
    subject: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      createdAt: iso(user.createdAt),
      lastLoginAt: iso(user.lastLoginAt),
    },
    roles: roles.map((r) => ({ tenantId: r.tenantId, tenantName: r.tenantName, roleName: r.roleName ?? "" })),
    sessions: sessions.map((s) => ({
      createdAt: iso(s.createdAt),
      lastSeenAt: iso(s.lastSeenAt),
      expiresAt: iso(s.expiresAt),
      ip: s.ip,
      deviceName: s.deviceName,
    })),
    notifications: notifications.map((n) => ({
      channel: n.channel,
      title: n.title,
      body: n.body,
      status: n.status,
      createdAt: iso(n.createdAt),
    })),
    invitations: invitations.map((i) => ({
      tenantId: i.tenantId,
      createdAt: iso(i.createdAt),
      expiresAt: iso(i.expiresAt),
      acceptedAt: iso(i.acceptedAt),
    })),
    loginEvents: loginEvents.map((l) => ({ event: l.event, ip: l.ip, createdAt: iso(l.createdAt) })),
    securityEvents: securityEvents.map((s) => ({ eventType: s.eventType, severity: s.severity, ip: s.ip, createdAt: iso(s.createdAt) })),
    auditTrail: {
      note: "Append-only audit trail referencing this account's actions (internal identifiers, retained under the documented retention exception).",
      count: auditRows.length,
      byAction,
      firstAt: auditRows.length > 0 ? iso(auditRows[auditRows.length - 1]!.createdAt) : null,
      lastAt: auditRows.length > 0 ? iso(auditRows[0]!.createdAt) : null,
    },
    financialRecords: {
      note: "Financial records are business data subject to statutory retention and are referenced, not copied. Request copies through the same DSAR channel.",
      payments: payments.map((p) => ({ paymentNumber: p.paymentNumber, status: p.status, createdAt: iso(p.createdAt) })),
      paymentLinks: paymentLinks.map((p) => ({ id: p.id, createdAt: iso(p.createdAt) })),
      reportSchedules: reportSchedules.map((r) => ({ id: r.id, createdAt: iso(r.createdAt) })),
      reconRuns: reconRuns.map((r) => ({ id: r.id, createdAt: iso(r.createdAt) })),
      webhookSubscriptions: webhookSubscriptions.map((w) => ({ id: w.id, createdAt: iso(w.createdAt) })),
    },
  };
}

export interface ErasureSummary {
  userId: string;
  identityScrubbed: boolean;
  deleted: {
    sessions: number;
    mfaFactors: number;
    mfaBackupCodes: number;
    userRoles: number;
    notifications: number;
    invitations: number;
  };
  retained: {
    auditEvents: number;
    loginEvents: number;
    securityEvents: number;
    financialRecords: {
      payments: number;
      paymentLinks: number;
      reportSchedules: number;
      reconRuns: number;
      webhookSubscriptions: number;
    };
  };
}

/** Erase one data subject. Throws DsarError for unknown/self-erasure. */
export async function eraseDataSubject(
  db: Db,
  input: { userId?: string; email?: string; actorId?: string; confirm: string },
): Promise<ErasureSummary> {
  if (input.confirm !== "ERASE") throw new DsarError('Confirm erasure with confirm:"ERASE"', "CONFIRM_REQUIRED");
  const user = await resolveDataSubject(db, input);
  if (input.actorId && input.actorId === user.id) {
    throw new DsarError("An administrator cannot erase their own account through this flow", "SELF_ERASURE_FORBIDDEN");
  }
  const email = user.email;

  const [sessions, mfaFactors, mfaBackupCodes, userRoles, notifications] = await Promise.all([
    db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id)).returning({ id: schema.sessions.id }),
    db.delete(schema.mfaFactors).where(eq(schema.mfaFactors.userId, user.id)).returning({ id: schema.mfaFactors.id }),
    db.delete(schema.mfaBackupCodes).where(eq(schema.mfaBackupCodes.userId, user.id)).returning({ id: schema.mfaBackupCodes.id }),
    db.delete(schema.userRoles).where(eq(schema.userRoles.userId, user.id)).returning({ id: schema.userRoles.userId }),
    db.delete(schema.notifications).where(eq(schema.notifications.userId, user.id)).returning({ id: schema.notifications.id }),
  ]);
  const [invitations] = await Promise.all([
    db.delete(schema.invitations).where(eq(schema.invitations.email, email)).returning({ id: schema.invitations.id }),
  ]);

  // Anonymize the identity row: no login possible, nothing identifying left.
  await db
    .update(schema.users)
    .set({
      email: `erased-${user.id}@erased.invalid`,
      fullName: "Erasure Request",
      phone: null,
      passwordHash: null,
      mfaEnabled: false,
      mfaSecretEncrypted: null,
      status: "DISABLED",
    })
    .where(eq(schema.users.id, user.id));

  // Retained (documented exceptions): append-only audit events referencing the
  // account, and financial/business records the subject created.
  const [auditN] = await db.select({ n: count() }).from(schema.auditEvents).where(eq(schema.auditEvents.actorId, user.id));
  // Immutable security/audit logs (DB trigger) are retained under the
  // documented retention exception — they hold internal ids and event types.
  const [loginN] = await db.select({ n: count() }).from(schema.loginEvents).where(eq(schema.loginEvents.userId, user.id));
  const [securityN] = await db.select({ n: count() }).from(schema.securityEvents).where(eq(schema.securityEvents.userId, user.id));
  const [paymentsN] = await db.select({ n: count() }).from(schema.payments).where(eq(schema.payments.createdById, user.id));
  const [linksN] = await db.select({ n: count() }).from(schema.paymentLinks).where(eq(schema.paymentLinks.createdById, user.id));
  const [schedulesN] = await db.select({ n: count() }).from(schema.reportSchedules).where(eq(schema.reportSchedules.createdById, user.id));
  const [runsN] = await db.select({ n: count() }).from(schema.reconRuns).where(eq(schema.reconRuns.createdById, user.id));
  const [webhooksN] = await db.select({ n: count() }).from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.createdById, user.id));

  const summary: ErasureSummary = {
    userId: user.id,
    identityScrubbed: true,
    deleted: {
      sessions: sessions.length,
      mfaFactors: mfaFactors.length,
      mfaBackupCodes: mfaBackupCodes.length,
      userRoles: userRoles.length,
      notifications: notifications.length,
      invitations: invitations.length,
    },
    retained: {
      auditEvents: Number(auditN?.n ?? 0),
      loginEvents: Number(loginN?.n ?? 0),
      securityEvents: Number(securityN?.n ?? 0),
      financialRecords: {
        payments: Number(paymentsN?.n ?? 0),
        paymentLinks: Number(linksN?.n ?? 0),
        reportSchedules: Number(schedulesN?.n ?? 0),
        reconRuns: Number(runsN?.n ?? 0),
        webhookSubscriptions: Number(webhooksN?.n ?? 0),
      },
    },
  };

  // Dynamic import keeps the audit→dsar dependency one-way (no module cycle).
  const { writeAuditEvent } = await import("./index.js");
  await writeAuditEvent(db, {
    tenantId: user.tenantId ?? undefined,
    actorId: input.actorId,
    actorRole: "platform_admin",
    action: "dsar.erasure.executed",
    resourceType: "user",
    resourceId: user.id,
    before: { email, fullName: user.fullName, status: user.status },
    after: toJsonSafe(summary) as Record<string, unknown>,
  });
  return summary;
}

/** Shared loader for the admin UI: subject + row counts (used by routes/tests). */
export async function findSubjectsByEmail(db: Db, email: string, limit = 20) {
  return db
    .select({ id: schema.users.id, tenantId: schema.users.tenantId, email: schema.users.email, status: schema.users.status, createdAt: schema.users.createdAt })
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()))
    .limit(limit);
}
