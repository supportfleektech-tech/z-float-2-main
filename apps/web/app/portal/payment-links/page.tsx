"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, Button, Input, Label, TableShell, Badge, Skeleton, Modal, Spinner } from "@/components/ui";

interface LinkRow {
  id: string;
  token: string;
  name: string;
  description: string | null;
  amountMinor: string;
  status: string;
  useCount: number;
  maxUses: number | null;
  createdAt: string;
  url: string;
}

export default function PaymentLinksPage() {
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", amount: "", maxUses: "" });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<LinkRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareRow, setShareRow] = useState<LinkRow | null>(null);
  const [qrError, setQrError] = useState(false);

  function load() {
    fetch("/api/payment-links")
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          amount: form.amount,
          maxUses: form.maxUses ? Number(form.maxUses) : undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Could not create link");
        return;
      }
      setCreated(d.data);
      setOpen(false);
      setForm({ name: "", description: "", amount: "", maxUses: "" });
      load();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/payment-links/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div>
      <PageHeader
        title="Payment links"
        subtitle="Share a link and collect money from anyone — no account required on their side."
        actions={<Button onClick={() => setOpen(true)}>+ New payment link</Button>}
      />
      {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
      {copied ? <p className="mb-4 text-sm text-success">Link copied to clipboard</p> : null}

      {created ? (
        <Card className="mb-6 border-success/40 bg-success/5 p-6">
          <h2 className="font-semibold text-success">Payment link created</h2>
          <p className="mt-1 text-sm text-muted">Share this URL — the payer sees a branded page and pays with M-Pesa.</p>
          <div className="mt-3 flex gap-2">
            <code className="flex-1 truncate rounded-control bg-white px-3 py-2 font-mono text-xs">{created.url}</code>
            <Button size="sm" variant="secondary" onClick={() => copy(created.url)}>Copy</Button>
            <Button size="sm" variant="secondary" onClick={() => setCreated(null)}>Done</Button>
          </div>
        </Card>
      ) : null}

      {!rows ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-muted">No payment links yet — create one to start collecting.</Card>
      ) : (
        <TableShell headers={["Name", "Amount", "Uses", "Status", "Link", "Actions"]}>
          {rows.map((r) => (
            <tr key={r.id} data-link-id={r.id} className="hover:bg-surface/60">
              <td className="px-4 py-3">
                <p className="font-medium">{r.name}</p>
                <p className="max-w-52 truncate text-xs text-muted">{r.description ?? "—"}</p>
              </td>
              <td className="px-4 py-3 font-medium">KES {(BigInt(r.amountMinor) / 100n).toString()}</td>
              <td className="px-4 py-3 text-xs text-muted">{r.useCount}{r.maxUses ? ` / ${r.maxUses}` : ""}</td>
              <td className="px-4 py-3">
                <Badge tone={r.status === "ACTIVE" ? "success" : r.status === "PAUSED" ? "warning" : "neutral"}>{r.status}</Badge>
              </td>
              <td className="px-4 py-3">
                <button onClick={() => copy(r.url)} className="max-w-44 truncate font-mono text-xs text-primary hover:underline">
                  {r.url.replace(/^https?:\/\/[^/]+/, "")}
                </button>
              </td>
              <td className="px-4 py-3 text-right">
                <button className="mr-3 text-xs text-primary hover:underline" onClick={() => { setQrError(false); setShareRow(r); }}>
                  Share
                </button>
                {r.status === "ACTIVE" ? (
                  <button className="mr-3 text-xs text-muted hover:underline" onClick={() => setStatus(r.id, "PAUSED")}>Pause</button>
                ) : r.status === "PAUSED" ? (
                  <button className="mr-3 text-xs text-primary hover:underline" onClick={() => setStatus(r.id, "ACTIVE")}>Resume</button>
                ) : null}
                {r.status !== "CLOSED" ? (
                  <button className="text-xs text-danger hover:underline" onClick={() => setStatus(r.id, "CLOSED")}>Close</button>
                ) : null}
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New payment link">
        <form onSubmit={create} className="space-y-4">
          <div>
            <Label htmlFor="pl-name">Name</Label>
            <Input id="pl-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. July invoice #1042" />
          </div>
          <div>
            <Label htmlFor="pl-description">Description (optional)</Label>
            <Input id="pl-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Shown to the payer" />
          </div>
          <div>
            <Label htmlFor="pl-amount">Amount (KES)</Label>
            <Input id="pl-amount" required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
          </div>
          <div>
            <Label htmlFor="pl-max-uses">Max uses (optional)</Label>
            <Input id="pl-max-uses" inputMode="numeric" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="Unlimited" />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : "Create link"}</Button>
          </div>
        </form>
      </Modal>

      {shareRow ? (
        <Modal open onClose={() => setShareRow(null)} title={`Share · ${shareRow.name}`}>
          <div className="space-y-4">
            <div className="flex gap-2">
              <code className="flex-1 truncate rounded-control bg-surface px-3 py-2 font-mono text-xs">{shareRow.url}</code>
              <Button size="sm" variant="secondary" onClick={() => void copy(shareRow.url)}>Copy</Button>
            </div>
            <div className="flex items-center gap-3 rounded-control border border-slate-200 p-4">
              <div className="h-28 w-28 shrink-0">
                {qrError ? (
                  <div className="flex h-full w-full items-center justify-center rounded-control bg-slate-100 text-center text-[10px] text-slate-400">
                    QR unavailable
                  </div>
                ) : (
                  <img
                    src={`/api/payment-links/${shareRow.id}/qr`}
                    alt="QR code for payment link"
                    width={112}
                    height={112}
                    className="h-full w-full rounded-control"
                    onError={() => setQrError(true)}
                  />
                )}
              </div>
              <div className="text-xs text-muted">
                <p className="font-medium text-slate-700">Scan to pay</p>
                <p className="mt-1">
                  Show this QR in-store or on an invoice — the payer opens the hosted checkout on their phone and pays
                  with M-Pesa. QR PNG downloads from the row&apos;s QR endpoint.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Pay me with Z-float: ${shareRow.name} — ${shareRow.url}`)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-control bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                WhatsApp
              </a>
              <a
                href={`mailto:?subject=${encodeURIComponent(`Payment request: ${shareRow.name}`)}&body=${encodeURIComponent(`Please pay using this link:\n${shareRow.url}`)}`}
                className="rounded-control bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                Email
              </a>
              <Button size="sm" variant="secondary" onClick={() => setShareRow(null)}>Close</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
