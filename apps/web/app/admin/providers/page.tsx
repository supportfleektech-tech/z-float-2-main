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
  Switch,
} from "@/components/ui";

interface Provider {
  id: string;
  code: string;
  name: string;
  providerType: string;
  environment: string;
  enabled: boolean;
  priority: number | null;
  config: Record<string, unknown>;
  maintenance: boolean;
  createdAt: string;
}

interface ProviderHealth {
  providerId: string;
  status: "HEALTHY" | "DEGRADED" | "DOWN";
  lastCheck: string;
  latencyMs: number | null;
  successRate: number;
  errorCount: number;
  circuitBreakerState: "CLOSED" | "OPEN" | "HALF_OPEN";
}

const TYPE_LABELS: Record<string, string> = {
  mpesa: "M-Pesa",
  bank: "Bank",
  airtime: "Airtime",
  sandbox: "Sandbox",
};

export default function AdminProvidersPage() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({});
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    providerType: "sandbox",
    environment: "sandbox",
    enabled: true,
    priority: 100,
    config: {},
    maintenance: false,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshingHealth, setRefreshingHealth] = useState(false);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/providers");
      const body = await res.json();
      if (body.data) setProviders(body.data);
      else setProviders([]);
    } catch {
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    setRefreshingHealth(true);
    try {
      const res = await fetch("/api/admin/providers/health");
      const body = await res.json();
      if (body.data) {
        const healthMap: Record<string, ProviderHealth> = {};
        for (const h of body.data) healthMap[h.providerId] = h;
        setHealth(healthMap);
      }
    } catch {
      // ignore
    } finally {
      setRefreshingHealth(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchProviders, fetchHealth]);

  const openEditor = (p?: Provider) => {
    if (p) {
      setEditing(p);
      setForm({
        code: p.code,
        name: p.name,
        providerType: p.providerType,
        environment: p.environment,
        enabled: p.enabled,
        priority: p.priority ?? 100,
        config: p.config,
        maintenance: p.maintenance,
      });
    } else {
      setEditing(null);
      setForm({ code: "", name: "", providerType: "sandbox", environment: "sandbox", enabled: true, priority: 100, config: {}, maintenance: false });
    }
    setEditorOpen(true);
  };

  const saveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const isEdit = !!editing;
      const res = await fetch(isEdit ? `/api/admin/providers/${editing.id}` : "/api/admin/providers", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Save failed");
      setMessage(isEdit ? "Provider updated" : "Provider created");
      setEditorOpen(false);
      fetchProviders();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleProvider = async (p: Provider) => {
    const newEnabled = !p.enabled;
    if (!window.confirm(`${newEnabled ? "Enable" : "Disable"} provider "${p.name}"?`)) return;
    try {
      const res = await fetch(`/api/admin/providers/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Toggle failed");
      fetchProviders();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const deleteProvider = async (p: Provider) => {
    if (!window.confirm(`Delete provider "${p.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/providers/${p.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Delete failed");
      fetchProviders();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Providers & routing"
        subtitle="Rails behind the adapter layer. All execution goes through the provider registry."
        actions={<Button onClick={() => openEditor()}>+ Add provider</Button>}
      />

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex justify-between">
          <span>{message}</span>
          <button className="text-emerald-600 hover:underline" onClick={() => setMessage(null)}>Dismiss</button>
        </div>
      )}

      <Card>
        {loading ? (
          <div className="space-y-3 p-6">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : providers?.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">No providers configured yet.</div>
        ) : (
          <>
            <TableShell headers={["Code", "Name", "Type", "Env", "Priority", "Health", "Circuit", "State", "Maintenance", "Actions"]}>
              {(providers ?? []).map(p => {
                const h = health[p.id];
                const healthTone = h?.status === "HEALTHY" ? "success" : h?.status === "DEGRADED" ? "warning" : "danger";
                const cbTone = h?.circuitBreakerState === "OPEN" ? "danger" : h?.circuitBreakerState === "HALF_OPEN" ? "warning" : "success";
                return (
                  <tr key={p.id} className="hover:bg-surface/60">
                    <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3">
                      <Badge tone="info">{TYPE_LABELS[p.providerType] ?? p.providerType}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={p.environment === "production" ? "danger" : "neutral"}>{p.environment}</Badge>
                    </td>
                    <td className="px-4 py-3">{p.priority ?? "—"}</td>
                    <td className="px-4 py-3">
                      {h ? <Badge tone={healthTone}>{h.status}</Badge> : <Badge tone="neutral">Unknown</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      {h ? <Badge tone={cbTone}>{h.circuitBreakerState}</Badge> : <Badge tone="neutral">—</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={p.enabled ? "success" : "neutral"}>{p.enabled ? "ENABLED" : "DISABLED"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={p.maintenance ? "warning" : "neutral"}>{p.maintenance ? "ON" : "OFF"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => openEditor(p)}>Edit</Button>
                      <Switch
                        checked={p.enabled}
                        onCheckedChange={() => toggleProvider(p)}
                        disabled={loading}
                      />
                      <Switch
                        checked={p.maintenance}
                        onCheckedChange={(checked) => {
                          fetch(`/api/admin/providers/${p.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ maintenance: checked }),
                          }).then(() => fetchProviders());
                        }}
                        label={p.maintenance ? "Disable maintenance" : "Enable maintenance"}
                      />
                      <Button size="sm" variant="danger" onClick={() => deleteProvider(p)}>Delete</Button>
                    </td>
                  </tr>
                );
              })}
            </TableShell>
          </>
        )}
      </Card>

      {/* Health Summary */}
      <Card className="mt-6 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Provider Health Overview</h2>
          <Button size="sm" variant="secondary" onClick={fetchHealth} disabled={refreshingHealth}>
            {refreshingHealth ? <Spinner className="h-4 w-4" /> : "Refresh health"}
          </Button>
        </div>
        {providers ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {providers.map(p => {
              const h = health[p.id];
              const healthTone = h?.status === "HEALTHY" ? "success" : h?.status === "DEGRADED" ? "warning" : "danger";
              return (
                <Card key={p.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted">{p.code} · {TYPE_LABELS[p.providerType] ?? p.providerType}</p>
                  </div>
                  <div className="text-right">
                    {h ? (
                      <>
                        <Badge tone={healthTone}>{h.status}</Badge>
                        <p className="mt-1 text-xs text-muted">
                          {h.latencyMs !== null ? `${h.latencyMs}ms latency` : "N/A"} · {h.successRate.toFixed(1)}% success
                        </p>
                        <p className="text-xs text-muted">
                          CB: {h.circuitBreakerState} · Errors: {h.errorCount}
                        </p>
                      </>
                    ) : <Badge tone="neutral">No health data</Badge>}
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
        )}
      </Card>

      {/* Editor Modal */}
      <Modal open={editorOpen} onClose={() => { setEditorOpen(false); setEditing(null); }} title={editing ? "Edit provider" : "Add provider"}>
        <form onSubmit={saveProvider} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-code">Code</Label>
              <Input id="p-code" required disabled={!!editing} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="mpesa_safaricom" />
            </div>
            <div>
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Safaricom M-Pesa" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-type">Provider type</Label>
              <Select id="p-type" value={form.providerType} onChange={(e) => setForm({ ...form, providerType: e.target.value })}>
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank</option>
                <option value="airtime">Airtime</option>
                <option value="sandbox">Sandbox</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="p-env">Environment</Label>
              <Select id="p-env" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-priority">Priority</Label>
              <Input id="p-priority" type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
            </div>
            <div>
              <Label htmlFor="p-maintenance">Maintenance mode</Label>
              <Switch checked={form.maintenance} onCheckedChange={(checked) => setForm({ ...form, maintenance: checked })} label={form.maintenance ? "Enabled" : "Disabled"} />
            </div>
          </div>
          <div>
            <Label>Config (JSON)</Label>
            <textarea
              className="focus-ring w-full rounded-control border border-borderline bg-white px-3 py-2.5 text-sm font-mono text-xs"
              rows={4}
              value={JSON.stringify(form.config, null, 2)}
              onChange={(e) => { try { setForm({ ...form, config: JSON.parse(e.target.value) }); } catch { /* keep last valid config */ } }}
              placeholder='{"requiresCredentials": true}'
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.enabled} onCheckedChange={(checked) => setForm({ ...form, enabled: checked })} label={form.enabled ? "Enabled" : "Disabled"} />
          </div>
          {message && <p className="text-sm text-danger">{message}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setEditorOpen(false); setEditing(null); }}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? <Spinner className="h-4 w-4 text-white" /> : editing ? "Save changes" : "Add provider"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}