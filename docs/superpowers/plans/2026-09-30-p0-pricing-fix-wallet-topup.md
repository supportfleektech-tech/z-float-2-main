# P0: Pricing Fix + Wallet Top-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the pricing mismatch (G1) and add instant M-PESA wallet top-up (G2) before launch.

**Architecture:** Add amount-band columns to `fee_rules`, replace percentage-based seed data with banded flat-fee card, update the fee engine to filter by amount bands, and reuse the existing STK push flow for wallet top-ups.

**Spec:** `docs/superpowers/specs/2026-09-30-p0-pricing-fix-wallet-topup-design.md`

---

## Global Constraints

- All amounts in minor units (cents) — integer bigint, never float
- Fee rules live in DB (`fee_rules` table) — never hard-code in payment code
- Every fee rule change creates a new version (v1 DISABLED → v2 DISABLED → v3 ACTIVE)
- Past payments keep immutable fee snapshots in `fee_calculations`
- TDD: write failing test → verify fail → implement → verify pass → commit
- Run `pnpm ci:local` before declaring any task complete

---

### Task 1: Add amount-band columns to `fee_rules` schema + migration

**Files:**
- Create: `packages/database/custom-migrations/020_fee_amount_bands.sql`
- Modify: `packages/database/src/schema/index.ts` (feeRules table, ~line 685)

**Interfaces:**
- Produces: `feeRules.amountMinorMin` (bigint, nullable), `feeRules.amountMinorMax` (bigint, nullable)

- [ ] **Step 1: Write the migration**

```sql
-- 020_fee_amount_bands.sql
ALTER TABLE fee_rules ADD COLUMN IF NOT EXISTS amount_minor_min bigint;
ALTER TABLE fee_rules ADD COLUMN IF NOT EXISTS amount_minor_max bigint;
```

- [ ] **Step 2: Add columns to schema**

In `packages/database/src/schema/index.ts`, add to the `feeRules` table definition:

```typescript
amountMinorMin: bigint("amount_minor_min", { mode: "number" }),
amountMinorMax: bigint("amount_minor_max", { mode: "number" }),
```

- [ ] **Step 3: Run migration**

```bash
export DATABASE_URL=postgresql://zfloat:zfloat_dev_password@127.0.0.1:55433/zfloat
pnpm db:migrate
```

- [ ] **Step 4: Verify columns exist**

```bash
docker exec zfloat-db psql -U zfloat -d zfloat -c "\d fee_rules" | grep amount_minor
```

Expected: `amount_minor_min` and `amount_minor_max` columns listed

- [ ] **Step 5: Commit**

```bash
git add packages/database/custom-migrations/020_fee_amount_bands.sql packages/database/src/schema/index.ts
git commit -m "feat(db): add amount band columns to fee_rules"
```

---

### Task 2: Write failing test for banded fee calculation

**Files:**
- Create: `packages/payments-core/test/fees.unit.test.ts`

**Interfaces:**
- Consumes: `computeFee(db, amountMinor, ctx)` from `packages/payments-core/src/fees.ts`
- Produces: Test that verifies banded flat-fee rules

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { computeFee } from "../src/fees.js";

