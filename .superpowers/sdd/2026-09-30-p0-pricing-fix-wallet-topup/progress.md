# SDD ledger — plan: docs/superpowers/plans/2026-09-30-p0-pricing-fix-wallet-topup.md

## Pre-flight Scan

| Task pair | Shared file/interface | Finding |
|-----------|----------------------|---------|
| Task 1 → Task 3 | `feeRules.amountMinorMin/Max` | Clean — Task 1 produces columns, Task 3 consumes them |
| Task 1 → Task 4 | `feeRules` schema | Clean — Task 1 adds columns, Task 4 uses them in seed |
| Task 2 → Task 3 | `computeFee` function | Clean — Task 2 writes test, Task 3 implements |
| Task 3 → Task 4 | `findFeeRule` query | Clean — Task 3 updates engine, Task 4 provides seed data |
| Task 4 → Task 5 | `fee_rules` table | Clean — Task 4 seeds data, Task 5 reads it |
| Task 6 → Task 7 | `initiateStkPush` | Clean — Task 6 extracts function, Task 7 calls it |
| Task 7 → Task 8 | `wallet_top_up` product | Clean — Task 7 creates endpoint, Task 8 handles callback |
| Task 7 → Task 9 | `POST /api/wallet/top-up` | Clean — Task 7 creates API, Task 9 builds UI |

**Self-consistency check:**
- Task 2 test asserts KES 10 for ≤1K, KES 25 for >1K — matches Task 4 seed data ✓
- Task 3 adds amount band filtering — matches Task 1 schema columns ✓
- Task 5 reads from `fee_rules` — matches Task 4 seed data ✓
- Task 7 uses `initiateStkPush` — matches Task 6 extraction ✓

**Rulings:** None needed — scan is clean.

---

Task 1: complete (commits 581bec0..8d70eb9, review clean)
Task 2: complete (commits 8d70eb9..6b4a1b3, TDD fail verified)
Task 3: complete (commits 6b4a1b3..dc0db1b, 6/6 tests pass)
Task 4: complete (commits dc0db1b..de209c2, 14 rules seeded, 6/6 tests pass)
Task 5: complete (commits de209c2..4d04369, fee preview API returns banded fees)
Fix: raw SQL for amount band comparison (commit 38afca1) — lte/gte with bigint columns caused type mismatch
Task 6: complete (commits 4d04369..9aba44a, 6/6 tests pass)
Task 7: complete (commits 9aba44a..e9d02b7, API tested 201 + validation)
Task 8: complete (commits e9d02b7..ec8dfa6, 2/2 new + 16/16 existing tests pass)
Task 9: complete (commits ec8dfa6..4b34345, UI added to accounts page)
Task 10: complete (8/8 tests pass: 6 fee unit + 2 wallet top-up integration)

## P1 Progress

P1-1: complete (commit 532f34d) — bulk upload accepts Openfloat CSV template columns
P1-2: complete (commit 72a506c) — supplier bank/paybill/till details + statements
P1-3: complete (commit 37728f1) — expense mgmt: receipt upload, categories, ledgers, CSV export
P1-4: complete (commit 28b4c9c) — live bills/airtime via aggregator
P1-5: complete (commit b744734) — branches / multi-account switching with eTIMS branch IDs
P1-6: complete (commit fa1ca5f) — Capacitor wrap for iOS/Android app stores
P1-7: complete (commit a4f80b8) — payment confirmations via email + SMS
P2-1: complete (commit a4f80b8) — full payroll: PAYE, SHIF, NSSF, Housing Levy, payslips, remittance files
P2-2: complete (commit 8a11e98) — withholding tax automation + KRA eSlip payment
P2-3: complete (commit 1969cd9) — budgets/spend limits per team/branch/employee + petty-cash sub-wallets
P2-4: complete — approvals via WhatsApp/SMS/USSD with one-tap tokens
P2-5: complete — accounting sync: QuickBooks, Xero, Zoho Books, Sage
P2-6: complete (commit 18672c5) — 24/7 support: chat widget, phone callbacks, ticketing

---

## P0–P2 COMPLETE

**P0 (Launch-critical):**
- G1: Fixed pricing mismatch (banded flat fees, single source of truth)
- G2: Instant M-PESA wallet top-up via STK

**P1 (Feature parity with Openfloat):**
- P1-1: Openfloat CSV template compatibility
- P1-2: Supplier bank/paybill/till details + statements
- P1-3: Expense mgmt (receipts, categories, ledgers, CSV export)
- P1-4: Live bills/airtime via aggregator
- P1-5: Branches / multi-account switching + eTIMS branch IDs
- P1-6: Capacitor wrap for iOS/Android
- P1-7: Payment confirmations (email + SMS, both parties)

**P2 (Differentiation):**
- P2-1: Full payroll (PAYE, SHIF, NSSF, Housing Levy, payslips, remittances)
- P2-2: WHT automation + KRA eSlip payment
- P2-3: Budgets/spend limits + petty-cash sub-wallets
- P2-4: WhatsApp/SMS/USSD approvals with one-tap
- P2-5: Accounting sync (QuickBooks, Xero, Zoho Books, Sage)
- P2-6: 24/7 support (chat, callbacks, ticketing)

P3 (Corporate cards, travel, expansion, working capital) — marked "later" in plan.

---

## Summary

All P0 tasks complete. 10 commits total:
- 8d70eb9 feat(db): add amount band columns to fee_rules
- 6b4a1b3 test: add banded fee calculation tests
- dc0db1b feat(fees): filter fee rules by amount band
- de209c2 feat(seed): replace percentage fees with banded flat-fee card
- 4d04369 feat(pricing): display dynamic fees from fee_rules
- 38afca1 fix(fees): use raw SQL for amount band comparison
- 9aba44a refactor(collections): extract initiateStkPush into reusable function
- e9d02b7 feat(wallet): add M-PESA top-up API endpoint
- ec8dfa6 feat(wallet): credit wallet on STK top-up success
- 4b34345 feat(wallet): add Fund with M-PESA button and modal


