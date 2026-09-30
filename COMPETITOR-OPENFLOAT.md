# Z-float vs Openfloat — competitor review, pricing strategy and build plan

*Researched 30 Sep 2026. Sources are listed at the end. Anything marked **(assumption)** must be
confirmed with Safaricom / the banking partner before prices go public.*

---

## 1. Who Openfloat is

- **Owner:** Pesapal Limited (Nairobi), one of Kenya's oldest payment gateways. Founded 2017.
  Openfloat runs on Pesapal's licences and trust account.
- **Markets:** Kenya, Uganda, Tanzania, Rwanda (support lines in all four).
- **Pitch:** "digitize petty cash, payroll and corporate bills" — a **payout / spend** tool, not a
  collections tool. Customers load a prepaid wallet ("float") and pay out from it.
- **Channels:** web dashboard + iOS/Android apps (Android: ~5K+ downloads).
- **Target customers (from their blog and case studies):** hotels, clinics/hospitals, schools,
  factories, safari operators, bars/restaurants (Bar Next Door, Natural World Kenya Safaris).
- **Marketing:** billboards in Nairobi, SEO blog, customer stories.

### What they offer

| Area | Openfloat feature |
|---|---|
| Payouts | Single + bulk (spreadsheet template) to M-PESA, Paybill, Till, any local bank |
| Payroll | Bulk salary disbursement only — no PAYE/SHIF/NSSF calculation advertised |
| Petty cash | Disbursements + expense tracking, receipt/invoice upload |
| Bills | Zuku, Faiba, JTL, KPLC prepaid + postpaid, **KRA taxes & penalties** (via KCB), others under "Pay Bills" |
| Airtime | Bulk airtime + data bundles (Safaricom, Airtel, Telkom), recurring, with "chargebacks" (commission) |
| Travel | Book flights + hotels for staff |
| Controls | Multiple approvers, maker-checker, scheduled approvals, roles & permissions, notifications |
| Organisation | Categories, groups, ledgers (statements per ledger); multi-account switching for branches |
| Funding | Top up wallet by M-PESA or bank transfer; instant settlement from a Pesapal merchant account |
| Reports | Transaction history, date search, statements, email confirmation per payment |

### Their prices (published)

| Transaction | Openfloat fee |
|---|---|
| M-PESA, Paybill, Till | **KES 40** flat |
| Bank transfer (any local bank) | **KES 50** flat |
| Airtime, Zuku, JTL | KES 0 |
| KPLC tokens/postpaid, KRA tax payments | **KES 50** flat |
| Sign-up | Free, pay per transaction |

### Their weak spots (evidence-based)

1. **Flat KES 40 on small payments is expensive.** Paying a casual KES 500 costs 8% in fees.
   Petty cash is mostly small payments — their core use-case is their worst-priced one.
2. **Slow, office-hours operations.** Their terms say wallet top-ups (e-value purchases) are credited
   **within 2 business days**, and the call centre runs **8am–11pm on business days** (despite
   "24/7" marketing copy).
3. **Heavy onboarding.** Voided cheque, CR12/Memorandum & Articles, director photos, and a
   **signed Pesapal contract** before activation.
4. **Payout-only.** No invoicing, no collections, no **KRA eTIMS** invoices/receipts on Openfloat's
   site. Collections live in a separate Pesapal product (1.5–3.5% gateway fees).
