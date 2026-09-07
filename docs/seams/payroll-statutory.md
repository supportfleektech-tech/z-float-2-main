# Requirements — Payroll statutory deductions (PAYE/NSSF/SHIF) (Phase 10) — doc only

Z-float's payroll module computes salary runs; statutory deductions must follow
**authoritative, dated rate tables** and cannot be hard-coded from training
data. No implementation is attempted without a maintained source.

## Requirements under consideration
1. **PAYE**: progressive bands + personal relief per the Finance Act in force;
   needs a dated rates table + employer PAYE registration number per tenant.
2. **NSSF**: Tier I/II ceilings + contribution rates (subject to the current
   statutory regime; the 2013 Act rates were later contested/changed — exactly
   why hard-coding is wrong).
3. **SHIF** (Social Health Insurance Fund, successor to NHIF): contribution
   rates defined by the Social Health Insurance Act regime — requires the
   authoritative current schedule.

## Shape (if/when a rates source is approved)
- `payroll/src/statutory.ts`: pure calculators taking `(grossPay, bands,
  reliefs)` where bands/reliefs come from a dated `statutory_rates` table
  maintained by platform ops with an audit trail + effective_from/effective_to.
- Remittance: generation of PAYE/NSSF/SHIF payment batches (existing batch
  engine) + filing output; NOT automatic — employer reviews and submits.

## Blockers / decisions
- Authoritative rates source + update process (platform ops responsibility).
- Per-tenant registration numbers + exemption handling.
- Payroll run → statutory computation → remittance approvals (maker-checker).
