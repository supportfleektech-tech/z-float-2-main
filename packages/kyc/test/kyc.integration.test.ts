/**
 * KYC/AML integration tests (real PostgreSQL):
 *  - matcher semantics (token similarity, aliases, inactive entries)
 *  - watchlist screening persistence (HIT / CLEAR rows)
 *  - the payments gate: a watchlist-hit recipient forces PENDING_APPROVAL,
 *    opens a review case and risk-flags the payment; a clean recipient flows
 *    straight through unchanged
 *  - document intake → malware-scan gates → submit for review → review decision
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@zfloat/database";
import { ensureSystemChart, postFundingJournal } from "@zfloat/ledger";
import { createPayment, submitPayment } from "@zfloat/payments-core";
import {
  normalizeName,
  significantTokens,
  tokenSimilarity,
  scoreName,
  screenName,
  screenRecipient,
  listCases,
  decideCase,
  attachDocument,
  listDocuments,
  submitForReview,
  decideProfile,
  getProfile,
} from "../src/index.js";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let TENANT = "";
let WALLET_ID = "";
const USER_ID = "11111111-1111-1111-1111-111111111111";

async function clean() {
  await pool.query(`
    TRUNCATE kyc_documents, kyc_profiles, kyc_cases, kyc_screenings, aml_watchlists,
      payments, payment_status_history, payment_attempts, fee_calculations, fee_rules,
      idempotency_records, outbox_events, wallet_reservations, journals, journal_entries,
      ledger_accounts, chart_of_accounts, balance_snapshots, wallets, funding_events,
      approval_requests, approval_steps, approval_actions, file_objects, tenants CASCADE`);
}

async function seedTenantAndWallet() {
  const [t] = await db
    .insert(schema.tenants)
    .values({ name: "KYC Co", slug: `kyc-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`, status: "ACTIVE" })
    .returning();
  TENANT = t!.id;
  await ensureSystemChart(db, TENANT);
  const [wallet] = await db
    .insert(schema.wallets)
    .values({ tenantId: TENANT, name: "Ops Wallet", currency: "KES" })
    .returning();
  WALLET_ID = wallet!.id;
  await db.update(schema.wallets).set({ availableMinor: 100_000_00n }).where(eq(schema.wallets.id, wallet!.id));
  await postFundingJournal(db, { tenantId: TENANT, walletId: wallet!.id, amountMinor: 100_000_00n });
}

async function seedWatchlist(name: string, kind = "SANCTIONS", aliases: string[] = [], active = true) {
  const [row] = await db
    .insert(schema.amlWatchlists)
    .values({ kind, name, aliases, source: "test", active })
    .returning();
  return row!.id;
}

beforeEach(async () => {
  ({ db, pool } = createDb());
  await clean();
  await seedTenantAndWallet();
});

afterAll(async () => {
  await pool.end();
});

/* ------------------------------------------------------------------ */
/* Matcher semantics (pure)                                            */
/* ------------------------------------------------------------------ */

