"use client";

import { useEffect, useState, useCallback } from "react";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Label,
  Select,
  TableShell,
  Badge,
  Skeleton,
  Modal,
  Spinner,
} from "@/components/ui";
import { PaymentMethodDistributionChart } from "@/components/admin/Charts";
import { formatKES } from "@/lib/money";
import { minorOrZero } from "@zfloat/money";

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
  createdAt: string;
}

interface FeeVersion {
  id: string;
  feeRuleId: string;
  version: number;
  changeComment: string | null;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

const emptyForm = {
  product: "single_payment",
  channel: "mpesa",
  provider: "local-sandbox",
  flat: "",
  pct: "",
  min: "",
  max: "",
  status: "ACTIVE",
};

const PRODUCTS = ["single_payment", "bulk_payment", "payroll", "bill_payment", "airtime"];
const CHANNELS = ["mpesa", "till", "paybill", "bank", "airtime"];

export default function AdminPricingPage() {
  const [rules, setRules] = useState<FeeRule[] | null>(null);
  const [versions, setVersions] = useState<FeeVersion[]>([]);
  const [editing, setEditing] = useState<FeeRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [versionFilter, setVersionFilter] = useState<string>("ALL");
  const [productFilter, setProductFilter] = useState<string>("ALL");
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [providerFilter, setProviderFilter] = useState<string>("ALL");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/pricing");
      const d = await res.json();
      if (d.data) {
        setRules(d.data.rules ?? []);
        setVersions(d.data.versions ?? []);
      } else {
        setRules([]);
        setVersions([]);
      }
    } catch {
      setRules([]);
      setVersions([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      flat: (minorOrZero(r.flatFeeMinor) / 100n).toString(),
      pct: (minorOrZero(r.percentBps) / 100n).toString(),
      min: (minorOrZero(r.minFeeMinor) / 100n).toString(),
      max: (minorOrZero(r.maxFeeMinor) / 100n).toString(),
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
        flatFeeMinor: String(minorOrZero(Math.round(Number(form.flat || 0) * 100))),
        percentBps: String(minorOrZero(Math.round(Number(form.pct || 0) * 100))),
        minFeeMinor: String(minorOrZero(Math.round(Number(form.min || 0) * 100))),
        maxFeeMinor: String(minorOrZero(Math.round(Number(form.max || 0) * 100))),
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
    const label = (data.data as { label?: string } | undefined)?.label;
    setMessage(`⏳ ${label ? `${label} — ` : ""}change submitted. A second platform admin must approve it in Config approvals (the version bumps on approval).`);
    setEditing(null);
    setCreating(false);
    load();
  }

  async function deleteRule(r: FeeRule) {
    if (!window.confirm(`Deactivate fee rule "${r.product}" (${r.channel}/${r.provider})? It stays visible until a second admin approves.`)) return;
    try {
      const res = await fetch(`/api/admin/pricing/${r.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Delete failed");
      const label = (data.data as { label?: string } | undefined)?.label;
      setMessage(`⏳ ${label ? `${label} — ` : ""}deactivation submitted. A second platform admin must approve it in Config approvals.`);
      load();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  const filteredRules = (rules ?? []).filter(r => {
    if (versionFilter !== "ALL" && String(r.version) !== versionFilter) return false;
    if (productFilter !== "ALL" && r.product !== productFilter) return false;
    if (channelFilter !== "ALL" && r.channel !== channelFilter) return false;
    if (providerFilter !== "ALL" && r.provider !== providerFilter) return false;
    return true;
  });

  const versionsList = [...new Set(rules?.map(r => String(r.version)) || [])].sort((a, b) => Number(b) - Number(a));
  const productsList = [...new Set(rules?.map(r => r.product) || [])].sort();
  const channelsList = [...new Set(rules?.map(r => r.channel) || [])].sort();
  const providersList = [...new Set(rules?.map(r => r.provider) || [])].sort();

  const feeDistribution = Object.values((rules ?? []).reduce((acc, r) => {
    const key = r.product;
    if (!acc[key]) acc[key] = { name: key, value: 0 };
    acc[key].value += Number(r.flatFeeMinor) + Number(r.percentBps) * 100;
    return acc;
  }, {} as Record<string, { name: string; value: number }>));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing & fees"
        subtitle="Fee rules are versioned and audited. Past transactions keep their historical snapshots."
        actions={<Button onClick={openNew}>+ New fee rule</Button>}
      />

      {message ? (
        <div className="mb-4 rounded-control border border-borderline bg-white px-4 py-3 text-sm">
          {message}
        </div>
      ) : null}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={versionFilter} onChange={(e) => setVersionFilter(e.target.value)} className="w-32">
            <option value="ALL">All versions</option>
            {versionsList.map(v => <option key={v} value={v}>v{v}</option>)}
          </Select>
          <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className="w-40">
            <option value="ALL">All products</option>
            {productsList.map(p => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="w-36">
            <option value="ALL">All channels</option>
            {channelsList.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="w-40">
            <option value="ALL">All providers</option>
            {providersList.map(p => <option key={p} value={p}>{p}</option>)}
          </Select>
          <span className="text-sm text-muted ml-auto">
            {filteredRules.length} of {rules?.length ?? 0} rules
          </span>
        </div>
      </Card>

      {/* Charts */}
      <Card className="p-6">
        <h2 className="font-semibold mb-4">Fee Distribution by Product</h2>
        <PaymentMethodDistributionChart data={feeDistribution} />
      </Card>

      {/* Main Table */}
      {!rules ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <>
          <TableShell headers={["Product", "Channel", "Provider", "Flat Fee", "Percent", "Min/Max", "Status", "Version", "Actions"]}>
            {filteredRules.map(r => (
              <tr key={r.id} className="hover:bg-surface/60">
                <td className="px-4 py-3">{r.product}</td>
                <td className="px-4 py-3 text-xs uppercase">{r.channel}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.provider}</td>
                <td className="px-4 py-3">
                  {minorOrZero(r.flatFeeMinor) > 0 ? formatKES(r.flatFeeMinor) : "—"}
                </td>
                <td className="px-4 py-3">
                  {minorOrZero(r.percentBps) > 0n ? `${minorOrZero(r.percentBps) / 100n}%` : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {minorOrZero(r.minFeeMinor) > 0n ? formatKES(r.minFeeMinor) : "—"} /
                  {minorOrZero(r.maxFeeMinor) > 0n ? formatKES(r.maxFeeMinor) : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={r.status === "ACTIVE" ? "success" : r.status === "DISABLED" ? "neutral" : "warning"}>
                    {r.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-muted">v{r.version}</td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => deleteRule(r)}>Delete</Button>
                </td>
              </tr>
            ))}
          </TableShell>

          {/* Version History */}
          <div className="mt-4">
            <Button variant="ghost" size="sm" onClick={() => setShowVersions(!showVersions)}>
              {showVersions ? "Hide" : "Show"} version history ({versions.length})
            </Button>
            {showVersions ? (
              <Card className="mt-2 p-4">
                <ul className="space-y-2 text-sm">
                  {versions.slice(0, 50).map(v => (
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

      {/* Editor Modal */}
      <Modal open={!!editing || creating} onClose={() => { setEditing(null); setCreating(false); }} title={editing ? "Edit fee rule" : "New fee rule"}>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Product</Label>
              <Select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}>
                {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
              </Select>
            </div>
            <div>
              <Label>Channel</Label>
              <Select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
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
            <Button type="submit" disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : editing ? "Save & version" : "Add rule"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}