5. **Payroll is disbursement only** — no statutory deductions, payslips or P9s.
6. **No public developer API / webhooks** for Openfloat (Pesapal's gateway API is separate).
7. **One-sided terms:** liability capped at fees earned in 12 months; merchant indemnifies broadly.

---

## 2. Where Z-float stands today (from the codebase)

### Already better than Openfloat (built and in `master`)

| Z-float capability | Openfloat? |
|---|---|
| **KRA eTIMS** e-invoices, receipts, credit notes, QR verification (sandbox signer until KRA device registration) | Not offered |
| **Collections** — M-PESA STK push, paybill/till C2B, invoice "request payment", public receipt pages | Not in Openfloat (separate Pesapal gateway) |
| **Identity**: National ID / passport + KRA PIN on customers and recipients | Phone/name only advertised |
| Developer API, API keys, webhooks, payment links | Not public |
| Reconciliation with exception workflow | Not advertised |
| KYC/AML screening, MFA, immutable audit log, double-entry ledger | Partly (audit trail) |
| Scheduled / recurring payments, approvals, roles | Yes (parity) |

### Gaps and problems found in our own code

| # | Finding | Impact |
|---|---|---|
| **G1** | **Pricing mismatch (bug).** The public pricing page says *"one flat platform fee per payment"* (Starter KES 15, Growth KES 10), but the seeded fee engine charges **percentages with no cap**: single 1.5%, bulk 1.0%, payroll 0.75%, airtime 2.0% (`packages/database/src/seed/run.ts`). | A KES 50,000 supplier payment is billed **KES 750** vs Openfloat's KES 40, and customers are charged differently from what the website promises. **Must fix before launch.** |
| G2 | Wallet funding is a manual form ("bank transfer reference"). No self-serve M-PESA top-up. | Openfloat has M-PESA top-up. Easy win: reuse our STK collections to fund wallets instantly. |
| G3 | Expenses page is a simple list — no receipt photo upload, categories, ledgers or per-ledger statements. | Openfloat parity gap (petty cash is their core). |
| G4 | Suppliers page captures name/phone/email only — no bank account, paybill or till details. | Weak supplier-payments story. |
| G5 | Bills and airtime are catalogue/sandbox only (KPLC, KRA, Nairobi Water, Zuku, SHA in the catalogue); no live biller aggregator; no data bundles; no airtime commission. | Parity gap. |
| G6 | Only one branch (`00`) for eTIMS; no branch/account switching in the UI. | Openfloat supports multi-account switching. |
| G7 | Mobile: installable PWA only; no store apps. | Openfloat has iOS/Android apps. |
| G8 | Not live on any rail yet (sandbox providers) — see `docs/KNOWN_LIMITATIONS.md`. | Launch blocker (needs licensed partner). |

---

## 3. Pricing strategy — "always cheaper than Openfloat, and still profitable"

### Our cost floor

| Rail | What it costs us | Source |
|---|---|---|
| M-PESA B2C to a registered user | KES 0 (≤100) · 5 (101–1,500) · 9 (1,501–5,000) · 11 (5,001–20,000) · 13 (>20,000) | Safaricom B2C tariff (mpesa.or.ke guide, Oct 2025) |
| PesaLink bank transfer | ~KES 20 flat at the cheapest banks (e.g. DTB, Apr 2026); up to KES 50–110 elsewhere | DTB press release; paybillke.com |
| M-PESA B2B to Paybill/Till | **(assumption)** negotiated; budget KES 15–25 until the tariff form is signed | Safaricom tariff form |
| Partner / licensing margin | **(assumption)** KES 3–8 per transaction if we ride a licensed PSP's shortcode | To negotiate |

Openfloat's KES 40 on M-PESA leaves them roughly **KES 27–35 margin** per payout. That's our room.

### Proposed Z-float price card

| Transaction | Openfloat | **Z-float** | Our est. margin |
|---|---|---|---|
| M-PESA / Airtel to phone, ≤ KES 1,000 | 40 | **KES 10** | ~5 |
| M-PESA / Airtel to phone, > KES 1,000 | 40 | **KES 25** | ~12–20 |
| Paybill / Till | 40 | **KES 30** | ~5–15 (assumption) |
| Bank (PesaLink, any bank) | 50 | **KES 35** | ~15 |
| Payroll (per employee, Growth plan) | 40 | **KES 20** | ~7–15 |
| Airtime / data bundles | 0 + chargeback | **0 + 2% cashback** (share carrier commission) | carrier commission − 2% |
| KPLC, KRA tax, water bills | 50 | **KES 30** (free on Growth) | biller commission |
| **eTIMS invoices & receipts** | n/a | **Free, unlimited** | acquisition hook |
| Collections (STK / paybill) | n/a (Pesapal 1.5–3.5%) | **0.5%, capped at KES 150** | Safaricom C2B cost + margin |
| Wallet top-up by M-PESA | free, up to 2 business days | **Free, instant, 24/7** | — |

Plans stay simple: **Starter** (no monthly fee, card above), **Growth** (KES 2,490/month: free bills,
payroll KES 20, 10 seats, priority support), **Enterprise** (custom).

### Worked example — a typical 150-staff hotel, one month

| Payments | Openfloat | Z-float today (code as seeded) | **Z-float proposed** |
|---|---|---|---|
| 100 salaries × KES 20,000 (M-PESA) | 4,000 | 15,000 (0.75%) | **2,000** (payroll 20) |
| 50 suppliers × KES 50,000 (bank) | 2,500 | 25,000 (1% bulk) | **1,750** |
| 200 petty-cash × KES 800 (M-PESA) | 8,000 | 2,400 (1.5%) | **2,000** |
| **Total fees** | **KES 14,500** | **KES 42,400** | **KES 5,750 (−60%)** |
| Our cost of rails (est.) | — | — | ~3,100 → **~46% gross margin** |

**Message for sales:** *"Same payouts, 60% cheaper, plus free KRA eTIMS invoices and instant
M-PESA top-up."*

**Guardrails:** keep fees in `fee_rules` (per channel, banded, with caps) so prices can move if
Safaricom changes tariffs; review margins monthly; never price below rail cost + partner fee.

---

## 4. Build plan

### P0 — before charging anyone

1. **Fix G1:** replace the percentage seed rules with the banded flat card above (`fee_rules`
   already supports flat + % + min/max + per-tenant overrides) and make the pricing page read from
   the same source so the two can never disagree. Add a test that the advertised price equals the
   charged fee for each channel.
2. **Instant M-PESA wallet top-up** (G2): "Fund wallet → M-PESA" uses the existing STK collection
   flow; on success, credit the wallet via the ledger.
3. **Go live on real rails** via a CBK-licensed partner (bank or PSP): B2C shortcode, B2B,
   PesaLink. Trust account for customer float; ODPC data-protection registration.

### P1 — match Openfloat feature-for-feature

4. **Openfloat-compatible bulk upload:** accept their template columns as-is
   (*account type, account name, account number, notification number, amount, remark*) so a
   switching customer uploads the same file on day one.
5. **Suppliers with bank / paybill / till details** (G4) + supplier statements.
6. **Expense management upgrade** (G3): receipt photo upload (reuse the scanned file storage),
   categories, groups/ledgers, per-ledger statements, CSV/PDF export.
7. **Live bills + airtime + data bundles** (G5) through one aggregator: KPLC, KRA (eSlip), Nairobi
   Water, Zuku, Faiba, DStv/GOtv, SHA/NSSF; airtime/data for Safaricom, Airtel, Telkom with
   commission share.
8. **Branches / multi-account switching** (G6): one tenant, several wallets + approval chains +
   eTIMS branch IDs.
9. **Mobile apps** (G7): wrap the existing PWA (e.g. Capacitor) for Play Store / App Store;
   approvals and top-ups first.
10. **Payment confirmations** by email + SMS to the payer and the recipient.

### P2 — be clearly better

11. **Full payroll:** PAYE, SHIF, NSSF, Housing Levy, payslips, P9, KRA/NSSF/SHA remittance files
    — Openfloat only disburses.
12. **Withholding tax** automation + one-click **KRA tax payment** (design already in
    `docs/seams/etims-vat-wht.md`).
13. **Budgets and spend limits** per team / branch / employee; **petty-cash sub-wallets** for
    staff with daily limits.
14. **Approvals on WhatsApp / SMS** (approve with one tap), USSD fallback for approvers.
15. **Accounting sync:** QuickBooks, Xero, Zoho Books, Sage (push payments, invoices, eTIMS
    numbers).
16. **Real 24/7 support** (chat + phone) — a direct answer to their office-hours call centre.

### P3 — later

17. Corporate cards (virtual/physical) with a card-issuing partner.
18. Travel booking (flights/hotels) — Openfloat has it; low priority for SMEs.
19. Uganda / Tanzania / Rwanda once Kenya is profitable.
20. Working-capital products (supplier financing, cash advance) with a lending partner.

---

## 5. Go-to-market

- **Switch offer:** "Send us your last Openfloat statement — we'll show your savings and give you
  your first month of payouts at cost." Upload their existing bulk file (item 4).
- **Target their verticals first:** hotels, clinics, schools, factories, tour operators,
  restaurants — the same ones their blog targets.
- **Compliance angle:** since the Finance Act 2025, expenses without an eTIMS invoice are not
  tax-deductible and KRA validates returns on iTax. Z-float bundles free eTIMS invoicing with
  payments; Openfloat doesn't offer it.
- **Lighter onboarding:** digital KYC (ID + KRA PIN check, e-signature), no voided cheque, live
  within 24 hours where the partner allows.
- **Transparent pricing page with a savings calculator** ("paste your monthly volumes").

## 6. Risks

- **Pesapal can price-match.** Our defence is the bundle (eTIMS + collections + payroll
  compliance + API), not price alone.
- **Thin margin on small payouts** (KES 10 band ≈ KES 5 margin). Watch volumes; adjust bands.
- **Safaricom tariff changes** — keep fees data-driven (`fee_rules`), not hard-coded.
- **Licensing:** Z-float must not hold customer funds without a licensed partner/trust account.
- **Trust:** Pesapal is established. We need reference customers, a clear SLA and security page.

---

## Sources

- Openfloat home, solutions, about, FAQ pages — https://www.openfloat.africa/
- Openfloat pricing (M-PESA/Paybill/Till KES 40, bank KES 50, bills free) —
  https://www.openfloat.africa/blog/how-openfloat-helps-you-close-the-year-with-financial-clarity
- Openfloat help centre (KYC documents, M-PESA/bank top-up, KE/UG/TZ/RW support) —
  https://app.openfloat.africa/help/help-page-not-auth
- Openfloat terms (top-ups credited within 2 business days; call centre 8am–11pm business days;
  liability cap) — https://app.openfloat.africa/terms-and-conditions
- KPLC via Openfloat, KES 50 fee — https://www.pesapal.com/blog/buy-kenya-power-tokens-settle-kplc-postpaid-bills-through-openfloat-by-pesapal
- KRA taxes via Openfloat, KES 50 fee — https://www.pesapal.com/blog/pay-kra-domestic-taxes-penalties-via-openfloat-by-pesapal
- Real-time settlement from Pesapal — https://www.openfloat.africa/blog/real-time-settlement-with-openfloat
- Google Play listing (flights & hotels, 5K+ downloads, Pesapal Limited) —
  https://play.google.com/store/apps/details?id=africa.openfloat
- User review (maker-checker, bulk upload) — https://moseskemibaro.medium.com/enhancing-spend-management-for-businesses-in-kenya-with-pesapals-openfloat-0aec58eacb37
- Safaricom B2C tariff table — https://mpesa.or.ke/guides/mpesa-bulk-payment-charges-and-limits/
- PesaLink fees / DTB KES 20 flat — https://paybillke.com/compare/pesalink-vs-mpesa ,
  https://dtbk.dtbafrica.com/news/pesalink-press-release
- Competitor payout pricing: Paystack Kenya — https://paystack.com/ke/pricing ; Kopo Kopo —
  https://paymentgateways.org/gateway/kopokopo
- Pesapal gateway fees (1.5–3.5%) — https://www.kenzobe.com/blog/mpesa-website-integration