# P0 Design: Pricing Fix (G1) + Instant M-PESA Wallet Top-Up (G2)

**Date:** 2026-09-30
**Status:** Approved for implementation
**Source:** COMPETITOR-OPENFLOAT.md

---

## 1. Problem Statement

### G1 — Pricing Mismatch

The public pricing page advertises flat per-payment fees (Starter KES 15, Growth KES 10), but the fee engine charges percentage-based fees (0.75%–2.0%). A KES 10,000 M-PESA payment is advertised at KES 10 but charged at KES 150 — a 15x discrepancy. The two systems are completely disconnected:

- **Pricing page** reads from `pages` table (marketing JSON)
- **Fee engine** reads from `fee_rules` table (transactional rules)

### G2 — Manual Wallet Funding

Wallet funding requires a manual "bank transfer reference" form. No self-serve M-PESA top-up exists, while competitor Openfloat offers M-PESA top-up (albeit slow — 2 business days).

---

## 2. Design

### 2.1 G1 — Pricing Fix

#### 2.1.1 Schema Change: Amount Bands on `fee_rules`

Add two columns to support banded pricing (e.g., KES 10 for ≤1K, KES 25 for >1K):

```sql
ALTER TABLE fee_rules ADD COLUMN amount_minor_min bigint;
ALTER TABLE fee_rules ADD COLUMN amount_minor_max bigint;
```

- `amount_minor_min`: minimum transaction amount (inclusive) for this rule to apply. NULL = no lower bound.
- `amount_minor_max`: maximum transaction amount (inclusive) for this rule to apply. NULL = no upper bound.

#### 2.1.2 Seed Data: Banded Flat-Fee Card

Replace the 7 percentage-based rules with banded flat-fee rules:

| Product | Channel | Provider | Amount Band | Fee |
|---------|---------|----------|-------------|-----|
| single_payment | mpesa | mpesa-safaricom | ≤ KES 1,000 | KES 10 |
| single_payment | mpesa | mpesa-safaricom | > KES 1,000 | KES 25 |
| single_payment | mpesa | local-sandbox | ≤ KES 1,000 | KES 10 |
| single_payment | mpesa | local-sandbox | > KES 1,000 | KES 25 |
| single_payment | till | local-sandbox | any | KES 30 |
| single_payment | paybill | local-sandbox | any | KES 30 |
| single_payment | bank | local-sandbox | any | KES 35 |
| bulk_payment | mpesa | mpesa-safaricom | any | KES 25 |
| bulk_payment | mpesa | local-sandbox | any | KES 25 |
| payroll | mpesa | local-sandbox | any | KES 20 |
| payroll | mpesa | mpesa-safaricom | any | KES 20 |
| airtime | airtime | local-sandbox | any | KES 0 (2% cashback) |
| bills | bills | local-sandbox | any | KES 30 |

Each rule gets 3 versions (v1 DISABLED, v2 DISABLED, v3 ACTIVE) following the existing seed pattern.

#### 2.1.3 Fee Engine Update

Update `findFeeRule` in `packages/payments-core/src/fees.ts` to filter by amount band:

```typescript
// Add to the query filter:
.and(
  or(
    isNull(feeRules.amountMinorMin),
    lte(feeRules.amountMinorMin, amountMinor)
  )
)
.and(
  or(
    isNull(feeRules.amountMinorMax),
    gte(feeRules.amountMinorMax, amountMinor)
  )
)
```

#### 2.1.4 Single Source of Truth

The pricing page (`apps/web/app/pricing/page.tsx`) currently reads from `getSiteContent("pricing")`. Change it to:

1. Call a new `/api/fees/preview` endpoint that reads active `fee_rules` and returns the computed fee for sample amounts
2. Display the actual fees from `fee_rules` alongside the marketing copy
3. Keep the marketing copy in `pages` table but remove the hardcoded prices — replace with dynamic values from the API

#### 2.1.5 Test: Advertised Price = Charged Fee

Add `packages/payments-core/test/fees.unit.test.ts`:

- For each active fee rule, compute the fee for a sample amount within the band
- Assert the fee matches the expected value
- Assert the pricing page API returns the same fee for the same input
- Test min/max cap logic
- Test band boundary conditions (e.g., amount = 1000 vs 1001)

### 2.2 G2 — Instant M-PESA Wallet Top-Up

#### 2.2.1 Reuse STK Collection Flow

The STK push flow already exists in `packages/payments-core/src/collections.ts`. Extract the core STK push logic into a reusable function:

