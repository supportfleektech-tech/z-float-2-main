# Receiving payments, KRA eTIMS and identity

This release adds three capabilities to Z-float:

1. **Collections**: receiving money, not only paying out.
2. **KRA eTIMS**: electronic tax invoices, receipts and credit notes, signed through an OSCU/VSCU device.
3. **Identity**: ID document number + KRA PIN on recipients, customers, payers and team members, not only phone numbers.

All three share one data model (migration `019_identity_etims_collections.sql`)
and plug into the existing ledger, outbox, webhooks and RBAC.

---

## 1. The end-to-end loop

```
 Tax invoice (INV-000123, signed by KRA)
        │  "Request payment" (STK push) ─ or ─ customer pays Paybill, account ACME-INV-000123
        ▼
 collections row  PENDING ──(Daraja callback / C2B confirmation)──► SUCCESS
        │  one DB transaction:
        │   • wallet credited + balanced funding journal (ledger)
        │   • invoice paidMinor / paymentStatus → PARTIAL | PAID
        │   • outbox: collection.received
        ▼
 outbox relay / worker
        │   • issueReceiptForCollection → eTIMS RECEIPT (signed)          if no invoice
        │                               → PAYMENT_RECEIPT (non-fiscal)    if paying a signed invoice
        │   • in-app notification  "Payment received … Receipt RCT-000045 (eTIMS signed)"
        │   • tenant webhooks: collection.received, invoice.fiscalised
        ▼
 Customer link /r/<token> (printable, KRA verification QR)
```

Why a *payment receipt* for invoice payments: VAT is declared once, on the
signed invoice. Signing a second fiscal receipt for the same sale would
double-declare it, so the payment gets a non-fiscal acknowledgement linked to
the invoice.

## 2. Collections (receiving money)

| Channel | How it starts | How it completes | Idempotency key |
|---|---|---|---|
| `MPESA_STK` | Portal "Request payment", invoice "Send prompt", `POST /api/collections` | Daraja STK callback on `/api/webhooks/mpesa` (correlated by `CheckoutRequestID`) | tenant + `Idempotency-Key` header; callback dedupe by provider event |
| `MPESA_C2B` | Customer pays Paybill/Till | `POST /api/webhooks/mpesa/c2b/confirmation` | `TransID` |
| `PAYMENT_LINK` | Hosted `/pay/<token>` page | Immediately (sandbox) | `paylink:<token>:<payerRef>` + atomic `useCount` claim |
| `BANK_TRANSFER` | Portal "Record bank transfer" (needs `reconciliation.manage`) | Immediately | `bank:<REFERENCE>` (case-insensitive) |

**Paybill account routing (C2B).** Each business sets an account reference
(Settings → eTIMS & collections), e.g. `ACME`. The payer types any of:

* `ACME`: credits the business
* `ACME-INV-000123` or `ACME#123`: credits the business **and** settles that invoice

Unknown references are rejected at **validation** (`C2B00012`, the payer is
refunded instantly by M-Pesa) when external validation is enabled on the
shortcode. If validation is off, the money is recorded as an **unmatched
reconciliation item** (`recon_items.source = MPESA_C2B`) and is never lost.
C2B callbacks are unsigned, so they are authenticated with
`?token=MPESA_C2B_CALLBACK_TOKEN` (constant-time compare). In production an
unset token rejects every callback.

**Correctness guarantees** (covered by `packages/payments-core/test/collections.integration.test.ts`):

* A collection is credited **at most once**. Settlement locks the row, and a replayed callback or second settle is a no-op.
* A success callback that arrives after the request was marked `FAILED`/`EXPIRED` still credits, because the money really moved.
* The ledger stays balanced (sum of debits = sum of credits) after every path.
* Payment links never exceed `maxUses` under concurrency.
* Limits: KES 1 to KES 250,000 per STK request (M-Pesa limits). The STK `Amount` is rounded up to whole shillings.
* Unanswered STK prompts are marked `EXPIRED` after 10 minutes by the worker cron.