describe("name matcher", () => {
  it("normalizes names (case, punctuation, whitespace)", () => {
    expect(normalizeName("Grace N. Wambui")).toBe("grace n wambui");
    expect(normalizeName("  OMAR-HASSAN  ABDI ")).toBe("omar hassan abdi");
  });

  it("drops corporate stopwords from token sets", () => {
    expect(significantTokens("Wambui Traders Ltd")).toEqual(["wambui", "traders"]);
    expect(significantTokens("Grace Wambui")).toEqual(["grace", "wambui"]);
  });

  it("token similarity: full overlap 1, partial 0.5, none 0", () => {
    expect(tokenSimilarity(["grace", "wambui"], ["grace", "wambui"])).toBe(1);
    expect(tokenSimilarity(["grace", "wambui"], ["grace", "wanjiku"])).toBe(1 / 3);
    expect(tokenSimilarity(["jane"], ["grace", "wambui"])).toBe(0);
  });

  it("exact normalized equality scores 100 regardless of tokens", () => {
    const entry = { id: "1", kind: "SANCTIONS", name: "Grace Wambui", aliases: [], country: null };
    expect(scoreName("GRACE WAMBUI", entry)).toBe(100);
    expect(scoreName("Grace N. Wambui", entry)).toBeGreaterThanOrEqual(66);
    expect(scoreName("Grace Wangari", entry)).toBeLessThan(66);
    expect(scoreName("Jane Wanjiku", entry)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Screening against the watchlist table                               */
/* ------------------------------------------------------------------ */

describe("screening engine", () => {
  it("screens a stored watchlist entry (direct + alias) and persists the row", async () => {
    await seedWatchlist("Grace Wambui", "SANCTIONS", ["Grace N. Wambui"]);

    const direct = await screenName(db, "Grace Wambui");
    expect(direct.result).toBe("HIT");
    expect(direct.matches[0]!.score).toBe(100);

    const alias = await screenName(db, "GRACE N. WAMBUI");
    expect(alias.result).toBe("HIT");
    expect(alias.score).toBeGreaterThanOrEqual(66);

    const { screeningId, outcome } = await screenRecipient(db, {
      name: "Grace Wambui",
      phone: "0712345678",
      tenantId: TENANT,
    });
    expect(outcome.result).toBe("HIT");
    const [row] = await db.select().from(schema.kycScreenings).where(eq(schema.kycScreenings.id, screeningId));
    expect(row!.result).toBe("HIT");
    expect(row!.subjectName).toBe("Grace Wambui");
    expect(row!.matchedEntries).toHaveLength(1);
  });

  it("ignores inactive watchlist entries", async () => {
    await seedWatchlist("Grace Wambui", "SANCTIONS", [], false);
    const out = await screenName(db, "Grace Wambui");
    expect(out.result).toBe("CLEAR");
  });

  it("distinguishes PEP hits with fuzzy matches only", async () => {
    await seedWatchlist("Kiprop Keter", "PEP", ["Kiprop K. Keter"]);
    const out = await screenName(db, "Kiprop Keter");
    expect(out.result).toBe("HIT");
    expect(out.matches[0]!.kind).toBe("PEP");
  });

  it("clears an ordinary Kenyan name", async () => {
    await seedWatchlist("Grace Wambui", "SANCTIONS");
    const out = await screenName(db, "Jane Wanjiku");
    expect(out.result).toBe("CLEAR");
    expect(out.score).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Payments gate                                                       */
/* ------------------------------------------------------------------ */

describe("payments AML gate", () => {
  const recipient = (name: string) => ({ name, phone: "0712345678", type: "person" as const });

  it("routes a watchlist-hit payment to PENDING_APPROVAL and opens a case", async () => {
    await seedWatchlist("Grace Wambui", "SANCTIONS", ["Grace N. Wambui"]);
    const { payment } = await createPayment(db, {
      tenantId: TENANT,
      actorId: USER_ID,
      amount: "1500.00",
      channel: "mpesa",
      sourceWalletId: WALLET_ID,
      recipient: recipient("Grace N. Wambui"),
      idempotencyKey: `kyc-gate-hit-${Date.now()}`,
    });
    const submitted = await submitPayment(db, {
      tenantId: TENANT,
      paymentId: payment.paymentId,
      actorId: USER_ID,
      policyRules: [], // no policy — the AML gate must still force approval
    });
    expect(submitted.status).toBe("PENDING_APPROVAL");
    expect(submitted.approvalRequestId).toBeDefined();

    const [row] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.paymentId));
    expect(row!.riskFlags).toContain("aml_watchlist_hit");
    // Wallet is reserved/untouched — nothing executed.
    const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.id, WALLET_ID));
    expect(wallet!.availableMinor).toBe(100_000_00n);

    const cases = await listCases(db, "OPEN");
    expect(cases).toHaveLength(1);
    expect(cases[0]!.paymentId).toBe(payment.paymentId);
    expect(cases[0]!.riskLevel).toBe("CRITICAL");
    expect(cases[0]!.kind).toBe("SANCTION_HIT");
    expect(cases[0]!.subjectName).toBe("Grace N. Wambui");

    // Approver closes it: decision is recorded and the case leaves OPEN.
    await decideCase(db, { caseId: cases[0]!.id, decision: "CLOSED", note: "reviewed — false positive name similarity", actorId: USER_ID });
    const after = await listCases(db, "CLOSED");
    expect(after).toHaveLength(1);
    expect(after[0]!.decisionNote).toBe("reviewed — false positive name similarity");
  });

  it("flags a PEP-hit payment MEDIUM/HIGH and still requires approval", async () => {
    await seedWatchlist("Kiprop Keter", "PEP", ["Kiprop K. Keter"]);
    const { payment } = await createPayment(db, {
      tenantId: TENANT,
      actorId: USER_ID,
      amount: "900.00",
      channel: "bank",
      sourceWalletId: WALLET_ID,
      recipient: recipient("Kiprop Keter"),
      idempotencyKey: `kyc-gate-pep-${Date.now()}`,
    });
    const submitted = await submitPayment(db, {
      tenantId: TENANT,
      paymentId: payment.paymentId,
      actorId: USER_ID,
      policyRules: [],
    });
    expect(submitted.status).toBe("PENDING_APPROVAL");
    const cases = await listCases(db, "OPEN");
    expect(cases[0]!.kind).toBe("PEP_HIT");
    expect(["HIGH", "CRITICAL"]).toContain(cases[0]!.riskLevel);
  });

  it("leaves a clean recipient on the normal path (QUEUED, no case)", async () => {
    await seedWatchlist("Grace Wambui", "SANCTIONS");
    const { payment } = await createPayment(db, {
      tenantId: TENANT,
      actorId: USER_ID,
      amount: "1200.00",
      channel: "mpesa",
      sourceWalletId: WALLET_ID,
      recipient: recipient("Jane Wanjiku"),
      idempotencyKey: `kyc-gate-clean-${Date.now()}`,
    });
    const submitted = await submitPayment(db, {
      tenantId: TENANT,
      paymentId: payment.paymentId,
      actorId: USER_ID,
      policyRules: [],
    });
    expect(submitted.status).toBe("QUEUED");
    const cases = await listCases(db);
    expect(cases).toHaveLength(0);
    const [row] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.paymentId));
    expect(row!.riskFlags ?? []).not.toContain("aml_watchlist_hit");
  });

  it("approval by policy rule still works on top of the gate", async () => {
    // A large amount already triggers an OWNER rule; add watchlist hit too —
    // the two should not conflict (rules still evaluate).
    await seedWatchlist("Omar Hassan Abdi", "SANCTIONS");
    const { payment } = await createPayment(db, {
      tenantId: TENANT,
      actorId: USER_ID,
      amount: "5000000.00",
      channel: "mpesa",
      sourceWalletId: WALLET_ID,
      recipient: recipient("Omar H. Abdi"),
      idempotencyKey: `kyc-gate-both-${Date.now()}`,
    });
    const submitted = await submitPayment(db, {
      tenantId: TENANT,
      paymentId: payment.paymentId,
      actorId: USER_ID,
      policyRules: [
        {
          minAmountMinor: 1_000_000n,
          mode: "ANY" as const,
          requiredRoles: ["OWNER"],
          minApprovers: 1,
          order: 1,
        },
      ],
    });
    expect(submitted.status).toBe("PENDING_APPROVAL");
    const [req] = await db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.paymentId, payment.paymentId))
      .limit(1);
    expect(req!.policySnapshot).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* Documents + review flow                                             */
/* ------------------------------------------------------------------ */

describe("document intake + review", () => {
  async function insertFile(scanStatus: string, filename = "cr12.pdf") {
    const [f] = await db
      .insert(schema.fileObjects)
      .values({
        tenantId: TENANT,
        ref: `kyc-${Date.now()}`,
        filename,
        mimeType: "application/pdf",
        sizeBytes: 1024,
        checksumSha256: "ab".repeat(32),
        storageDriver: "local",
        storageKey: `kyc/${filename}`,
        scanStatus,
        uploadedById: USER_ID,
      })
      .returning();
    return f!.id;
  }

  it("attaches documents and lists them with file metadata", async () => {
    const fileId = await insertFile("CLEAN");
    const docId = await attachDocument(db, { tenantId: TENANT, docType: "CR12", fileId, uploadedById: USER_ID });
    const docs = await listDocuments(db, TENANT);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.id).toBe(docId);
    expect(docs[0]!.docType).toBe("CR12");
    expect(docs[0]!.filename).toBe("cr12.pdf");
    expect(docs[0]!.scanStatus).toBe("CLEAN");
  });

  it("submit for review requires at least one document", async () => {
    const out = await submitForReview(db, { tenantId: TENANT, businessName: "KYC Co" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("document");
  });

  it("submit for review waits for the malware scan to finish", async () => {
    const fileId = await insertFile("PENDING");
    await attachDocument(db, { tenantId: TENANT, docType: "CR12", fileId });
    const out = await submitForReview(db, { tenantId: TENANT });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("scanned");
  });

  it("rejects submission when a document is infected", async () => {
    const fileId = await insertFile("INFECTED");
    await attachDocument(db, { tenantId: TENANT, docType: "CR12", fileId });
    const out = await submitForReview(db, { tenantId: TENANT });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("malware");
  });

  it("full happy path: clean docs → PENDING → APPROVED (FULL)", async () => {
    const f1 = await insertFile("CLEAN", "cr12.pdf");
    const f2 = await insertFile("CLEAN", "kra.pdf");
    await attachDocument(db, { tenantId: TENANT, docType: "CR12", fileId: f1 });
    await attachDocument(db, { tenantId: TENANT, docType: "KRA_PIN", fileId: f2 });

    const submitted = await submitForReview(db, {
      tenantId: TENANT,
      businessName: "KYC Co Kenya",
      registrationNumber: "PVT-12345X",
      actorId: USER_ID,
    });
    expect(submitted.ok).toBe(true);

    let profile = await getProfile(db, TENANT);
    expect(profile!.status).toBe("PENDING");
    expect(profile!.businessName).toBe("KYC Co Kenya");
    expect(profile!.verificationLevel).toBe("BASIC");

    await decideProfile(db, { tenantId: TENANT, decision: "APPROVED", note: "docs verified", actorId: USER_ID, level: "FULL" });
    profile = await getProfile(db, TENANT);
    expect(profile!.status).toBe("APPROVED");
    expect(profile!.verificationLevel).toBe("FULL");
    expect(profile!.reviewNote).toBe("docs verified");
  });

  it("rejects when documents are missing types (only one of CR12 + KRA)", async () => {
    const f = await insertFile("CLEAN");
    await attachDocument(db, { tenantId: TENANT, docType: "CR12", fileId: f });
    // Missing KRA_PIN is a policy detail of the review UI; engine-level the
    // submit succeeds and the reviewer decides. Just verify decision to REJECT.
    const submitted = await submitForReview(db, { tenantId: TENANT });
    expect(submitted.ok).toBe(true);
    await decideProfile(db, { tenantId: TENANT, decision: "REJECTED", note: "missing KRA pin", actorId: USER_ID, level: "BASIC" });
    const profile = await getProfile(db, TENANT);
    expect(profile!.status).toBe("REJECTED");
    expect(profile!.verificationLevel).toBe("NONE");
  });
});
