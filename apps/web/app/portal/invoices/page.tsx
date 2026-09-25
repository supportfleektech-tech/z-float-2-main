"use client";
/**
 * eTIMS invoices & receipts: create tax invoices/receipts, sign them with
 * KRA (OSCU/VSCU), request payment, issue credit notes, share/print.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, Card, Button, Input, Label, TableShell, Badge, Skeleton, Modal, Spinner, EmptyState, Tabs } from "@/components/ui";
import { IdentityFields, EMPTY_IDENTITY, type IdentityValue } from "@/components/identity-fields";
import { EtimsDocumentView, DOC_TITLE, type DocView } from "@/components/etims-document";
import { formatKES, formatKESExact } from "@/lib/money";

interface DocRow {
  id: string;
  docType: string;
  number: string;
  status: string;
  paymentStatus: string;
  customerName: string | null;
  customerPhone: string | null;
  customerKraPin: string | null;
  totalMinor: string;
  paidMinor: string;
  taxMinor: string;
  subtotalMinor: string;
  lines: DocView["lines"];
  taxSummary: DocView["taxSummary"];
  cuInvoiceNo: string | null;
  receiptSignature: string | null;
  sdcId: string | null;
  mrcNo: string | null;
  invoiceNo: number | null;
  verificationUrl: string | null;
  lastError: string | null;
  signedAt: string | null;
  createdAt: string;
  notes: string | null;
  sandbox: boolean;
  publicToken: string;
  originalDocumentId: string | null;
}

interface Device {
  status: string;
  kraPin: string;
  driver: string;
  lastInvoiceNo: number;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  kraPin: string | null;
}

interface LineForm {
  description: string;
  qty: string;
  unitPrice: string;
  taxType: string;
}

const TABS = ["All", "Invoices", "Receipts", "Credit notes", "Payment receipts"];
const TAB_TYPE: Record<string, string> = { Invoices: "INVOICE", Receipts: "RECEIPT", "Credit notes": "CREDIT_NOTE", "Payment receipts": "PAYMENT_RECEIPT" };
const RATE: Record<string, number> = { A: 0, B: 16, C: 0, D: 0, E: 8 };
const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  SIGNED: "success",
  ISSUED: "info",
  QUEUED: "warning",
  DRAFT: "neutral",
  FAILED: "danger",
  CANCELLED: "neutral",
};
const PAY_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { PAID: "success", PARTIAL: "warning", UNPAID: "danger" };
const EMPTY_LINE: LineForm = { description: "", qty: "1", unitPrice: "", taxType: "B" };

function toCents(v: string): number {
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Client-side preview only — the server recomputes with exact integer maths. */
function previewTotals(lines: LineForm[], inclusive: boolean) {
  let net = 0;
  let tax = 0;
  for (const l of lines) {
    const gross = Math.round((Number(l.qty) || 0) * toCents(l.unitPrice));
    const r = RATE[l.taxType] ?? 0;
    if (inclusive) {
      const t = Math.round((gross * r) / (100 + r));
      tax += t;
      net += gross - t;
    } else {
      const t = Math.round((gross * r) / 100);
      tax += t;
      net += gross;
    }
  }
  return { net, tax, total: net + tax };
}

