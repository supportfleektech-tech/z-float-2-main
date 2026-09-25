/**
 * KRA OSCU/VSCU wire format — TrnsSalesSaveWrReq (url: /saveTrnsSalesOsdc),
 * per the OSCU Specification Document v2.0 §3.3.6.1. Field names are KRA's.
 */
import { TAX_TYPES, TAX_RATES, minorToKes, milliToQty, type ComputedLine, type TaxBucket, type TaxType } from "./tax.js";

/** KRA payment type codes (pmtTyCd). */
export const PAYMENT_TYPE_CODES = {
  CASH: "01",
  CREDIT: "02",
  CASH_CREDIT: "03",
  BANK_CHECK: "04",
  CARD: "05",
  MOBILE_MONEY: "06",
  OTHER: "07",
} as const;

/** KRA receipt type codes (rcptTyCd): S = sale, R = credit note / refund. */
export const RECEIPT_TYPE = { SALE: "S", CREDIT_NOTE: "R" } as const;

/** KRA sales type codes (salesTyCd): N = normal, T = training, P = proforma, C = copy. */
export const SALES_TYPE = { NORMAL: "N", TRAINING: "T", PROFORMA: "P", COPY: "C" } as const;

/** KRA transaction progress (salesSttsCd): 02 = approved. */
export const SALES_STATUS_APPROVED = "02";

export interface SalesDocumentForKra {
  invoiceNo: number;
  originalInvoiceNo?: number | null;
  traderInvoiceNo: string; // our human number, e.g. INV-000123
  kind: "SALE" | "CREDIT_NOTE";
  customerKraPin?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  paymentTypeCode: string;
  issuedAt: Date;
  lines: ComputedLine[];
  taxSummary: Record<TaxType, TaxBucket>;
  totalTaxableMinor: bigint;
  totalTaxMinor: bigint;
  totalMinor: bigint;
  remark?: string | null;
  registeredBy: { id: string; name: string };
  tradeName?: string | null;
}

export function kraDateTime(d: Date): string {
  // yyyyMMddHHmmss in East Africa Time (UTC+3, no DST) — KRA timestamps are local.
  const eat = new Date(d.getTime() + 3 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${eat.getUTCFullYear()}${p(eat.getUTCMonth() + 1)}${p(eat.getUTCDate())}${p(eat.getUTCHours())}${p(eat.getUTCMinutes())}${p(eat.getUTCSeconds())}`;
}

export function kraDate(d: Date): string {
  return kraDateTime(d).slice(0, 8);
}

export function buildSalesPayload(tin: string, bhfId: string, doc: SalesDocumentForKra): Record<string, unknown> {
  const dt = kraDateTime(doc.issuedAt);
  const taxFields: Record<string, number> = {};
  for (const t of TAX_TYPES) {
    const b = doc.taxSummary[t];
    taxFields[`taxblAmt${t}`] = minorToKes(b?.taxableMinor ?? "0");
    taxFields[`taxRt${t}`] = Number(TAX_RATES[t]);
    taxFields[`taxAmt${t}`] = minorToKes(b?.taxMinor ?? "0");
  }
  return {
    tin,
    bhfId,
    trdInvcNo: doc.traderInvoiceNo,
    invcNo: doc.invoiceNo,
    orgInvcNo: doc.originalInvoiceNo ?? 0,
    custTin: doc.customerKraPin ?? null,
    custNm: doc.customerName ?? null,
    salesTyCd: SALES_TYPE.NORMAL,
    rcptTyCd: doc.kind === "CREDIT_NOTE" ? RECEIPT_TYPE.CREDIT_NOTE : RECEIPT_TYPE.SALE,
    pmtTyCd: doc.paymentTypeCode,
    salesSttsCd: SALES_STATUS_APPROVED,
    cfmDt: dt,
    salesDt: dt.slice(0, 8),
    stockRlsDt: dt,
    cnclReqDt: null,
    cnclDt: null,
    rfdDt: doc.kind === "CREDIT_NOTE" ? dt : null,
    rfdRsnCd: doc.kind === "CREDIT_NOTE" ? "06" : null,
    totItemCnt: doc.lines.length,
    ...taxFields,
    totTaxblAmt: minorToKes(doc.totalTaxableMinor),
    totTaxAmt: minorToKes(doc.totalTaxMinor),
    totAmt: minorToKes(doc.totalMinor),
    prchrAcptcYn: "N",
    remark: doc.remark ?? null,
    regrId: doc.registeredBy.id.slice(0, 20),
    regrNm: doc.registeredBy.name.slice(0, 60),
    modrId: doc.registeredBy.id.slice(0, 20),
    modrNm: doc.registeredBy.name.slice(0, 60),
    receipt: {
      custTin: doc.customerKraPin ?? null,
      custMblNo: doc.customerPhone ?? null,
      rptNo: null,
      rcptPbctDt: dt,
      trdeNm: doc.tradeName ?? null,
      adrs: null,
      topMsg: null,
      btmMsg: "Powered by Z-float",
      prchrAcptcYn: "N",
    },
    itemList: doc.lines.map((l) => ({
      itemSeq: l.seq,
      itemCd: l.itemCode,
      itemClsCd: l.itemClassCode,
      itemNm: l.description,
      bcd: null,
      pkgUnitCd: "NT",
      pkg: milliToQty(l.qtyMilli),
      qtyUnitCd: l.unitCode,
      qty: milliToQty(l.qtyMilli),
      prc: minorToKes(BigInt(l.supplyMinor) === 0n ? "0" : l.unitPriceMinor),
      splyAmt: minorToKes(l.supplyMinor),
      dcRt: 0,
      dcAmt: minorToKes(l.discountMinor),
      isrccCd: null,
      isrccNm: null,
      isrcRt: null,
      isrcAmt: null,
      taxTyCd: l.taxType,
      taxblAmt: minorToKes(l.taxableMinor),
      taxAmt: minorToKes(l.taxMinor),
      totAmt: minorToKes(l.totalMinor),
    })),
  };
}

/** KRA receipt-verification link encoded into the invoice QR code. */
export function buildVerificationUrl(environment: "sandbox" | "production", tin: string, bhfId: string, rcptSign: string): string {
  const portal = environment === "production" ? "https://etims.kra.go.ke" : "https://etims-sbx.kra.go.ke";
  return `${portal}/common/link/etims/receipt/indexEtimsReceiptData?Data=${encodeURIComponent(`${tin}${bhfId}${rcptSign}`)}`;
}
