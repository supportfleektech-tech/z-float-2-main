"use client";
/**
 * Printable eTIMS invoice / receipt / credit note. Carries the fields KRA
 * requires on a fiscal document printout: seller + buyer PIN, per-line tax
 * category, A–E tax summary, CU invoice number, receipt signature, SCU ID,
 * MRC number, date/time and the verification QR.
 */
import { formatKESExact } from "@/lib/money";

export interface DocLine {
  seq: number;
  description: string;
  qtyMilli: string;
  unitPriceMinor: string;
  discountMinor: string;
  taxType: string;
  taxMinor: string;
  totalMinor: string;
}

export interface DocView {
  docType: string;
  number: string;
  status: string;
  paymentStatus?: string;
  issuedAt: string;
  seller: { name: string; kraPin: string | null };
  customer: { name: string | null; kraPin: string | null };
  lines: DocLine[];
  taxSummary: Record<string, { rate: string; taxableMinor: string; taxMinor: string }>;
  subtotalMinor: string;
  taxMinor: string;
  totalMinor: string;
  paidMinor?: string;
  etims: {
    cuInvoiceNo: string | null;
    receiptSignature: string | null;
    sdcId: string | null;
    mrcNo: string | null;
    invoiceNo: number | null;
    verificationUrl: string | null;
  };
  notes?: string | null;
  sandbox?: boolean;
  qrSrc?: string;
}

export const DOC_TITLE: Record<string, string> = {
  INVOICE: "Tax invoice",
  RECEIPT: "Receipt",
  CREDIT_NOTE: "Credit note",
  PAYMENT_RECEIPT: "Payment receipt",
};

const TAX_LABEL: Record<string, string> = { A: "A-Exempt", B: "B-16%", C: "C-0%", D: "D-Non-VAT", E: "E-8%" };

function qty(milli: string) {
  const n = Number(milli) / 1000;
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "");
}

export function EtimsDocumentView({ doc }: { doc: DocView }) {
  const signed = doc.status === "SIGNED";
  const buckets = Object.entries(doc.taxSummary ?? {}).filter(([, b]) => b && (b.taxableMinor !== "0" || b.taxMinor !== "0"));
  return (
    <article className="relative mx-auto max-w-2xl rounded-card border border-borderline bg-white p-6 text-sm print:border-0 print:p-0">
      {doc.sandbox && signed ? (
        <div className="mb-3 rounded-control bg-warning/10 px-3 py-1 text-center text-xs font-semibold text-warning">
          SANDBOX — signed by the eTIMS test signer, not valid for tax purposes
        </div>
      ) : null}
      <header className="flex items-start justify-between gap-4 border-b border-borderline pb-4">
        <div>
          <p className="text-lg font-semibold">{doc.seller.name}</p>
          {doc.seller.kraPin ? <p className="text-xs text-muted">PIN: <span className="font-mono">{doc.seller.kraPin}</span></p> : null}
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-muted">{DOC_TITLE[doc.docType] ?? doc.docType}</p>
          <p className="font-mono text-base font-semibold">{doc.number}</p>
          <p className="text-xs text-muted">{new Date(doc.issuedAt).toLocaleString("en-KE")}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 border-b border-borderline py-3 text-xs">
        <div>
          <p className="text-muted">Buyer</p>
          <p className="font-medium">{doc.customer.name || "Walk-in customer"}</p>
          {doc.customer.kraPin ? <p>PIN: <span className="font-mono">{doc.customer.kraPin}</span></p> : null}
        </div>
        {doc.paymentStatus && doc.docType === "INVOICE" ? (
          <div className="text-right">
            <p className="text-muted">Payment</p>
            <p className="font-medium">{doc.paymentStatus}</p>
            {doc.paidMinor && doc.paidMinor !== "0" ? <p>Paid KES {formatKESExact(doc.paidMinor)}</p> : null}
          </div>
        ) : null}
      </section>

      <table className="my-3 w-full text-xs">
        <thead>
          <tr className="border-b border-borderline text-left text-muted">
            <th className="py-1.5">Item</th>
            <th className="py-1.5 text-right">Qty</th>
            <th className="py-1.5 text-right">Price</th>
            <th className="py-1.5 text-right">Tax</th>
            <th className="py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(doc.lines ?? []).map((l) => (
            <tr key={l.seq} className="border-b border-borderline/60">
              <td className="py-1.5">{l.description}</td>
              <td className="py-1.5 text-right">{qty(l.qtyMilli)}</td>
              <td className="py-1.5 text-right">{formatKESExact(l.unitPriceMinor)}</td>
              <td className="py-1.5 text-right">{TAX_LABEL[l.taxType] ?? l.taxType}</td>
              <td className="py-1.5 text-right">{formatKESExact(l.totalMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="ml-auto w-64 space-y-1 text-xs">
        <div className="flex justify-between"><span className="text-muted">Total before tax</span><span>{formatKESExact(doc.subtotalMinor)}</span></div>
        {buckets.map(([k, b]) => (
          <div key={k} className="flex justify-between">
            <span className="text-muted">{TAX_LABEL[k] ?? k} on {formatKESExact(b.taxableMinor)}</span>
            <span>{formatKESExact(b.taxMinor)}</span>
          </div>
        ))}
        <div className="flex justify-between"><span className="text-muted">Total tax</span><span>{formatKESExact(doc.taxMinor)}</span></div>
        <div className="flex justify-between border-t border-borderline pt-1 text-sm font-semibold">
          <span>Total (KES)</span>
          <span>{formatKESExact(doc.totalMinor)}</span>
        </div>
      </section>

      {doc.notes ? <p className="mt-3 whitespace-pre-line text-xs text-muted">{doc.notes}</p> : null}

      <footer className="mt-4 flex items-end justify-between gap-4 border-t border-borderline pt-3 text-[11px]">
        {signed ? (
          <div className="space-y-0.5 font-mono">
            <p className="font-sans text-xs font-semibold">KRA eTIMS</p>
            <p>CU invoice no: {doc.etims.cuInvoiceNo}</p>
            <p>Invoice no: {doc.etims.invoiceNo}</p>
            <p>SCU ID: {doc.etims.sdcId}</p>
            <p>MRC no: {doc.etims.mrcNo}</p>
            <p>Signature: {doc.etims.receiptSignature}</p>
            {doc.etims.verificationUrl ? (
              <a href={doc.etims.verificationUrl} target="_blank" rel="noreferrer" className="font-sans text-primary hover:underline">
                Verify on KRA eTIMS
              </a>
            ) : null}
          </div>
        ) : (
          <p className="text-muted">
            {doc.docType === "PAYMENT_RECEIPT"
              ? "Acknowledgement of payment against the tax invoice above — VAT was declared on the invoice."
              : "Not yet signed by KRA eTIMS."}
          </p>
        )}
        {doc.qrSrc && signed ? <img src={doc.qrSrc} alt="KRA verification QR" width={96} height={96} className="h-24 w-24" /> : null}
      </footer>
    </article>
  );
}
