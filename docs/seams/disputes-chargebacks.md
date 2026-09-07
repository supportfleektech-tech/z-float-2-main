# Design — Disputes & chargebacks (Phase 10) — NOT implemented

**Why not:** needs product decisions (who disputes what on a business-payment
platform: recipients? payers? provider windows) and provider windows that vary
by rail (M-Pesa dispute windows, bank scheme rules). Designing schema against
guesses would be fabrication; this doc captures the proposal for the product
decision.

## Requirements under consideration
- A **dispute case** is opened on a payment/batch row (or provider reference),
  with reason codes, amount in dispute, evidence attachments (reuse the storage
  + files.scan pipeline), status workflow OPEN → INVESTIGATING → UPHELD /
  REJECTED / WITHDRAWN, maker-checker on the decision, audit on every step.
- Provider windows: record `windowDeadline`; late cases flagged
  `providerWindowExpired` so ops knows when the rail will refuse.
- Financial effect **only** on UPHELD + executed reversal; nothing moves
  automatically at case creation (mirrors the Phase-1 maker-checker posture).

## Proposed schema (proposal only)
```
dispute_cases(id, tenant_id, payment_id, batch_id?, provider_reference,
  reason_code, amount_minor, currency, status, window_deadline,
  opened_by_id, opened_at, decided_by_id, decided_at, decision, resolution)
dispute_events(id, case_id, actor_id, action, note, created_at)   -- append-only
dispute_evidence(id, case_id, file_key, uploaded_by_id, created_at)
```
Ledger semantics on UPHELD-with-reversal: reuse the existing reversal journal
path (`executeApprovedReversal`) — a dispute is a trigger, never a second
ledger mechanism.

## Open product questions (need answers before implementation)
1. Self-service portal disputes vs ops-only intake?
2. Default chargeback handling when the provider refunds outside Z-float (e.g.
   direct reversal by payer bank)? Requires an "external refund" reconcile path.
3. Dispute fee handling (who bears provider fees)?
4. Retention of evidence vs erasure (Phase 5 DSAR interplay).
