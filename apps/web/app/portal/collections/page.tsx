"use client";
/**
 * Receive payments — every inbound channel in one place: M-Pesa STK push
 * (request-to-pay), paybill/till (C2B), payment links and bank transfers.
 * Each successful payment credits the wallet and gets an eTIMS receipt.
 */
import { useCallback, useEffect, useState } from "react";
import { PageHeader, Card, Button, Input, Label, TableShell, Badge, Skeleton, Modal, Spinner, StatCard, EmptyState } from "@/components/ui";
import { IdentityFields, IdentityCell, EMPTY_IDENTITY, type IdentityValue } from "@/components/identity-fields";
import { formatKES } from "@/lib/money";

interface CollectionRow {
  id: string;
  collectionNumber: string;
  channel: string;
  status: string;
  amountMinor: string;
  description: string | null;
  accountReference: string | null;
  payerName: string | null;
  payerPhone: string | null;
  payerIdType: string | null;
  payerIdNumber: string | null;
  payerKraPin: string | null;
  receiptNumber: string | null;
  receiptId: string | null;
  invoiceId: string | null;
  providerCode: string | null;
  failureReason: string | null;
  createdAt: string;
  settledAt: string | null;
}

interface Stats {
  receivedTodayMinor: string;
  received30dMinor: string;
  pendingMinor: string;
  successCount: number;
  pendingCount: number;
  failedCount: number;
}

interface Settings {
  tenant: { kraPin: string | null; collectionAccountRef: string | null } | null;
  c2b: { shortcode: string; till: string | null };
  data: { status: string } | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  MPESA_STK: "M-Pesa request",
  MPESA_C2B: "Paybill / Till",
  PAYMENT_LINK: "Payment link",
  BANK_TRANSFER: "Bank transfer",
};

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  SUCCESS: "success",
  PENDING: "warning",
  FAILED: "danger",
  EXPIRED: "neutral",
  CANCELLED: "neutral",
};

