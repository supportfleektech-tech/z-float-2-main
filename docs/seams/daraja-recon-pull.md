# Seam — Daraja statement pull for reconciliation (Phase 10 SEAM)

**Status: SEAM — adapter call shape + design done; live requires a Safaricom
production certificate + partner account.** No fake claims: the CSV import and
webhook recon paths (Phase 3) are the operating surface today.

## Goal
Automate the provider-record side of reconciliation: instead of pasting a CSV,
a tenant's scheduled run pulls the statement directly from Daraja and feeds the
exact same `reconcileStatement` pipeline (`packages/payments-core/src/
reconciliation.ts`), so exceptions surface identically.

## Adapter call shape (provider-agnostic)
```ts
interface StatementPullAdapter {
  /** Fetch settled transactions for a window. Returns raw rows + paging info. */
  fetchStatement(opts: {
    tenantId: string;
    providerAccount: string;          // paybill/till/merchant shortcode
    periodStart: Date;
    periodEnd: Date;
    cursor?: string;                  // opaque page cursor
  }): Promise<{ rows: ProviderStatementRow[]; nextCursor?: string }>;

  /** Convert one provider row into the engine's StatementRow. */
  toStatementRow(raw: ProviderStatementRow): import("@zfloat/payments-core").StatementRow;
}
```
Mapping: Daraja "transaction status" / statement endpoints → `providerReference`
(trans_id or receipt), `amountMinor`, `occurredAt`. Errors classify:
4xx → permanent (mark run FAILED + exception, alert ops); 5xx/network → retry
with backoff (reuse the 2s→30s ladder pattern).

## Wiring (when credentials exist)
1. Add `providerAccount` per tenant (platform admin settings).
2. Scheduled job `reconciliation.pull` per tenant daily (reuse schedule
   dispatch machinery) → adapter → `reconcileStatement` with
   `source: "PROVIDER_API"` (new enum value) → summary + notifications.
3. Keep CSV import as the fallback/manual path (Phase 3 preserved).

## Blocker
Safaricom production/Daraja credentials + certification are required for a live
call; the sandbox cannot emulate authenticated statement pulls end-to-end.
See docs/GAP-ANALYSIS.md Phase 10 and runbook RB-05 for recon ops.
