/**
 * KYC / AML engine — name screening, document intake, and case management.
 *
 * The screening algorithm runs against the aml_watchlists table (deterministic
 * token/alias matching with a similarity score). In production the list is
 * replaced by a licensed provider feed; the seam is the table, not the code.
 *
 * The gate (screenRecipientForPayment) is called by payments-core during
 * submitPayment: a watchlist hit marks the payment risk-flagged and forces the
 * approval path — it never silently blocks execution state changes.
 */
import { desc, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";

export type WatchlistKind = "SANCTIONS" | "PEP" | "ADVERSE";
export type ScreeningResult = "CLEAR" | "HIT";
export type CaseKind = "SANCTION_HIT" | "PEP_HIT" | "ADVERSE_HIT" | "DOC_REVIEW";
export type CaseStatus = "OPEN" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "CLOSED";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface WatchlistEntry {
  id: string;
  kind: string;
  name: string;
  aliases: string[];
  country: string | null;
}

export interface ScreeningMatch {
  entryId: string;
  kind: WatchlistKind;
  matchedName: string;
  score: number;
}

export interface ScreeningOutcome {
  result: ScreeningResult;
  score: number;
  matches: ScreeningMatch[];
}

/* ------------------------------------------------------------------ */
/* Name normalization + matching                                       */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "ltd", "limited", "co", "company", "corp", "corporation", "trading", "holdings",
  "holding", "group", "and", "the", "of", "for", "inc", "international", "enterprises",
  "investments", "general", "suppliers", "stores",
]);

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function significantTokens(name: string): string[] {
  return normalizeName(name)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Jaccard similarity of significant token sets. */
export function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  return inter / new Set([...setA, ...setB]).size;
}