export default function InvoicesPage() {
  const [tab, setTab] = useState("All");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [createOpen, setCreateOpen] = useState<null | "INVOICE" | "RECEIPT">(null);
  const [customerId, setCustomerId] = useState("");
  const [cust, setCust] = useState({ name: "", phone: "" });
  const [identity, setIdentity] = useState<IdentityValue>(EMPTY_IDENTITY);
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }]);
  const [inclusive, setInclusive] = useState(true);
  const [signNow, setSignNow] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<DocRow | null>(null);
  const [sellerName, setSellerName] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [payPhone, setPayPhone] = useState("");

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (TAB_TYPE[tab]) p.set("type", TAB_TYPE[tab]!);
    if (q) p.set("q", q);
    fetch(`/api/invoices?${p}`)
      .then((r) => r.json())
      .then((d) => {
        setRows(d.data ?? []);
        setDevice(d.device ?? null);
      })
      .catch(() => setRows([]));
  }, [tab, q]);

  useEffect(load, [tab]);
  useEffect(() => {
    fetch("/api/customers").then((r) => r.json()).then((d) => setCustomers(d.data ?? [])).catch(() => undefined);
    fetch("/api/etims/device")
      .then((r) => r.json())
      .then((d) => setSellerName(d.tenantName ?? ""))
      .catch(() => undefined);
  }, []);
  // Deep link from Receive payments: /portal/invoices?open=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (!id) return;
    fetch(`/api/invoices/${id}`).then((r) => r.json()).then((d) => d.data && setOpenDoc(d.data)).catch(() => undefined);
  }, []);

  const totals = useMemo(() => previewTotals(lines, inclusive), [lines, inclusive]);

  function resetForm() {
    setCustomerId("");
    setCust({ name: "", phone: "" });
    setIdentity(EMPTY_IDENTITY);
    setLines([{ ...EMPTY_LINE }]);
    setNotes("");
    setError(null);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!createOpen) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: createOpen,
          customerId: customerId || undefined,
          customer: customerId ? undefined : { ...cust, ...identity },
          lines,
          pricesIncludeTax: inclusive,
          fiscalise: signNow,
          notes: notes || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Could not create");
        return;
      }
      setCreateOpen(null);
      resetForm();
      setNotice(
        d.fiscaliseError
          ? `${d.data.number} saved, but not signed yet: ${d.fiscaliseError}`
          : d.data.status === "SIGNED"
            ? `${d.data.number} signed by KRA eTIMS (CU ${d.data.cuInvoiceNo}).`
            : `${d.data.number} saved as draft.`,
      );
      load();
      setOpenDoc(d.data);
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  async function action(url: string, body: unknown, ok: (d: { data: DocRow }) => string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body ?? {}),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Failed");
        return null;
      }
      setNotice(d.fiscaliseError ? `Saved, not signed yet: ${d.fiscaliseError}` : ok(d));
      load();
      return d;
    } catch {
      setError("Network error — try again");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function toView(r: DocRow): DocView {
    return {
      docType: r.docType,
      number: r.number,
      status: r.status,
      paymentStatus: r.paymentStatus,
      issuedAt: r.signedAt ?? r.createdAt,
      seller: { name: sellerName || "Your business", kraPin: device?.kraPin ?? null },
      customer: { name: r.customerName, kraPin: r.customerKraPin },
      lines: r.lines,
      taxSummary: r.taxSummary,
      subtotalMinor: r.subtotalMinor,
      taxMinor: r.taxMinor,
      totalMinor: r.totalMinor,
      paidMinor: r.paidMinor,
      etims: {
        cuInvoiceNo: r.cuInvoiceNo,
        receiptSignature: r.receiptSignature,
        sdcId: r.sdcId,
        mrcNo: r.mrcNo,
        invoiceNo: r.invoiceNo,
        verificationUrl: r.verificationUrl,
      },
      notes: r.notes,
      sandbox: r.sandbox,
      qrSrc: `/api/documents/${r.publicToken}/qr`,
    };
  }

  const publicUrl = (r: DocRow) => `${typeof window !== "undefined" ? window.location.origin : ""}/r/${r.publicToken}`;

  return (
    <div>
      <PageHeader
        title="eTIMS invoices & receipts"
        subtitle="KRA-compliant electronic tax invoices, receipts and credit notes — signed through your eTIMS device and linked to the payments that settle them."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { resetForm(); setCreateOpen("RECEIPT"); }}>New receipt</Button>
            <Button onClick={() => { resetForm(); setCreateOpen("INVOICE"); }}>+ New invoice</Button>
          </div>
        }
      />

      {device === null ? (
        <Card className="mb-4 border-warning/40 bg-warning/5 p-4 text-sm">
          <b>eTIMS not connected.</b> You can draft documents, but KRA signing needs your OSCU/VSCU device.{" "}
          <a href="/portal/settings/etims" className="text-primary hover:underline">Connect eTIMS →</a>
        </Card>
      ) : device ? (
        <p className="mb-4 text-xs text-muted">
          eTIMS device <span className="font-mono">{device.kraPin}</span> · {device.driver.toUpperCase()} ·{" "}
          <Badge tone={device.status === "ACTIVE" ? "success" : "danger"}>{device.status}</Badge> · last KRA invoice no. {device.lastInvoiceNo}
        </p>
      ) : null}

      {notice ? (
        <div className="mb-4 flex items-center justify-between rounded-control border border-success/40 bg-success/5 px-4 py-2 text-sm text-success">
          <span>{notice}</span>
          <button className="text-xs underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      ) : null}
      {error && !createOpen ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); load(); }}>
          <Input aria-label="Search documents" placeholder="Number, customer, KRA PIN, CU no…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
      </div>

      {!rows ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No documents yet" description="Create an invoice, or receive a payment — receipts are issued automatically." />
      ) : (
        <TableShell headers={["Document", "Customer", "Total", "VAT", "KRA status", "Payment", ""]}>
          {rows.map((r) => (
            <tr key={r.id} data-doc-id={r.id} className="cursor-pointer hover:bg-surface/60" onClick={() => setOpenDoc(r)}>
              <td className="px-4 py-3">
                <p className="font-mono text-sm font-medium">{r.number}</p>
                <p className="text-xs text-muted">{DOC_TITLE[r.docType]} · {new Date(r.createdAt).toLocaleDateString("en-KE")}</p>
              </td>
              <td className="px-4 py-3">
                <p className="text-sm">{r.customerName ?? "Walk-in"}</p>
                {r.customerKraPin ? <p className="font-mono text-xs text-muted">{r.customerKraPin}</p> : null}
              </td>
              <td className="px-4 py-3 font-medium">{formatKES(r.totalMinor)}</td>
              <td className="px-4 py-3 text-xs text-muted">{formatKESExact(r.taxMinor)}</td>
              <td className="px-4 py-3">
                <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                {r.cuInvoiceNo ? <p className="mt-1 font-mono text-[10px] text-muted">{r.cuInvoiceNo}</p> : null}
                {r.status === "FAILED" && r.lastError ? <p className="mt-1 max-w-40 truncate text-xs text-danger" title={r.lastError}>{r.lastError}</p> : null}
              </td>
              <td className="px-4 py-3">
                {r.docType === "INVOICE" ? <Badge tone={PAY_TONE[r.paymentStatus] ?? "neutral"}>{r.paymentStatus}</Badge> : <span className="text-xs text-muted">—</span>}
              </td>
              <td className="px-4 py-3 text-right text-xs text-primary">View</td>
            </tr>
          ))}
        </TableShell>
      )}

      {/* ---------- create ---------- */}
      <Modal open={!!createOpen} onClose={() => setCreateOpen(null)} title={createOpen === "RECEIPT" ? "New receipt (paid now)" : "New tax invoice"}>
        <form onSubmit={create} className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
          <div>
            <Label htmlFor="inv-customer">Customer</Label>
            <select
              id="inv-customer"
              className="focus-ring w-full rounded-control border border-borderline bg-white px-3 py-2.5 text-sm"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">— Type customer details below —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.kraPin ? ` · ${c.kraPin}` : ""}{c.phone ? ` · ${c.phone}` : ""}
                </option>
              ))}
            </select>
          </div>
          {!customerId ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="inv-cname">Name</Label>
                  <Input id="inv-cname" value={cust.name} placeholder="Walk-in customer" onChange={(e) => setCust({ ...cust, name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="inv-cphone">Phone</Label>
                  <Input id="inv-cphone" inputMode="tel" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} />
                </div>
              </div>
              <IdentityFields prefix="inv" value={identity} onChange={setIdentity} business />
            </>
          ) : null}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Items</Label>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} /> Prices include VAT
              </label>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_4rem_6rem_6.5rem_1.5rem] items-center gap-2">
                  <Input aria-label={`Line ${i + 1} description`} required placeholder="Description" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                  <Input aria-label={`Line ${i + 1} quantity`} required inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                  <Input aria-label={`Line ${i + 1} unit price`} required inputMode="decimal" placeholder="Price" value={l.unitPrice} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} />
                  <select
                    aria-label={`Line ${i + 1} tax type`}
                    className="focus-ring rounded-control border border-borderline bg-white px-2 py-2.5 text-xs"
                    value={l.taxType}
                    onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, taxType: e.target.value } : x)))}
                  >
                    <option value="B">B · VAT 16%</option>
                    <option value="E">E · VAT 8%</option>
                    <option value="C">C · Zero-rated</option>
                    <option value="A">A · Exempt</option>
                    <option value="D">D · Non-VAT</option>
                  </select>
                  <button type="button" aria-label="Remove line" className="text-muted hover:text-danger disabled:opacity-30" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
            <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setLines([...lines, { ...EMPTY_LINE }])}>+ Add line</button>
          </div>

          <div className="ml-auto w-56 space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-muted">Before tax</span><span>{formatKESExact(totals.net)}</span></div>
            <div className="flex justify-between"><span className="text-muted">VAT</span><span>{formatKESExact(totals.tax)}</span></div>
            <div className="flex justify-between border-t border-borderline pt-1 text-sm font-semibold"><span>Total</span><span>KES {formatKESExact(totals.total)}</span></div>
          </div>

          <div>
            <Label htmlFor="inv-notes">Notes (optional)</Label>
            <Input id="inv-notes" value={notes} placeholder="Payment terms, delivery details…" onChange={(e) => setNotes(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={signNow} onChange={(e) => setSignNow(e.target.checked)} /> Sign with KRA eTIMS now
          </label>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(null)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : signNow ? "Create & sign" : "Save draft"}</Button>
          </div>
        </form>
      </Modal>

      {/* ---------- detail ---------- */}
      {openDoc ? (
        <Modal open onClose={() => { setOpenDoc(null); setCreditReason(""); setPayPhone(""); setError(null); }} title={`${DOC_TITLE[openDoc.docType]} ${openDoc.number}`}>
          <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
            <EtimsDocumentView doc={toView(openDoc)} />
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              {openDoc.status === "DRAFT" || openDoc.status === "FAILED" || openDoc.status === "QUEUED" ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    const d = await action(`/api/invoices/${openDoc.id}/fiscalise`, {}, (x) => `${x.data.number} signed — CU ${x.data.cuInvoiceNo}`);
                    if (d) setOpenDoc(d.data);
                  }}
                >
                  Sign with eTIMS
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(publicUrl(openDoc)).then(() => setNotice("Customer link copied"))}>
                Copy customer link
              </Button>
              <Button size="sm" variant="secondary" onClick={() => window.open(`/r/${openDoc.publicToken}`, "_blank")}>Print / PDF</Button>
            </div>

            {openDoc.docType === "INVOICE" && openDoc.paymentStatus !== "PAID" && openDoc.status !== "CANCELLED" ? (
              <Card className="p-4">
                <p className="text-sm font-medium">Request payment · {formatKES(BigInt(openDoc.totalMinor) - BigInt(openDoc.paidMinor))} outstanding</p>
                <p className="mb-2 text-xs text-muted">Sends an M-Pesa PIN prompt. Customers can also pay on Paybill with account <span className="font-mono">YOURREF-{openDoc.number}</span>.</p>
                <div className="flex gap-2">
                  <Input aria-label="Payer phone" inputMode="tel" placeholder={openDoc.customerPhone ?? "0712 345 678"} value={payPhone} onChange={(e) => setPayPhone(e.target.value)} />
                  <Button size="sm" disabled={busy} onClick={() => action(`/api/invoices/${openDoc.id}/request-payment`, { phone: payPhone || undefined }, () => "Payment prompt sent — track it under Receive payments.")}>
                    Send prompt
                  </Button>
                </div>
              </Card>
            ) : null}

            {openDoc.status === "SIGNED" && (openDoc.docType === "INVOICE" || openDoc.docType === "RECEIPT") ? (
              <Card className="p-4">
                <p className="text-sm font-medium">Credit note</p>
                <p className="mb-2 text-xs text-muted">Signed documents can&apos;t be edited or deleted (KRA rule). Reverse it with a credit note, then issue a corrected invoice.</p>
                <div className="flex gap-2">
                  <Input aria-label="Credit note reason" placeholder="Reason, e.g. goods returned" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || creditReason.trim().length < 3}
                    onClick={async () => {
                      const d = await action(`/api/invoices/${openDoc.id}/credit-note`, { reason: creditReason }, (x) => `Credit note ${x.data.number} issued`);
                      if (d) setOpenDoc(d.data);
                    }}
                  >
                    Issue credit note
                  </Button>
                </div>
              </Card>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
