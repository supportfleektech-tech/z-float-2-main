/**
 * eTIMS tax engine — bigint minor units only (never floats).
 *
 * KRA taxation-type codes (eTIMS code class "Taxation Type"):
 *   A  Exempt            0%
 *   B  Standard VAT     16%
 *   C  Zero-rated        0%   (exports, zero-rated supplies)
 *   D  Non-VAT           0%   (outside the scope of VAT)
 *   E  Reduced VAT       8%   (e.g. petroleum products)
 *
 * eTIMS amounts are TAX-INCLUSIVE: `taxblAmt` is the VAT-inclusive supply and
 * `taxAmt = taxblAmt × rate / (100 + rate)`. Businesses often quote prices
 * VAT-exclusive, so a document can be priced either way; everything is
 * normalised to inclusive amounts before it reaches KRA.
 */

export const TAX_TYPES = ["A", "B", "C", "D", "E"] as const;
export type TaxType = (typeof TAX_TYPES)[number];

export const TAX_RATES: Record<TaxType, bigint> = { A: 0n, B: 16n, C: 0n, D: 0n, E: 8n };

export const TAX_LABELS: Record<TaxType, string> = {
  A: "A · Exempt (0%)",
  B: "B · VAT 16%",
  C: "C · Zero-rated (0%)",
  D: "D · Non-VAT",
  E: "E · VAT 8%",
};

export function isTaxType(v: unknown): v is TaxType {
  return typeof v === "string" && (TAX_TYPES as readonly string[]).includes(v);
}

/** Round-half-up integer division for non-negative bigints. */
function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("division by zero");
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (a * 2n + d) / (2n * d);
  return neg ? -q : q;
}

export interface LineInput {
  description: string;
  /** Quantity in thousandths (1 unit = 1000) — supports 0.5 kg, 2.25 hrs … */
  qtyMilli: bigint;
  unitPriceMinor: bigint;
  discountMinor?: bigint;
  taxType: TaxType;
  itemCode?: string;
  itemClassCode?: string;
  unitCode?: string;
}

export interface ComputedLine {
  seq: number;
  description: string;
  qtyMilli: string;
  unitPriceMinor: string;
  discountMinor: string;
  taxType: TaxType;
  taxRate: string;
  /** Supply amount before discount (qty × price, in the document's pricing basis). */
  supplyMinor: string;
  /** VAT-inclusive taxable amount (KRA taxblAmt). */
  taxableMinor: string;
  taxMinor: string;
  /** Line total, VAT inclusive. */
  totalMinor: string;
  /** Line total excluding VAT. */
  netMinor: string;
  itemCode: string;
  itemClassCode: string;
  unitCode: string;
}

export interface TaxBucket {
  rate: string;
  taxableMinor: string;
  taxMinor: string;
}

export interface ComputedDocument {
  lines: ComputedLine[];
  taxSummary: Record<TaxType, TaxBucket>;
  subtotalMinor: bigint; // excl. VAT
  taxMinor: bigint;
  totalMinor: bigint; // incl. VAT
}

/** Placeholder item classification — replace with codes from selectItemClsList for production. */
export const DEFAULT_ITEM_CLASS_CODE = "99000000";

export class TaxComputationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxComputationError";
  }
}

export function computeDocument(inputs: LineInput[], opts: { pricesIncludeTax: boolean }): ComputedDocument {
  if (inputs.length === 0) throw new TaxComputationError("A document needs at least one line");
  if (inputs.length > 200) throw new TaxComputationError("A document may have at most 200 lines");
  const summary = Object.fromEntries(
    TAX_TYPES.map((t) => [t, { rate: TAX_RATES[t].toString(), taxableMinor: "0", taxMinor: "0" }]),
  ) as Record<TaxType, TaxBucket>;
  let subtotal = 0n;
  let tax = 0n;
  let total = 0n;

  const lines = inputs.map((l, i): ComputedLine => {
    if (!l.description?.trim()) throw new TaxComputationError(`Line ${i + 1}: description is required`);
    if (l.qtyMilli <= 0n) throw new TaxComputationError(`Line ${i + 1}: quantity must be positive`);
    if (l.unitPriceMinor < 0n) throw new TaxComputationError(`Line ${i + 1}: price cannot be negative`);
    if (!isTaxType(l.taxType)) throw new TaxComputationError(`Line ${i + 1}: unknown tax type`);
    const discount = l.discountMinor ?? 0n;
    const supply = divRound(l.unitPriceMinor * l.qtyMilli, 1000n);
    if (discount < 0n || discount > supply) throw new TaxComputationError(`Line ${i + 1}: invalid discount`);
    const net = supply - discount;
    const rate = TAX_RATES[l.taxType];
    let lineTax: bigint;
    let lineTotal: bigint;
    if (opts.pricesIncludeTax) {
      lineTotal = net;
      lineTax = rate === 0n ? 0n : divRound(net * rate, 100n + rate);
    } else {
      lineTax = rate === 0n ? 0n : divRound(net * rate, 100n);
      lineTotal = net + lineTax;
    }
    const lineNet = lineTotal - lineTax;
    const b = summary[l.taxType];
    b.taxableMinor = (BigInt(b.taxableMinor) + lineTotal).toString();
    b.taxMinor = (BigInt(b.taxMinor) + lineTax).toString();
    subtotal += lineNet;
    tax += lineTax;
    total += lineTotal;
    return {
      seq: i + 1,
      description: l.description.trim().slice(0, 200),
      qtyMilli: l.qtyMilli.toString(),
      unitPriceMinor: l.unitPriceMinor.toString(),
      discountMinor: discount.toString(),
      taxType: l.taxType,
      taxRate: rate.toString(),
      supplyMinor: supply.toString(),
      taxableMinor: lineTotal.toString(),
      taxMinor: lineTax.toString(),
      totalMinor: lineTotal.toString(),
      netMinor: lineNet.toString(),
      itemCode: l.itemCode ?? `KE2NTU${String(i + 1).padStart(7, "0")}`,
      itemClassCode: l.itemClassCode ?? DEFAULT_ITEM_CLASS_CODE,
      unitCode: l.unitCode ?? "U",
    };
  });
  if (total <= 0n) throw new TaxComputationError("Document total must be greater than zero");
  return { lines, taxSummary: summary, subtotalMinor: subtotal, taxMinor: tax, totalMinor: total };
}

/** Parse a quantity like "2", "0.5", "1.125" into thousandths without floats. */
export function parseQtyMilli(raw: string | number): bigint {
  const s = String(raw).trim();
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(s)) throw new TaxComputationError(`Invalid quantity "${s}"`);
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole) * 1000n + BigInt((frac + "000").slice(0, 3));
}

/** minor → KES decimal number for the KRA JSON wire format (2 dp). */
export function minorToKes(minor: bigint | string): number {
  const m = BigInt(minor);
  const neg = m < 0n;
  const a = neg ? -m : m;
  const s = `${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
  return Number(neg ? `-${s}` : s);
}

export function milliToQty(milli: bigint | string): number {
  const m = BigInt(milli);
  return Number(`${m / 1000n}.${(m % 1000n).toString().padStart(3, "0")}`);
}