**Sandbox.** With `PROVIDER_DEFAULT=local-sandbox`, STK requests return a
`ws_CO_MOCK_…` reference. Complete them with the *Simulate PIN / Cancel*
buttons on the Receive payments page (`POST /api/collections/:id/simulate`,
sandbox collections only), or by posting a Daraja-shaped callback to
`/api/webhooks/mpesa`.

## 3. KRA eTIMS

### Drivers (`ETIMS_DRIVER`)

| Driver | Use | Notes |
|---|---|---|
| `sandbox` (default) | Development, demos, CI | Local deterministic HMAC signer. Documents are flagged `sandbox=true` and watermarked **SANDBOX**. |
| `oscu` | Production and KRA sandbox certification | KRA Online Sales Control Unit JSON API: `https://etims-api-sbx.kra.go.ke/etims-api` (sandbox) or `https://etims-api.kra.go.ke/etims-api` (production). |
| `vscu` | High-volume sellers | Self-hosted KRA Virtual SCU jar (same API). Set `ETIMS_API_BASE_URL`. |
| `disabled` | eTIMS turned off | Documents can be drafted but not signed. |

`ETIMS_ENVIRONMENT=production` with the sandbox driver is refused at startup.

### Device lifecycle

1. The business applies for OSCU/VSCU on the KRA eTIMS portal / GavaConnect. KRA issues a **device serial** per branch (`bhfId`, `00` = head office).
2. Settings → eTIMS & collections → *Connect eTIMS* calls `selectInitOsdcInfo {tin, bhfId, dvcSrlNo}`. KRA returns the SCU ID, MRC number and **cmcKey**. The cmcKey is stored AES-GCM encrypted (`@zfloat/auth` `encryptSecret`) and sent as a header on later calls.
3. Each fiscal document goes to `saveTrnsSalesOsdc`. The KRA invoice number (`invcNo`) is allocated sequentially per device under a row lock. The response (`rcptNo`, `intrlData`, `rcptSign`, `sdcId`, `mrcNo`, `vsdcRcptPbctDate`) is stored, and the document becomes `SIGNED`.

### Documents

| Type | Number | Fiscal? | Created by |
|---|---|---|---|
| `INVOICE` | `INV-000001` | yes (`rcptTyCd S`) | Portal / `POST /api/invoices` |
| `RECEIPT` | `RCT-000001` | yes | Portal, or automatically for every collection not tied to an invoice (toggle *auto receipt*) |
| `CREDIT_NOTE` | `CRN-000001` | yes (`rcptTyCd R`, `orgInvcNo` = original) | `POST /api/invoices/:id/credit-note` |
| `PAYMENT_RECEIPT` | `PRC-000001` | no | Automatically when a collection pays a signed invoice |

**Tax.** KRA bands A (exempt), B (16% VAT), C (0%, zero-rated), D (non-VAT), and
E (8%) are computed per line in integer minor units. Prices can be entered
VAT-inclusive or VAT-exclusive. For inclusive prices, tax = taxable × rate / (100 + rate).

**Immutability.** A database trigger blocks any change to fiscal fields, and any
delete, once a document is `SIGNED`. Corrections are made with credit notes.

**Failures.** Transient KRA errors (timeout, 5xx) leave the document `QUEUED`.
The outbox (`etims.fiscalise_requested`) and a worker cron retry it
(`retryQueuedDocuments`). Rejections (non-`000` result codes) mark it `FAILED`
with the KRA message, for a human to fix and re-sign.

**Customer view.** Every document has a 96-bit public token:
`/r/<token>` (printable) and `/api/documents/<token>/qr`. For signed documents
the QR encodes the KRA verification URL built from `{tin}{bhfId}{rcptSign}`.

## 4. Identity