```typescript
export async function initiateStkPush(db, ctx, input: {
  phoneNumber: string;
  amountMinor: bigint;
  accountReference: string;
  callbackUrl: string;
}): Promise<{ transactionId: string; providerRef: string }>
```

#### 2.2.2 Wallet Top-Up API

New endpoint: `POST /api/wallet/top-up`

Request:
```json
{
  "amountMinor": 500000,
  "phoneNumber": "254712345678"
}
```

Flow:
1. Validate input (amount > 0, valid phone)
2. Create a `wallet_top_up` payment record (status: PENDING)
3. Call `initiateStkPush` with `accountReference: "WALLET-TOPUP"`
4. Return `{ paymentId, providerRef }` to client

#### 2.2.3 STK Success Callback

On STK success (existing webhook handler):
1. Look up the payment by `providerRef`
2. If product = `wallet_top_up`, credit the wallet via double-entry ledger
3. Update payment status to COMPLETED
4. Send confirmation notification

#### 2.2.4 Wallet Top-Up Fee

Add a `wallet_top_up` rule to `fee_rules`: fee = 0 (free top-up).

#### 2.2.5 UI: Fund Wallet Button

Add a "Fund with M-PESA" button on the wallet page (`apps/web/app/portal/wallet/page.tsx`):
- Opens a modal: enter amount + phone number
- Calls `POST /api/wallet/top-up`
- Shows "Check your phone for M-PESA prompt" on success
- Polls for completion or refreshes on webhook callback

---

## 3. Migration Plan

1. **Custom SQL migration** `020_fee_amount_bands.sql`:
   - `ALTER TABLE fee_rules ADD COLUMN amount_minor_min bigint`
   - `ALTER TABLE fee_rules ADD COLUMN amount_minor_max bigint`
   - Backfill: set NULL for all existing rules (no banding)

2. **Seed update**: Replace percentage rules with banded flat-fee rules

3. **Engine update**: `findFeeRule` filters by amount band

4. **API update**: `/api/fees/preview` returns computed fees from `fee_rules`

5. **UI update**: Pricing page displays dynamic fees from API

6. **Wallet top-up**: New API endpoint + UI modal + STK reuse

---

## 4. File Changes

| File | Change |
|------|--------|
| `packages/database/custom-migrations/020_fee_amount_bands.sql` | New migration |
| `packages/database/src/schema/index.ts` | Add `amountMinorMin`, `amountMinorMax` to `feeRules` |
| `packages/database/src/seed/run.ts` | Replace percentage rules with banded flat-fee card |
| `packages/payments-core/src/fees.ts` | Update `findFeeRule` to filter by amount band |
| `packages/payments-core/src/collections.ts` | Extract `initiateStkPush` into reusable function |
| `packages/payments-core/test/fees.unit.test.ts` | New test file |
| `apps/web/app/api/fees/preview/route.ts` | Return computed fees from `fee_rules` |
| `apps/web/app/api/wallet/top-up/route.ts` | New endpoint |
| `apps/web/app/pricing/page.tsx` | Display dynamic fees from API |
| `apps/web/app/portal/wallet/page.tsx` | Add "Fund with M-PESA" button + modal |
| `apps/web/app/api/webhooks/mpesa/route.ts` | Handle `wallet_top_up` product in STK callback |

---

## 5. Testing Strategy

| Test | Type | What it verifies |
|------|------|-----------------|
| `fees.unit.test.ts` | Unit | Fee formula (flat + banded), min/max caps, band boundaries |
| `pricing-dynamic.test.ts` | Integration | Pricing page API returns same fees as engine |
| `wallet-top-up.integration.test.ts` | Integration | Top-up flow: create → STK push → callback → wallet credited |
| Manual smoke test | E2E | Login → view pricing → make payment → verify fee → top-up wallet |

---

## 6. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Existing payments have percentage-based fee snapshots | `fee_calculations` stores immutable snapshots — past payments keep their historical fees |
| Band boundary rounding (e.g., amount = 1000.50) | Use integer minor units everywhere — no floating point |
| STK push fails for wallet top-up | Payment stays PENDING; user can retry; no wallet credit until success callback |
| Pricing page breaks if API fails | Fall back to marketing copy with "Contact us for pricing" message |

---

## 7. Out of Scope (P1+)

- Bulk upload, supplier bank details, expense management
- Live bills/airtime/data bundles via aggregator
- Branches/multi-account switching
- Mobile apps
- Full payroll, budgets, WhatsApp approvals, accounting sync
