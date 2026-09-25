# Z-float presentations

| File | What it is |
|---|---|
| `Z-float-System-Overview.pptx` | **10-slide system presentation** covering the platform, payouts, receiving payments, KRA eTIMS, identity, controls, architecture and go-live. Speaker notes are included. |
| `Z-float-Pitch-Deck.pptx` | **12-slide pitch deck** for investors, partners and design customers: why now, problem, solution, product, customers, model, competition, readiness, roadmap and the ask. |
| `html/overview.html`, `html/pitch.html` | The same decks for the browser (open the file, then use print → PDF to export). |
| `assets/` | Product screenshots from the running sandbox build (demo tenant *Acme Traders Ltd*). |
| `build_decks.py` | Single source for both decks. Edit it, then rebuild. |

## Rebuild

```bash
pip install python-pptx pillow          # once
python3 presentation/build_decks.py     # writes both .pptx + html/
```

Slides are 16:9 (13.333 × 7.5 in) and use Calibri, so they open cleanly in
PowerPoint, Keynote and Google Slides.

## 10-slide system overview: outline

1. **Title**: Pay out. Get paid. Stay KRA-compliant.
2. **The problem**: scattered money tools, mandatory digital tax, phone numbers aren't identities
3. **The platform**: pay out · get paid · comply · control, plus the money-in flow
4. **Paying out**: single/bulk/scheduled payouts, maker-checker, ledger reservation
5. **Receiving payments (new)**: STK push, paybill/till routing, links, bank transfers
6. **KRA eTIMS (new)**: invoices, receipts, credit notes; how OSCU signing works
7. **Identity (new)**: ID number + KRA PIN everywhere, duplicate guard, one-box search
8. **Controls & trust**: double-entry, maker-checker, idempotency, outbox, immutability
9. **Architecture**: typed monorepo, adapters for Daraja / bank / KRA
10. **Go-live & roadmap**: KRA + Safaricom checklist, next features

## Sources for market figures (pitch deck, slide 2)

* M-Pesa FY2025: KES 38.29 trillion and 37.15 billion transactions. Safaricom PLC 2025 Annual Report, *Safaricom Kenya performance review*.
* 2.4 million M-Pesa merchants (0.9M Lipa na M-Pesa tills + 1.5M Pochi la Biashara). Safaricom H1 FY2026 results, Nov 2025.
* eTIMS: expenditure not supported by an eTIMS invoice is non-deductible, and the penalty for failing to issue one is double the tax due or KES 2M. Tax Procedures Act as amended by the Finance Act 2025 (s.23A); KRA income and expense validation from the 2025 accounting period.

The pricing on the business-model slide is a structure only. No price points
are claimed, and they should be validated with design partners.
