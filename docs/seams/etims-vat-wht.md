# Requirements — eTIMS / VAT invoicing + withholding tax (Phase 10) — adapter seam only

Kenya eTIMS (KRA) integration requires an OAuth/API credential + registered
taxpayer profile per tenant; WHT rates/posting rules change with Finance Acts.
No implementation is attempted; this is the requirements + seam doc.

## Requirements under consideration
1. **eTIMS invoicing**: every invoiceable payment (or selected products) yields
   a compliant eTIMS invoice (KRA QR + control number). VAT is a presentation
   concern of the tenant's own invoicing; Z-float would POST invoice payloads to
   the KRA eTIMS API (adapter seam, driver-per-tenant like EMAIL/SMS drivers),
   store the returned control number/QR, and re-issue on failure with backoff.
2. **Withholding tax (WHT)**: statutory deduction rates (service contracts,
   rent, professional fees) applied at payment time, remitted periodically.
   Z-float would only implement this via an authoritative, dated rates table
   maintained by platform ops — never hard-coded by default.

## Adapter seam shape (mirror providers pattern)
```ts
interface EtimsAdapter { submitInvoice(inv): Promise<{ controlNumber, qr, errors }>; }
interface WhtRatesSource { ratesAsOf(date): Promise<WhtRate[]>; } // authoritative, dated
```

## Open decisions
- Which tenant products are eTIMS-mandatory vs exempt?
- VAT handling for fees vs gross proceeds.
- WHT exemption certificates (per-tenant, per-payee) workflow.
- KRA sandbox (pre-production) availability before any live wiring.