export default function CollectionsPage() {
  const [rows, setRows] = useState<CollectionRow[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [filter, setFilter] = useState({ status: "", channel: "", q: "" });
  const [stkOpen, setStkOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [stk, setStk] = useState({ phone: "", amount: "", description: "", payerName: "" });
  const [bank, setBank] = useState({ amount: "", bankReference: "", payerName: "", description: "" });
  const [identity, setIdentity] = useState<IdentityValue>(EMPTY_IDENTITY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (filter.status) p.set("status", filter.status);
    if (filter.channel) p.set("channel", filter.channel);
    if (filter.q) p.set("q", filter.q);
    fetch(`/api/collections?${p}`)
      .then((r) => r.json())
      .then((d) => {
        setRows(d.data ?? []);
        setStats(d.stats ?? null);
      })
      .catch(() => setRows([]));
  }, [filter]);

  useEffect(load, [load]);
  useEffect(() => {
    fetch("/api/etims/device")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => undefined);
  }, []);
  // Poll while any request is waiting on the payer's PIN.
  useEffect(() => {
    if (!rows?.some((r) => r.status === "PENDING")) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [rows, load]);

  async function post(url: string, body: unknown, ok: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Request failed");
        return false;
      }
      setNotice(ok);
      load();
      return true;
    } catch {
      setError("Network error — try again");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendStk(e: React.FormEvent) {
    e.preventDefault();
    if (await post("/api/collections", { ...stk, ...identity }, `Payment prompt sent to ${stk.phone}. It completes when they enter their M-Pesa PIN.`)) {
      setStkOpen(false);
      setStk({ phone: "", amount: "", description: "", payerName: "" });
      setIdentity(EMPTY_IDENTITY);
    }
  }

  async function recordBank(e: React.FormEvent) {
    e.preventDefault();
    if (await post("/api/collections/bank", { ...bank, ...identity }, `Bank transfer ${bank.bankReference} recorded and credited.`)) {
      setBankOpen(false);
      setBank({ amount: "", bankReference: "", payerName: "", description: "" });
      setIdentity(EMPTY_IDENTITY);
    }
  }

  const accountRef = settings?.tenant?.collectionAccountRef;

  return (
    <div>
      <PageHeader
        title="Receive payments"
        subtitle="Collect money by M-Pesa prompt, paybill/till, payment link or bank transfer. Every payment credits your wallet and gets a KRA eTIMS receipt."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setError(null); setBankOpen(true); }}>Record bank transfer</Button>
            <Button onClick={() => { setError(null); setStkOpen(true); }}>+ Request payment</Button>
          </div>
        }
      />
      {notice ? (
        <div className="mb-4 flex items-center justify-between rounded-control border border-success/40 bg-success/5 px-4 py-2 text-sm text-success">
          <span>{notice}</span>
          <button className="text-xs underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Received today" value={stats ? formatKES(stats.receivedTodayMinor) : "…"} tone="success" />
        <StatCard label="Received (30 days)" value={stats ? formatKES(stats.received30dMinor) : "…"} hint={stats ? `${stats.successCount} payments` : undefined} />
        <StatCard label="Awaiting payer" value={stats ? formatKES(stats.pendingMinor) : "…"} hint={stats ? `${stats.pendingCount} pending` : undefined} tone="warning" />
        <StatCard label="Failed / cancelled" value={stats ? String(stats.failedCount) : "…"} tone="danger" />
      </div>

      <Card className="mb-6 p-5">
        <h2 className="font-semibold">How customers can pay you</h2>
        <div className="mt-3 grid gap-4 text-sm md:grid-cols-3">
          <div>
            <p className="font-medium">M-Pesa Paybill</p>
            <p className="text-muted">
              Business no. <span className="font-mono text-ink">{settings?.c2b.shortcode ?? "…"}</span>
              <br />
              Account no.{" "}
              {accountRef ? (
                <>
                  <span className="font-mono text-ink">{accountRef}</span> or <span className="font-mono text-ink">{accountRef}-INV-000123</span> to pay an invoice
                </>
              ) : (
                <a href="/portal/settings/etims" className="text-primary hover:underline">set your account reference</a>
              )}
            </p>
          </div>
          <div>
            <p className="font-medium">Request to pay</p>
            <p className="text-muted">Send an M-Pesa PIN prompt straight to the customer&apos;s phone — from here or from any invoice.</p>
          </div>
          <div>
            <p className="font-medium">Links &amp; bank</p>
            <p className="text-muted">
              Share a <a href="/portal/payment-links" className="text-primary hover:underline">payment link</a>, or record bank transfers so they reconcile and get receipts.
            </p>
          </div>
        </div>
        {settings && settings.data?.status !== "ACTIVE" ? (
          <p className="mt-3 rounded-control bg-warning/10 px-3 py-2 text-xs text-warning">
            eTIMS is not connected yet — payments are still credited, but receipts won&apos;t be KRA-signed until you{" "}
            <a href="/portal/settings/etims" className="underline">connect your eTIMS device</a>.
          </p>
        ) : null}
      </Card>

      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <Input
          aria-label="Search collections"
          className="max-w-xs"
          placeholder="Search number, payer, phone, receipt, KRA PIN…"
          value={filter.q}
          onChange={(e) => setFilter({ ...filter, q: e.target.value })}
        />
        <select aria-label="Status" className="focus-ring rounded-control border border-borderline bg-white px-3 py-2 text-sm" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Channel" className="focus-ring rounded-control border border-borderline bg-white px-3 py-2 text-sm" value={filter.channel} onChange={(e) => setFilter({ ...filter, channel: e.target.value })}>
          <option value="">All channels</option>
          {Object.entries(CHANNEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </form>

      {!rows ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No payments received yet" description="Request a payment or share your paybill account number to start collecting." />
      ) : (
        <TableShell headers={["Payment", "Payer", "Identity", "Amount", "Status", "Receipt", ""]}>
          {rows.map((r) => (
            <tr key={r.id} data-collection-id={r.id} className="hover:bg-surface/60">
              <td className="px-4 py-3">
                <p className="font-mono text-xs">{r.collectionNumber}</p>
                <p className="text-xs text-muted">{CHANNEL_LABEL[r.channel] ?? r.channel} · {new Date(r.createdAt).toLocaleString()}</p>
                {r.description ? <p className="max-w-52 truncate text-xs text-muted">{r.description}</p> : null}
              </td>
              <td className="px-4 py-3">
                <p className="text-sm">{r.payerName ?? "—"}</p>
                <p className="font-mono text-xs text-muted">{r.payerPhone ?? ""}</p>
              </td>
              <td className="px-4 py-3"><IdentityCell idType={r.payerIdType} idNumber={r.payerIdNumber} kraPin={r.payerKraPin} /></td>
              <td className="px-4 py-3 font-medium">{formatKES(r.amountMinor)}</td>
              <td className="px-4 py-3">
                <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status === "PENDING" ? "Awaiting PIN" : r.status}</Badge>
                {r.failureReason ? <p className="mt-1 max-w-40 text-xs text-muted">{r.failureReason}</p> : null}
              </td>
              <td className="px-4 py-3 text-xs">
                {r.receiptNumber ? <p className="font-mono">{r.receiptNumber}</p> : null}
                {r.receiptId ? <a className="text-primary hover:underline" href={`/portal/invoices?open=${r.receiptId}`}>eTIMS receipt</a> : r.status === "SUCCESS" ? <span className="text-muted">receipt pending</span> : null}
              </td>
              <td className="px-4 py-3 text-right">
                {r.status === "PENDING" && r.providerCode === "local-sandbox" ? (
                  <span className="whitespace-nowrap">
                    <button className="mr-2 text-xs text-primary hover:underline" onClick={() => post(`/api/collections/${r.id}/simulate`, { outcome: "success" }, "Sandbox: payer entered PIN — payment received.")}>Simulate PIN</button>
                    <button className="text-xs text-danger hover:underline" onClick={() => post(`/api/collections/${r.id}/simulate`, { outcome: "fail" }, "Sandbox: payer cancelled.")}>Cancel</button>
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <Modal open={stkOpen} onClose={() => setStkOpen(false)} title="Request payment (M-Pesa prompt)">
        <form onSubmit={sendStk} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="stk-phone">Payer phone</Label>
              <Input id="stk-phone" required inputMode="tel" placeholder="0712 345 678" value={stk.phone} onChange={(e) => setStk({ ...stk, phone: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="stk-amount">Amount (KES)</Label>
              <Input id="stk-amount" required inputMode="decimal" placeholder="1,500" value={stk.amount} onChange={(e) => setStk({ ...stk, amount: e.target.value })} />
            </div>
          </div>
          <div>
            <Label htmlFor="stk-name">Payer name (optional)</Label>
            <Input id="stk-name" value={stk.payerName} onChange={(e) => setStk({ ...stk, payerName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="stk-desc">What is it for?</Label>
            <Input id="stk-desc" placeholder="e.g. Consultation fee" value={stk.description} onChange={(e) => setStk({ ...stk, description: e.target.value })} />
          </div>
          <IdentityFields prefix="stk" value={identity} onChange={setIdentity} />
          <p className="text-xs text-muted">Add the payer&apos;s KRA PIN and it appears on their eTIMS receipt so they can claim the VAT.</p>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setStkOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : "Send prompt"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={bankOpen} onClose={() => setBankOpen(false)} title="Record bank transfer received">
        <form onSubmit={recordBank} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="bk-amount">Amount (KES)</Label>
              <Input id="bk-amount" required inputMode="decimal" value={bank.amount} onChange={(e) => setBank({ ...bank, amount: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="bk-ref">Bank reference</Label>
              <Input id="bk-ref" required placeholder="FT26268ABC12" className="font-mono" value={bank.bankReference} onChange={(e) => setBank({ ...bank, bankReference: e.target.value })} />
            </div>
          </div>
          <div>
            <Label htmlFor="bk-name">Payer name</Label>
            <Input id="bk-name" value={bank.payerName} onChange={(e) => setBank({ ...bank, payerName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="bk-desc">Note</Label>
            <Input id="bk-desc" value={bank.description} onChange={(e) => setBank({ ...bank, description: e.target.value })} />
          </div>
          <IdentityFields prefix="bk" value={identity} onChange={setIdentity} business />
          <p className="text-xs text-muted">Each bank reference can only be recorded once. Requires reconciliation rights.</p>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setBankOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : "Record & credit"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
