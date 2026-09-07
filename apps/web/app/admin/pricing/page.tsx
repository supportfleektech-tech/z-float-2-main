"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, Button, Input, Label, Select, TableShell, Badge, Skeleton, Modal, Spinner } from "@/components/ui";

interface FeeRule {
  id: string;
  product: string;
  channel: string;
  provider: string;
  flatFeeMinor: string;
  percentBps: string;
  minFeeMinor: string;
  maxFeeMinor: string;
  status: string;
  version: number;
  changeComment: string | null;
}

const emptyForm = { product: "single_payment", channel: "mpesa", provider: "local-sandbox", flat: "", pct: "", min: "", max: "", status: "ACTIVE" };

export default function AdminPricingPage() {
  const [rules, setRules] = useState<FeeRule[] | null>(null);
  const [versions, setVersions] = useState<Array<{ id: string; feeRuleId: string; version: number; changeComment: string | null; createdAt: string }>>([]);
  const [editing, setEditing] = useState<FeeRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  function load() {
    fetch("/api/admin/pricing")
      .then((r) => r.json())
      .then((d) => {
        setRules(d.data ?? []);
        setVersions(d.versions ?? []);
      })
      .catch(() => setRules([]));
  }
  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setCreating(true);
    setForm(emptyForm);
  }
  function openEdit(r: FeeRule) {
    setEditing(r);
    setCreating(false);
    setForm({
      product: r.product,
      channel: r.channel,
      provider: r.provider,
      flat: (BigInt(r.flatFeeMinor) / 100n).toString(),
      pct: (BigInt(r.percentBps) / 100n).toString(),
      min: (BigInt(r.minFeeMinor) / 100n).toString(),
      max: (BigInt(r.maxFeeMinor) / 100n).toString(),
      status: r.status,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ruleId: editing?.id,
        product: form.product,
        channel: form.channel,
        provider: form.provider,
        flatFeeMinor: String(BigInt(Math.round(Number(form.flat || 0) * 100))),
        percentBps: String(BigInt(Math.round(Number(form.pct || 0) * 100))),
        minFeeMinor: String(BigInt(Math.round(Number(form.min || 0) * 100))),
        maxFeeMinor: String(BigInt(Math.round(Number(form.max || 0) * 100))),
        status: form.status,
        changeComment: `${editing ? "Edited" : "Created"} via admin console`,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMessage(`⚠ ${data.error?.message ?? "Failed"}`);
      return;
    }
    // Maker-checker: the change is STAGED (202). It applies only after a
    // second platform admin approves it in Config approvals.
    const label = (data.data as { label?: string } | undefined)?.label;
    setMessage(`⏳ ${label ? `${label} — ` : ""}change submitted. A second platform admin must approve it in Config approvals (the version bumps on approval).`);
    setEditing(null);
    setCreating(false);
    load();
  }

  return (
    <div>
      <PageHeader
        title="Pricing & fees"
        subtitle="Fee rules are versioned and audited. Past transactions keep their historical snapshots."
        actions={<Button onClick={openNew}>+ New fee rule</Button>}
      />

      {message ? <p className="mb-4 rounded-control border border-borderline bg-white px-4 py-3 text-sm">{message}</p> : null}

      {!rules ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <>
          <TableShell headers={["Product", "Channel", "Provider", "Fee", "Status", "Version", "Actions"]}>
            {rules.map((r) => (
              <tr key={r.id} className="hover:bg-surface/60">
                <td className="px-4 py-3">{r.product}</td>
                <td className="px-4 py-3 text-xs uppercase">{r.channel}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.provider}</td>
                <td className="px-4 py-3">
                  KES {(BigInt(r.flatFeeMinor) / 100n).toString()}
                  {BigInt(r.percentBps) > 0n ? ` + ${BigInt(r.percentBps) / 100n}%` : ""}
                </td>
                <td className="px-4 py-3"><Badge tone={r.status === "ACTIVE" ? "success" : r.status === "DISABLED" ? "neutral" : "warning"}>{r.status}</Badge></td>
                <td className="px-4 py-3 text-xs text-muted">v{r.version}</td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>Edit</Button>
                </td>
              </tr>
            ))}
          </TableShell>

          <div className="mt-4">
            <Button variant="ghost" size="sm" onClick={() => setShowVersions(!showVersions)}>
              {showVersions ? "Hide" : "Show"} version history ({versions.length})
            </Button>
            {showVersions ? (
              <Card className="mt-2 p-4">
                <ul className="space-y-2 text-sm">
                  {versions.slice(0, 30).map((v) => (
                    <li key={v.id} className="flex justify-between border-b border-borderline pb-2 text-xs">
                      <span className="font-mono">rule {v.feeRuleId.slice(0, 8)} · v{v.version}</span>
                      <span className="text-muted">{v.changeComment ?? ""} — {new Date(v.createdAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
        </>
      )}

      <Modal open={!!editing || creating} onClose={() => { setEditing(null); setCreating(false); }} title={editing ? "Edit fee rule" : "New fee rule"}>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Product</Label>
              <Select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}>
                <option value="single_payment">single_payment</option>
                <option value="bulk_payment">bulk_payment</option>
                <option value="payroll">payroll</option>
                <option value="bill_payment">bill_payment</option>
                <option value="airtime">airtime</option>
              </Select>
            </div>
            <div>
              <Label>Channel</Label>
              <Select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                <option value="mpesa">mpesa</option>
                <option value="till">till</option>
                <option value="paybill">paybill</option>
                <option value="bank">bank</option>
                <option value="airtime">airtime</option>
              </Select>
            </div>
          </div>
          <div>
            <Label>Provider code</Label>
            <Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Flat fee (KES)</Label><Input inputMode="decimal" value={form.flat} onChange={(e) => setForm({ ...form, flat: e.target.value })} /></div>
            <div><Label>Percent (%)</Label><Input inputMode="decimal" value={form.pct} onChange={(e) => setForm({ ...form, pct: e.target.value })} /></div>
            <div><Label>Min fee (KES)</Label><Input inputMode="decimal" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} /></div>
            <div><Label>Max fee (KES)</Label><Input inputMode="decimal" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} /></div>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="ACTIVE">ACTIVE</option>
              <option value="DRAFT">DRAFT</option>
              <option value="DISABLED">DISABLED</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setEditing(null); setCreating(false); }}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : "Save & version"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