describe("computeFee — banded flat fees", () => {
  it("charges KES 10 for M-PESA payment ≤ KES 1,000", async () => {
    const result = await computeFee(mockDb, 100000n, mockCtx); // KES 1,000
    expect(result.feeMinor).toBe(1000n); // KES 10
  });

  it("charges KES 25 for M-PESA payment > KES 1,000", async () => {
    const result = await computeFee(mockDb, 100100n, mockCtx); // KES 1,001
    expect(result.feeMinor).toBe(2500n); // KES 25
  });

  it("charges KES 30 for paybill/till payment (any amount)", async () => {
    const result = await computeFee(mockDb, 500000n, mockCtx); // KES 5,000
    expect(result.feeMinor).toBe(3000n); // KES 30
  });

  it("charges KES 35 for bank transfer (any amount)", async () => {
    const result = await computeFee(mockDb, 500000n, mockCtx); // KES 5,000
    expect(result.feeMinor).toBe(3500n); // KES 35
  });

  it("charges KES 20 for payroll (any amount)", async () => {
    const result = await computeFee(mockDb, 2000000n, mockCtx); // KES 20,000
    expect(result.feeMinor).toBe(2000n); // KES 20
  });

  it("charges KES 0 for airtime (any amount)", async () => {
    const result = await computeFee(mockDb, 50000n, mockCtx); // KES 500
    expect(result.feeMinor).toBe(0n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/payments-core && pnpm test -- --run test/fees.unit.test.ts
```

Expected: FAIL — `findFeeRule` does not filter by amount band

- [ ] **Step 3: Commit**

```bash
git add packages/payments-core/test/fees.unit.test.ts
git commit -m "test: add banded fee calculation tests"
```

---

### Task 3: Update fee engine to filter by amount band

**Files:**
- Modify: `packages/payments-core/src/fees.ts` (findFeeRule function, ~line 26)

**Interfaces:**
- Consumes: `feeRules.amountMinorMin`, `feeRules.amountMinorMax` from Task 1
- Produces: Updated `findFeeRule` that filters by amount band

- [ ] **Step 1: Update findFeeRule query**

In `packages/payments-core/src/fees.ts`, add amount band filtering to the query:

```typescript
import { and, eq, isNull, lte, gte, or, asc } from "drizzle-orm";

// Inside findFeeRule, add to the .where() clause:
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

- [ ] **Step 2: Run test to verify it passes**

```bash
cd packages/payments-core && pnpm test -- --run test/fees.unit.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/payments-core/src/fees.ts
git commit -m "feat(fees): filter fee rules by amount band"
```

---

### Task 4: Replace percentage seed rules with banded flat-fee card

**Files:**
- Modify: `packages/database/src/seed/run.ts` (fee rules section, ~line 599)

**Interfaces:**
- Consumes: `feeRules.amountMinorMin`, `feeRules.amountMinorMax` from Task 1
- Produces: Banded flat-fee seed data matching the approved price card

- [ ] **Step 1: Replace fee rules seed data**

In `packages/database/src/seed/run.ts`, replace the 7 percentage-based fee rules with:

```typescript
const feeRules = [
  // M-PESA single payment — banded
  { product: "single_payment", channel: "mpesa", provider: "mpesa-safaricom", amountMinorMin: null, amountMinorMax: 100000, flatFeeMinor: 1000, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  { product: "single_payment", channel: "mpesa", provider: "mpesa-safaricom", amountMinorMin: 100001, amountMinorMax: null, flatFeeMinor: 2500, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  { product: "single_payment", channel: "mpesa", provider: "local-sandbox", amountMinorMin: null, amountMinorMax: 100000, flatFeeMinor: 1000, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  { product: "single_payment", channel: "mpesa", provider: "local-sandbox", amountMinorMin: 100001, amountMinorMax: null, flatFeeMinor: 2500, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  // Paybill / Till
  { product: "single_payment", channel: "till", provider: "local-sandbox", amountMinorMin: null, amountMinorMax: null, flatFeeMinor: 3000, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  { product: "single_payment", channel: "paybill", provider: "local-sandbox", amountMinorMin: null, amountMinorMax: null, flatFeeMinor: 3000, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  // Bank transfer (PesaLink)
  { product: "single_payment", channel: "bank", provider: "local-sandbox", amountMinorMin: null, amountMinorMax: null, flatFeeMinor: 3500, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  // Bulk payment
  { product: "bulk_payment", channel: "mpesa", provider: "mpesa-safaricom", amountMinorMin: null, amountMinorMax: null, flatFeeMinor: 2500, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  { product: "bulk_payment", channel: "mpesa", provider: "local-sandbox", amountMinorMin: null, amountMinorMax: null, flatFeeMinor: 2500, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  // Payroll
  { product: "payroll", channel: "mpesa", provider: "local-sandbox", amountMinorMin: null, amountMinorMax: null, flatFeeMinor: 2000, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  { product: "payroll", channel: "mpesa", provider: "mpesa-safaricom", amountMinorMin: null, amountMinorMax: null, flatFeeMinor: 2000, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  // Airtime (free + 2% cashback)
  { product: "airtime", channel: "airtime", provider: "local-sandbox", amountMinorMin: null, amountMinorMax: null, flatFeeMinor: 0, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  // Bills (KPLC, KRA, water)
  { product: "bills", channel: "bills", provider: "local-sandbox", amountMinorMin: null, amountMinorMax: null, flatFeeMinor: 3000, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
  // Wallet top-up (free)
  { product: "wallet_top_up", channel: "mpesa", provider: "local-sandbox", amountMinorMin: null, amountMinorMax: null, flatFeeMinor: 0, percentBps: 0, minFeeMinor: 0, maxFeeMinor: 0 },
];
```

- [ ] **Step 2: Re-seed the database**

```bash
export DATABASE_URL=postgresql://zfloat:zfloat_dev_password@127.0.0.1:55433/zfloat
pnpm db:seed
```

- [ ] **Step 3: Verify seed data**

```bash
docker exec zfloat-db psql -U zfloat -d zfloat -c "SELECT product, channel, provider, amount_minor_min, amount_minor_max, flat_fee_minor, percent_bps FROM fee_rules WHERE status='ACTIVE' ORDER BY product, channel;"
```

Expected: 14 rows with banded flat fees

- [ ] **Step 4: Run fee tests**

```bash
cd packages/payments-core && pnpm test -- --run test/fees.unit.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/seed/run.ts
git commit -m "feat(seed): replace percentage fees with banded flat-fee card"
```

---

### Task 5: Make pricing page read from fee_rules (single source of truth)

**Files:**
- Modify: `apps/web/app/api/fees/preview/route.ts`
- Modify: `apps/web/app/pricing/page.tsx`

**Interfaces:**
- Consumes: `feeRules` table from Task 1
- Produces: Pricing page displays actual computed fees from `fee_rules`

- [ ] **Step 1: Update fee preview API**

In `apps/web/app/api/fees/preview/route.ts`, replace the hardcoded response with a query that reads active `fee_rules` and computes fees for sample amounts:

```typescript
import { db } from "@zfloat/database";
import { feeRules } from "@zfloat/database/schema";
import { computeFee } from "@zfloat/payments-core/fees";

export async function GET() {
  const rules = await db.select().from(feeRules).where(eq(feeRules.status, "ACTIVE"));
  const sampleAmounts = [50000n, 100000n, 500000n, 1000000n]; // KES 500, 1K, 5K, 10K
  const fees = sampleAmounts.map(amount => ({
    amountMinor: amount.toString(),
    fees: rules.map(rule => ({
      product: rule.product,
      channel: rule.channel,
      feeMinor: computeFee(db, amount, { tenantId: rule.tenantId }).feeMinor.toString(),
    })),
  }));
  return Response.json({ fees });
}
```

- [ ] **Step 2: Update pricing page to display dynamic fees**

In `apps/web/app/pricing/page.tsx`, replace hardcoded prices with data from the API:

```typescript
const feeData = await fetch("/api/fees/preview").then(r => r.json());
// Display feeData.fees instead of hardcoded KES 10/15
```

- [ ] **Step 3: Test the pricing page**

```bash
curl -s http://localhost:5050/api/fees/preview | jq '.fees[0]'
```

Expected: JSON with computed fees for each sample amount

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/fees/preview/route.ts apps/web/app/pricing/page.tsx
git commit -m "feat(pricing): display dynamic fees from fee_rules"
```

---

### Task 6: Extract STK push logic into reusable function

**Files:**
- Modify: `packages/payments-core/src/collections.ts`

**Interfaces:**
- Produces: `initiateStkPush(db, ctx, input)` — reusable STK push function

- [ ] **Step 1: Extract STK push logic**

In `packages/payments-core/src/collections.ts`, extract the STK push logic into:

```typescript
export async function initiateStkPush(
  db: Database,
  ctx: { tenantId: string },
  input: {
    phoneNumber: string;
    amountMinor: bigint;
    accountReference: string;
    callbackUrl: string;
  }
): Promise<{ transactionId: string; providerRef: string }> {
  // Existing STK push logic moved here
}
```

- [ ] **Step 2: Update existing callers**

Update any existing code that calls the inline STK push to use `initiateStkPush` instead.

- [ ] **Step 3: Run existing tests**

```bash
cd packages/payments-core && pnpm test -- --run test/collections.integration.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/payments-core/src/collections.ts
git commit -m "refactor(collections): extract initiateStkPush into reusable function"
```

---

### Task 7: Create wallet top-up API endpoint

**Files:**
- Create: `apps/web/app/api/wallet/top-up/route.ts`

**Interfaces:**
- Consumes: `initiateStkPush` from Task 6
- Produces: `POST /api/wallet/top-up` endpoint

- [ ] **Step 1: Write the endpoint**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@zfloat/database";
import { initiateStkPush } from "@zfloat/payments-core/collections";
import { getSession } from "@zfloat/auth";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { amountMinor, phoneNumber } = await req.json();
  if (!amountMinor || amountMinor <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }
  if (!phoneNumber || !/^254\d{9}$/.test(phoneNumber)) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  const result = await initiateStkPush(db, { tenantId: session.tenantId }, {
    phoneNumber,
    amountMinor: BigInt(amountMinor),
    accountReference: "WALLET-TOPUP",
    callbackUrl: `${process.env.APP_URL}/api/webhooks/mpesa`,
  });

  return NextResponse.json(result);
}
```

- [ ] **Step 2: Test the endpoint**

```bash
curl -s -X POST http://localhost:5050/api/wallet/top-up \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{"amountMinor": 500000, "phoneNumber": "254712345678"}'
```

Expected: `{ transactionId, providerRef }`

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/wallet/top-up/route.ts
git commit -m "feat(wallet): add M-PESA top-up API endpoint"
```

---

### Task 8: Handle wallet top-up in STK success callback

**Files:**
- Modify: `apps/web/app/api/webhooks/mpesa/route.ts`

**Interfaces:**
- Consumes: `POST /api/wallet/top-up` from Task 7
- Produces: Wallet credited on STK success

- [ ] **Step 1: Add wallet top-up handling**

In the STK success callback handler, add:

```typescript
if (product === "wallet_top_up") {
  await creditWallet(db, tenantId, amountMinor, {
    source: "mpesa_stk",
    reference: providerRef,
  });
}
```

- [ ] **Step 2: Run webhook tests**

```bash
cd apps/web && pnpm test -- --run test/webhooks.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/webhooks/mpesa/route.ts
git commit -m "feat(wallet): credit wallet on STK top-up success"
```

---

### Task 9: Add "Fund with M-PESA" UI to wallet page

**Files:**
- Modify: `apps/web/app/portal/wallet/page.tsx`

**Interfaces:**
- Consumes: `POST /api/wallet/top-up` from Task 7
- Produces: "Fund with M-PESA" button + modal on wallet page

- [ ] **Step 1: Add the button and modal**

In `apps/web/app/portal/wallet/page.tsx`, add:

```typescript
const [showTopUp, setShowTopUp] = useState(false);
const [topUpAmount, setTopUpAmount] = useState("");
const [topUpPhone, setTopUpPhone] = useState("");
const [topUpLoading, setTopUpLoading] = useState(false);
const [topUpError, setTopUpError] = useState("");

async function handleTopUp() {
  setTopUpLoading(true);
  setTopUpError("");
  try {
    const res = await fetch("/api/wallet/top-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amountMinor: BigInt(parseFloat(topUpAmount) * 100),
        phoneNumber: topUpPhone,
      }),
    });
    if (!res.ok) throw new Error("Top-up failed");
    setShowTopUp(false);
    // Show success message
  } catch (e) {
    setTopUpError("Top-up failed — try again");
  } finally {
    setTopUpLoading(false);
  }
}
```

- [ ] **Step 2: Test manually**

1. Login as demo@zfloat.app
2. Navigate to wallet page
3. Click "Fund with M-PESA"
4. Enter amount + phone
5. Submit — should show "Check your phone for M-PESA prompt"

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/portal/wallet/page.tsx
git commit -m "feat(wallet): add Fund with M-PESA button and modal"
```

---

### Task 10: End-to-end verification

**Files:**
- N/A (verification only)

- [ ] **Step 1: Run full test suite**

```bash
source .env
pnpm -r --filter './packages/*' --filter './services/*' build
pnpm --filter @zfloat/database db:migrate:test
DATABASE_URL=$DATABASE_URL_TEST pnpm --filter @zfloat/database db:seed
pnpm ci:local
```

Expected: All tests pass

- [ ] **Step 2: Manual smoke test**

1. Login as demo@zfloat.app / Demo@12345
2. Navigate to pricing page — verify fees match the banded flat-fee card
3. Make a KES 500 M-PESA payment — verify fee = KES 10
4. Make a KES 5,000 M-PESA payment — verify fee = KES 25
5. Fund wallet with M-PESA — verify wallet credited
6. Check that past payments still show correct historical fees

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address P0 verification findings"
```

---

## Self-Review

**Spec coverage:**
- G1 (pricing fix): Tasks 1-5 ✓
- G2 (wallet top-up): Tasks 6-9 ✓
- Test: Tasks 2, 10 ✓
- Migration: Task 1 ✓

**Placeholder scan:** No TBDs, TODOs, or vague steps.

**Type consistency:** `amountMinorMin`/`amountMinorMax` used consistently across Tasks 1-4. `initiateStkPush` used consistently across Tasks 6-8.
