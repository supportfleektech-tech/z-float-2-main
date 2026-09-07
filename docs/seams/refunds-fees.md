# Design — Partial refunds & fee handling (Phase 10) — NOT implemented

Ledger-semantics design doc. Full reversals exist (checker-approved, compensating
journal); PARTIAL refunds and fee splitting do not, and must not be bolted on
without agreeing the semantics below.

## Proposed ledger semantics
A partial refund R of payment P (original total T, fee F, proceeds T−F):

1. **Amount math** (single source: `@zfloat/money` minor-unit decimal): refund is
   always expressed as the amount RETURNED TO SOURCE (gross). Fee credit is
   prorated by the provider's refund policy — two provider behaviors exist:
   - fee refunded pro-rata → refund entries: `+gross`, `−feeShare` back to the
     fee account;
   - fee NOT refunded (common) → `+gross` to source, provider fee stays earned.
2. **Journal shape** (double-entry, per wallet_ledger_entries conventions):
   - `REFUND` entry on the source wallet for the gross returned;
   - `FEE_ADJUSTMENT` entry when the provider credits a fee share;
   - payment row gains `refundedMinor` + `refundCount`; `status` stays
     `PARTIALLY_REFUNDED` (new) until `refundedMinor == totalMinor` → `REFUNDED`.
3. **Guardrails**: sum of refunds ≤ total minus any already-reversed amounts;
   idempotency key per refund; maker-checker approval; audit
   `payment.refunded.partial` with before/after; webhook event to the tenant.
4. Recon: provider statements showing `Reverse`/`Refund` transaction types map
   onto the payment's refund ledger, never onto a phantom "new payment".

## Blockers / decisions
- Provider partial-refund support per rail (Daraja STK push refunds, bank rails).
- Fee-proration policy (product decision).
- Regulatory: refund timelines (e.g. reversals within provider windows).
