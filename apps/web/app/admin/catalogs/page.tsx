"use client";

import { useEffect, useState } from "react";
import { Card, TableShell, Badge, Button, Input, Label, Select, Skeleton, Modal, Spinner } from "@/components/ui";
import { formatKES } from "@/lib/money";
import { minorOrZero } from "@zfloat/money";

interface Biller {
  id: string;
  code: string;
  name: string;
  category: string | null;
  channel: string;
  accountNumber: string;
  enabled: boolean;
}
interface AirtimeProduct {
  id: string;
  providerCode: string;
  network: string;
  productCode: string;
  name: string;
  type: string;
  denominationMinor: string;
  enabled: boolean;
}

type Editor = { kind: "biller"; row?: Biller } | { kind: "airtime"; row?: AirtimeProduct } | null;

const emptyBiller = { code: "", name: "", category: "", channel: "paybill", accountNumber: "" };
const emptyAirtime = { providerCode: "local-sandbox", network: "SAF", productCode: "", name: "", type: "AIRTIME", amount: "" };

export default function AdminCatalogsPage() {
  const [billers, setBillers] = useState<Biller[] | null>(null);
  const [airtime, setAirtime] = useState<AirtimeProduct[] | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [billerForm, setBillerForm] = useState(emptyBiller);
  const [airtimeForm, setAirtimeForm] = useState(emptyAirtime);

  function loadAll() {
    fetch("/api/admin/catalogs/billers")
      .then((r) => r.json())
      .then((d) => setBillers(d.data ?? []))
      .catch(() => setBillers([]));
    fetch("/api/admin/catalogs/airtime")
      .then((r) => r.json())
      .then((d) => setAirtime(d.data ?? []))
      .catch(() => setAirtime([]));
  }
  useEffect(loadAll, []);

  // Maker-checker: every catalog mutation is staged. The API answers 202 with
  // { requestId, status: PENDING_APPROVAL } — a SECOND platform admin must
  // approve it in the Config approvals centre before the change takes effect.
  async function stagedFetch(path: string, init: RequestInit, verb: string) {
    setNotice(null);
    setError(null);
    const res = await fetch(path, init);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error?.message ?? `${verb} failed`);
      return;
    }
    const label = (d.data as { label?: string } | undefined)?.label;
    setNotice(`${label ? `${label} — ` : ""}change submitted. A second platform admin must approve it in Config approvals.`);
    loadAll();
  }

  async function toggleBiller(b: Biller) {
    await stagedFetch(`/api/admin/catalogs/billers/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !b.enabled }),
    }, b.enabled ? "Disable" : "Enable");
  }

  async function toggleAirtime(a: AirtimeProduct) {
    await stagedFetch(`/api/admin/catalogs/airtime/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !a.enabled }),
    }, a.enabled ? "Disable" : "Enable");
  }

  async function removeBiller(b: Biller) {
    if (!window.confirm(`Delete biller "${b.name}"?`)) return;
    await stagedFetch(`/api/admin/catalogs/billers/${b.id}`, { method: "DELETE" }, "Delete");
  }

  async function removeAirtime(a: AirtimeProduct) {
    if (!window.confirm(`Delete airtime product "${a.name}"?`)) return;
    await stagedFetch(`/api/admin/catalogs/airtime/${a.id}`, { method: "DELETE" }, "Delete");
  }

  function openEditor(next: Editor) {
    setError(null);
    setBillerForm(emptyBiller);
    setAirtimeForm(emptyAirtime);
    if (next?.kind === "biller" && next.row) {
      setBillerForm({ code: next.row.code, name: next.row.name, category: next.row.category ?? "", channel: next.row.channel, accountNumber: next.row.accountNumber });
    }
    if (next?.kind === "airtime" && next.row) {
      setAirtimeForm({
        providerCode: next.row.providerCode,
        network: next.row.network,
        productCode: next.row.productCode,
        name: next.row.name,
        type: next.row.type,
        amount: (minorOrZero(next.row.denominationMinor) / 100n).toString(),
      });
    }
    setEditor(next);
  }

  async function saveBiller(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const isEdit = Boolean(editor?.kind === "biller" && editor.row);
      const body = { ...billerForm, category: billerForm.category || null };
      const res = await fetch(isEdit ? `/api/admin/catalogs/billers/${(editor as { row: Biller }).row.id}` : "/api/admin/catalogs/billers", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Save failed");
        return;
      }
      const label = (d.data as { label?: string } | undefined)?.label;
      setNotice(`${label ? `${label} — ` : ""}change submitted. A second platform admin must approve it in Config approvals.`);
      setEditor(null);
      loadAll();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  async function saveAirtime(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const isEdit = Boolean(editor?.kind === "airtime" && editor.row);
      const res = await fetch(isEdit ? `/api/admin/catalogs/airtime/${(editor as { row: AirtimeProduct }).row.id}` : "/api/admin/catalogs/airtime", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(airtimeForm),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Save failed");
        return;
      }
      const label = (d.data as { label?: string } | undefined)?.label;
      setNotice(`${label ? `${label} — ` : ""}change submitted. A second platform admin must approve it in Config approvals.`);
      setEditor(null);
      loadAll();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  const editingBiller = editor?.kind === "biller" ? Boolean(editor.row) : false;
  const editingAirtime = editor?.kind === "airtime" ? Boolean(editor.row) : false;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Catalogs</h1>
      <p className="mt-1 text-sm text-muted">
        Billers (paybill/till collections) and airtime/data denominations offered on the platform.
      </p>
      {notice ? (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>⏳ {notice}</span>
          <button className="text-emerald-600 hover:underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {/* Billers */}
      <Card className="mt-6 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Billers</h2>
          <Button size="sm" onClick={() => openEditor({ kind: "biller" })}>+ Add biller</Button>
        </div>
        {!billers ? (
          <div className="mt-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : billers.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No billers yet.</p>
        ) : (
          <div className="mt-4">
            <TableShell headers={["Code", "Name", "Category", "Channel", "Account", "Status", ""]}>
              {billers.map((b) => (
                <tr key={b.id} className="hover:bg-surface/60">
                  <td className="px-4 py-2.5 font-mono text-xs">{b.code}</td>
                  <td className="px-4 py-2.5 text-sm font-medium">{b.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{b.category ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{b.channel}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{b.accountNumber}</td>
                  <td className="px-4 py-2.5"><Badge tone={b.enabled ? "success" : "neutral"}>{b.enabled ? "ACTIVE" : "DISABLED"}</Badge></td>
                  <td className="px-4 py-2.5 text-right">
                    <button className="mr-3 text-xs text-primary hover:underline" onClick={() => openEditor({ kind: "biller", row: b })}>Edit</button>
                    <button className="mr-3 text-xs text-muted hover:underline" onClick={() => void toggleBiller(b)}>{b.enabled ? "Disable" : "Enable"}</button>
                    <button className="text-xs text-danger hover:underline" onClick={() => void removeBiller(b)}>Delete</button>
                  </td>
                </tr>
              ))}
            </TableShell>
          </div>
        )}
      </Card>

      {/* Airtime */}
      <Card className="mt-6 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Airtime & data</h2>
          <Button size="sm" onClick={() => openEditor({ kind: "airtime" })}>+ Add product</Button>
        </div>
        {!airtime ? (
          <div className="mt-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : airtime.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No airtime products yet.</p>
        ) : (
          <div className="mt-4">
            <TableShell headers={["Provider", "Network", "Name", "Type", "Denomination", "Status", ""]}>
              {airtime.map((a) => (
                <tr key={a.id} className="hover:bg-surface/60">
                  <td className="px-4 py-2.5 font-mono text-xs">{a.providerCode}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{a.network}</td>
                  <td className="px-4 py-2.5 text-sm font-medium">{a.name}</td>
                  <td className="px-4 py-2.5"><Badge tone={a.type === "DATA" ? "info" : "neutral"}>{a.type}</Badge></td>
                  <td className="px-4 py-2.5 font-medium">{formatKES(a.denominationMinor)}</td>
                  <td className="px-4 py-2.5"><Badge tone={a.enabled ? "success" : "neutral"}>{a.enabled ? "ACTIVE" : "DISABLED"}</Badge></td>
                  <td className="px-4 py-2.5 text-right">
                    <button className="mr-3 text-xs text-primary hover:underline" onClick={() => openEditor({ kind: "airtime", row: a })}>Edit</button>
                    <button className="mr-3 text-xs text-muted hover:underline" onClick={() => void toggleAirtime(a)}>{a.enabled ? "Disable" : "Enable"}</button>
                    <button className="text-xs text-danger hover:underline" onClick={() => void removeAirtime(a)}>Delete</button>
                  </td>
                </tr>
              ))}
            </TableShell>
          </div>
        )}
      </Card>

      {/* Editor modal */}
      <Modal open={editor !== null} onClose={() => setEditor(null)} title={editor?.kind === "biller" ? (editingBiller ? "Edit biller" : "Add biller") : editor?.kind === "airtime" ? (editingAirtime ? "Edit airtime product" : "Add airtime product") : ""}>
        {editor?.kind === "biller" ? (
          <form onSubmit={saveBiller} className="space-y-4">
            <div>
              <Label htmlFor="b-code">Code</Label>
              <Input id="b-code" required disabled={editingBiller} value={billerForm.code} onChange={(e) => setBillerForm({ ...billerForm, code: e.target.value })} placeholder="kplc_prepaid" />
            </div>
            <div>
              <Label htmlFor="b-name">Name</Label>
              <Input id="b-name" required value={billerForm.name} onChange={(e) => setBillerForm({ ...billerForm, name: e.target.value })} placeholder="Kenya Power (prepaid)" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="b-cat">Category</Label>
                <Input id="b-cat" value={billerForm.category} onChange={(e) => setBillerForm({ ...billerForm, category: e.target.value })} placeholder="Utilities" />
              </div>
              <div>
                <Label htmlFor="b-channel">Channel</Label>
                <Select id="b-channel" value={billerForm.channel} onChange={(e) => setBillerForm({ ...billerForm, channel: e.target.value })}>
                  <option value="paybill">Paybill</option>
                  <option value="till">Till</option>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="b-account">Account number</Label>
              <Input id="b-account" required value={billerForm.accountNumber} onChange={(e) => setBillerForm({ ...billerForm, accountNumber: e.target.value })} placeholder="880100" />
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditor(null)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : editingBiller ? "Save changes" : "Add biller"}</Button>
            </div>
          </form>
        ) : editor?.kind === "airtime" ? (
          <form onSubmit={saveAirtime} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="a-provider">Provider code</Label>
                <Input id="a-provider" required disabled={editingAirtime} value={airtimeForm.providerCode} onChange={(e) => setAirtimeForm({ ...airtimeForm, providerCode: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="a-network">Network</Label>
                <Input id="a-network" required disabled={editingAirtime} value={airtimeForm.network} onChange={(e) => setAirtimeForm({ ...airtimeForm, network: e.target.value })} placeholder="SAF / AIRTEL / TELKOM" />
              </div>
            </div>
            <div>
              <Label htmlFor="a-product">Product code</Label>
              <Input id="a-product" required disabled={editingAirtime} value={airtimeForm.productCode} onChange={(e) => setAirtimeForm({ ...airtimeForm, productCode: e.target.value })} placeholder="saf_airtime_500" />
            </div>
            <div>
              <Label htmlFor="a-name">Name</Label>
              <Input id="a-name" required value={airtimeForm.name} onChange={(e) => setAirtimeForm({ ...airtimeForm, name: e.target.value })} placeholder="Safaricom Airtime 500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="a-type">Type</Label>
                <Select id="a-type" value={airtimeForm.type} onChange={(e) => setAirtimeForm({ ...airtimeForm, type: e.target.value })}>
                  <option value="AIRTIME">Airtime</option>
                  <option value="DATA">Data</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="a-amount">Amount (KES)</Label>
                <Input id="a-amount" required inputMode="decimal" value={airtimeForm.amount} onChange={(e) => setAirtimeForm({ ...airtimeForm, amount: e.target.value })} placeholder="500" />
              </div>
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditor(null)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : editingAirtime ? "Save changes" : "Add product"}</Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