| Where | Fields |
|---|---|
| Recipients (`beneficiaries`) | `id_type`, `id_number`, `kra_pin` |
| Customers (new) | `id_type`, `id_number`, `kra_pin`, phone, email |
| Collections (payer snapshot) | `payer_id_type`, `payer_id_number`, `payer_kra_pin` |
| Team members (`users`) | `phone`, `id_type`, `id_number`, `kra_pin` (`PATCH /api/team/:id/identity`, audited; IDs masked in lists) |
| eTIMS documents (buyer snapshot) | `customer_kra_pin`, `customer_id_type`, `customer_id_number` |
| Business (`tenants`) | `kra_pin` |

Validation lives in `@zfloat/validation` (`normalizeIdentity`):

* ID types: `NATIONAL_ID` (6–8 digits), `ALIEN_ID`, `PASSPORT`, `MILITARY_ID`, `COMPANY_REG`.
* KRA PIN: `A` or `P` + 9 digits + letter (e.g. `A012345678Z` individual, `P051234567Q` business). Input is upper-cased and stripped of spaces/dashes.
* Duplicate guard: creating a recipient or customer whose KRA PIN or ID number already exists returns `409 DUPLICATE_IDENTITY`.
* One search box (`?q=`) on recipients and customers is classified as phone, KRA PIN, ID number or free text (`classifyIdentityQuery`).

## 5. API summary

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /api/collections?status&channel&q` | signed in | List + 30-day stats |
| `POST /api/collections` | `collections.manage` | STK request-to-pay (`Idempotency-Key` header) |
| `POST /api/collections/bank` | `reconciliation.manage` | Record a bank transfer |
| `POST /api/collections/:id/simulate` | `collections.manage` | Sandbox only |
| `GET/POST /api/customers` | signed in / `collections.manage` | Customers |
| `GET/POST /api/invoices` | signed in / `invoices.manage` | Documents; `fiscalise: true` signs immediately |
| `GET /api/invoices/:id` | signed in | Document + payments |
| `POST /api/invoices/:id/fiscalise` | `invoices.manage` | Sign / retry |
| `POST /api/invoices/:id/credit-note` | `invoices.manage` | Reverse a signed document |
| `POST /api/invoices/:id/request-payment` | `collections.manage` | STK for the outstanding balance |
| `GET/PUT/PATCH /api/etims/device` | signed in / `settings.manage` | Device + paybill account reference |
| `GET /api/documents/:token` (+ `/qr`) | public, rate-limited | Customer view |
| `POST /api/webhooks/mpesa` | Daraja | B2C **and** STK callbacks |
| `POST /api/webhooks/mpesa/c2b/{validation,confirmation}` | Daraja + token | Paybill/Till |

New outbound webhook events: `collection.received`, `collection.failed`, `invoice.fiscalised`.

Roles: `collections.manage` goes to Owner, Finance manager, Maker and Branch
manager. `invoices.manage` goes to Owner, Finance manager, Accountant and
Branch manager.

## 6. Going live

1. **KRA**: apply for OSCU (or VSCU) and obtain the device serial. Run KRA's sandbox test cases with `ETIMS_DRIVER=oscu ETIMS_ENVIRONMENT=sandbox`.
2. Replace the placeholder item classification code (`99000000`) with real codes from `selectItemClsList` (see KNOWN_LIMITATIONS).
3. **Safaricom**: add *Lipa na M-Pesa Online* (STK) and *C2B* to the production app. Set `MPESA_PASSKEY`, `MPESA_SHORTCODE`, `MPESA_CALLBACK_BASE_URL` and `MPESA_C2B_CALLBACK_TOKEN`. Register the C2B URLs once with `MpesaProviderAdapter.registerC2BUrls()`, which registers `/api/webhooks/mpesa/c2b/{validation,confirmation}?token=…`. Ask Safaricom to enable external validation if you want unknown account numbers rejected.
4. Set `ETIMS_DRIVER=oscu ETIMS_ENVIRONMENT=production`, then connect each branch device from the portal.