/** Score a name against one watchlist entry (name + aliases). 0 = no match. */
export function scoreName(name: string, entry: WatchlistEntry): number {
  const target = significantTokens(name);
  const candidates = [entry.name, ...(entry.aliases ?? [])];
  let best = 0;
  for (const cand of candidates) {
    const candTokens = significantTokens(cand);
    if (candTokens.length === 0) continue;
    const sim = tokenSimilarity(target, candTokens);
    // Full normalized equality is a certain hit; otherwise require a high
    // overlap (≥ 0.66) so "Grace Wambui" ~ "Grace N. Wambui" match while
    // common single tokens alone never fire.
    if (normalizeName(cand) === normalizeName(name)) return 100;
    if (sim >= 0.66) best = Math.max(best, Math.round(sim * 100));
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Screening against the stored watchlist                              */
/* ------------------------------------------------------------------ */

export async function screenName(db: Db, name: string): Promise<ScreeningOutcome> {
  const entries = await db
    .select()
    .from(schema.amlWatchlists)
    .where(eq(schema.amlWatchlists.active, true));
  const matches: ScreeningMatch[] = [];
  for (const entry of entries) {
    const score = scoreName(name, {
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      aliases: (entry.aliases ?? []) as string[],
      country: entry.country,
    });
    if (score >= 66) {
      matches.push({
        entryId: entry.id,
        kind: entry.kind as WatchlistKind,
        matchedName: entry.name,
        score,
      });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return { result: matches.length > 0 ? "HIT" : "CLEAR", score: matches[0]?.score ?? 0, matches };
}

export async function screenRecipient(
  db: Db,
  input: { name: string; phone?: string; paymentId?: string; tenantId?: string; actorId?: string },
): Promise<{ screeningId: string; outcome: ScreeningOutcome }> {
  const outcome = await screenName(db, input.name);
  const [row] = await db
    .insert(schema.kycScreenings)
    .values({
      tenantId: input.tenantId,
      subjectType: "BENEFICIARY",
      subjectName: input.name,
      subjectRef: input.phone,
      result: outcome.result,
      score: outcome.score,
      matchedEntries: outcome.matches.map((m) => ({ id: m.entryId, kind: m.kind, name: m.matchedName, score: m.score })),
      paymentId: input.paymentId,
      createdById: input.actorId,
    })
    .returning();
  return { screeningId: row!.id, outcome };
}

/** Record + persist a screening and open a review case when it hits. */
export async function openCaseForHit(
  db: Db,
  input: { tenantId?: string; screeningId: string; paymentId?: string; name: string; kind: WatchlistKind; riskLevel: RiskLevel },
): Promise<string> {
  const kind: CaseKind = input.kind === "PEP" ? "PEP_HIT" : input.kind === "ADVERSE" ? "ADVERSE_HIT" : "SANCTION_HIT";
  const [row] = await db
    .insert(schema.kycCases)
    .values({
      tenantId: input.tenantId,
      screeningId: input.screeningId,
      paymentId: input.paymentId,
      kind,
      status: "OPEN",
      riskLevel: input.riskLevel,
      note: `Watchlist match on "${input.name}" (${input.kind}).`,
    })
    .returning();
  return row!.id;
}

/**
 * The payment gate: screen a recipient; when it hits, open a case and return
 * the risk flags to attach. Returns { hit, flags, caseId, screeningId }.
 */
export async function screenRecipientForPayment(
  db: Db,
  input: { tenantId: string; paymentId: string; name: string; phone?: string; actorId?: string },
): Promise<{ hit: boolean; caseId?: string; screeningId: string; matchedNames: string[] }> {
  const { screeningId, outcome } = await screenRecipient(db, {
    tenantId: input.tenantId,
    name: input.name,
    phone: input.phone,
    paymentId: input.paymentId,
    actorId: input.actorId,
  });
  if (outcome.result !== "HIT" || outcome.matches.length === 0) {
    return { hit: false, screeningId, matchedNames: [] };
  }
  const worst = outcome.matches.reduce<RiskLevel>((acc, m) => {
    if (m.kind === "SANCTIONS") return acc === "CRITICAL" ? acc : "CRITICAL";
    if (m.kind === "PEP") return acc === "HIGH" || acc === "CRITICAL" ? acc : "HIGH";
    return acc === "MEDIUM" ? acc : "MEDIUM";
  }, "MEDIUM");
  const caseId = await openCaseForHit(db, {
    tenantId: input.tenantId,
    screeningId,
    paymentId: input.paymentId,
    name: input.name,
    kind: outcome.matches[0]!.kind,
    riskLevel: worst,
  });
  return {
    hit: true,
    caseId,
    screeningId,
    matchedNames: outcome.matches.map((m) => m.matchedName),
  };
}

/* ------------------------------------------------------------------ */
/* Case management (admin)                                             */
/* ------------------------------------------------------------------ */

export interface CaseRow {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  kind: string;
  status: string;
  riskLevel: string;
  note: string | null;
  paymentId: string | null;
  subjectName: string | null;
  subjectRef: string | null;
  score: number | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export async function listCases(db: Db, status?: string, limit = 100): Promise<CaseRow[]> {
  const rows = await db
    .select({
      id: schema.kycCases.id,
      tenantId: schema.kycCases.tenantId,
      kind: schema.kycCases.kind,
      status: schema.kycCases.status,
      riskLevel: schema.kycCases.riskLevel,
      note: schema.kycCases.note,
      paymentId: schema.kycCases.paymentId,
      decisionNote: schema.kycCases.decisionNote,
      decidedAt: schema.kycCases.decidedAt,
      createdAt: schema.kycCases.createdAt,
      tenantName: schema.tenants.name,
      subjectName: schema.kycScreenings.subjectName,
      subjectRef: schema.kycScreenings.subjectRef,
      score: schema.kycScreenings.score,
    })
    .from(schema.kycCases)
    .leftJoin(schema.tenants, eq(schema.tenants.id, schema.kycCases.tenantId))
    .leftJoin(schema.kycScreenings, eq(schema.kycScreenings.id, schema.kycCases.screeningId))
    .where(status ? eq(schema.kycCases.status, status) : undefined)
    .orderBy(desc(schema.kycCases.createdAt))
    .limit(limit);
  return rows as unknown as CaseRow[];
}

export async function decideCase(
  db: Db,
  input: { caseId: string; decision: "APPROVED" | "REJECTED" | "CLOSED"; note: string; actorId: string },
): Promise<void> {
  await db
    .update(schema.kycCases)
    .set({
      status: input.decision,
      decidedById: input.actorId,
      decidedAt: new Date(),
      decisionNote: input.note,
      updatedAt: new Date(),
    })
    .where(eq(schema.kycCases.id, input.caseId));
}

/* ------------------------------------------------------------------ */
/* Documents + profile                                                 */
/* ------------------------------------------------------------------ */

export const KYC_DOC_TYPES = ["CR12", "KRA_PIN", "ID_PASSPORT", "DIRECTORS", "UTILITY", "BANK_STATEMENT"] as const;
export type KycDocType = (typeof KYC_DOC_TYPES)[number];

export async function ensureProfile(db: Db, tenantId: string): Promise<string> {
  const [existing] = await db
    .select({ id: schema.kycProfiles.id })
    .from(schema.kycProfiles)
    .where(eq(schema.kycProfiles.tenantId, tenantId))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(schema.kycProfiles)
    .values({ tenantId, status: "NOT_SUBMITTED", verificationLevel: "NONE" })
    .returning();
  return row!.id;
}

export async function attachDocument(db: Db, input: {
  tenantId: string;
  docType: KycDocType;
  fileId: string;
  uploadedById?: string;
}): Promise<string> {
  const profileId = await ensureProfile(db, input.tenantId);
  const [row] = await db
    .insert(schema.kycDocuments)
    .values({
      tenantId: input.tenantId,
      profileId,
      docType: input.docType,
      fileId: input.fileId,
      status: "SUBMITTED",
      uploadedById: input.uploadedById,
    })
    .returning();
  return row!.id;
}

export async function listDocuments(db: Db, tenantId: string) {
  const rows = await db
    .select({
      id: schema.kycDocuments.id,
      docType: schema.kycDocuments.docType,
      status: schema.kycDocuments.status,
      notes: schema.kycDocuments.notes,
      createdAt: schema.kycDocuments.createdAt,
      filename: schema.fileObjects.filename,
      mimeType: schema.fileObjects.mimeType,
      sizeBytes: schema.fileObjects.sizeBytes,
      scanStatus: schema.fileObjects.scanStatus,
    })
    .from(schema.kycDocuments)
    .leftJoin(schema.fileObjects, eq(schema.fileObjects.id, schema.kycDocuments.fileId))
    .where(eq(schema.kycDocuments.tenantId, tenantId))
    .orderBy(desc(schema.kycDocuments.createdAt));
  return rows;
}

export async function getProfile(db: Db, tenantId: string) {
  const [row] = await db
    .select({
      id: schema.kycProfiles.id,
      businessName: schema.kycProfiles.businessName,
      registrationNumber: schema.kycProfiles.registrationNumber,
      verificationLevel: schema.kycProfiles.verificationLevel,
      status: schema.kycProfiles.status,
      submittedAt: schema.kycProfiles.submittedAt,
      reviewedAt: schema.kycProfiles.reviewedAt,
      reviewNote: schema.kycProfiles.reviewNote,
    })
    .from(schema.kycProfiles)
    .where(eq(schema.kycProfiles.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export async function submitForReview(
  db: Db,
  input: { tenantId: string; businessName?: string; registrationNumber?: string; actorId?: string },
): Promise<{ ok: boolean; error?: string; profileId?: string }> {
  const profileId = await ensureProfile(db, input.tenantId);
  const docs = await listDocuments(db, input.tenantId);
  if (docs.length === 0) return { ok: false, error: "Upload at least one document first." };
  const pending = docs.filter((d) => d.scanStatus === "PENDING" || d.scanStatus === null);
  if (pending.length > 0) return { ok: false, error: "Documents are still being scanned — try again in a moment." };
  const infected = docs.filter((d) => d.scanStatus === "INFECTED");
  if (infected.length > 0) return { ok: false, error: "A document failed the malware scan and was rejected." };

  await db
    .update(schema.kycProfiles)
    .set({
      status: "PENDING",
      verificationLevel: sql`CASE WHEN ${schema.kycProfiles.verificationLevel} = 'NONE' THEN 'BASIC' ELSE ${schema.kycProfiles.verificationLevel} END`,
      businessName: input.businessName?.trim() || undefined,
      registrationNumber: input.registrationNumber?.trim() || undefined,
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.kycProfiles.id, profileId));
  return { ok: true, profileId };
}

export async function decideProfile(
  db: Db,
  input: { tenantId: string; decision: "APPROVED" | "REJECTED"; note: string; actorId: string; level: "BASIC" | "FULL" },
): Promise<void> {
  await db
    .update(schema.kycProfiles)
    .set({
      status: input.decision,
      verificationLevel: input.decision === "APPROVED" ? input.level : "NONE",
      reviewedById: input.actorId,
      reviewedAt: new Date(),
      reviewNote: input.note,
      updatedAt: new Date(),
    })
    .where(eq(schema.kycProfiles.tenantId, input.tenantId));
}
