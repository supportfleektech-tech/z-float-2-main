"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Badge, Button, Input, Label, Select, Textarea, Skeleton, Modal, Spinner } from "@/components/ui";

interface TenantRef { id: string; name: string }
interface RoleRef { id: string; name: string; description: string | null }
interface ApprovalRuleDto {
  minAmountMinor?: number | null;
  maxAmountMinor?: number | null;
  mode: string;
  requiredRoles: string[];
  minApprovers: number;
  order: number;
}
interface PolicyDto {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  rules: ApprovalRuleDto[];
  version: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RuleDraft {
  id: number;
  minAmount: string; // KES or ""
  maxAmount: string; // KES or ""
  mode: "SEQUENTIAL" | "PARALLEL" | "ANY";
  roles: string[];
  minApprovers: string;
}

const KES = (minor?: number | null) => (minor == null ? "" : (minor / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 }));
const ruleSummary = (r: ApprovalRuleDto) => {
  const lo = r.minAmountMinor != null ? `KES ${KES(r.minAmountMinor)}` : "";
  const hi = r.maxAmountMinor != null ? `KES ${KES(r.maxAmountMinor)}` : "";
  const range = lo && hi ? `${lo} – ${hi}` : lo || hi || "any amount";
  const modeLabel = r.mode === "SEQUENTIAL" ? "in sequence" : r.mode === "PARALLEL" ? "in parallel" : "any approver";
  return `${range} · ${r.requiredRoles.join(" + ")} (${r.minApprovers}×) ${modeLabel}`;
};

let nextRuleId = 1;
const blankRule = (): RuleDraft => ({ id: nextRuleId++, minAmount: "", maxAmount: "", mode: "ANY", roles: [], minApprovers: "1" });

export default function AdminPoliciesPage() {
  const [tenants, setTenants] = useState<TenantRef[] | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [policies, setPolicies] = useState<PolicyDto[] | null>(null);
  const [roles, setRoles] = useState<RoleRef[]>([]);
  const [busyTenant, setBusyTenant] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PolicyDto | null>(null);
  const [form, setForm] = useState({ name: "", description: "", comment: "" });
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const loadTenants = useCallback(() => {
    fetch("/api/admin/policies")
      .then((r) => r.json())
      .then((d) => setTenants(d.data?.tenants ?? []))
      .catch(() => setTenants([]));
  }, []);
  useEffect(loadTenants, [loadTenants]);

  useEffect(() => {
    if (!tenantId) return;
    setBusyTenant(true);
    setPolicies(null);
    fetch(`/api/admin/policies?tenantId=${encodeURIComponent(tenantId)}`)
      .then((r) => r.json())
      .then((d) => {
        setPolicies(d.data?.policies ?? []);
        setRoles(d.data?.roles ?? []);
      })
      .catch(() => {
        setPolicies([]);
        setRoles([]);
      })
      .finally(() => setBusyTenant(false));
  }, [tenantId]);

  const roleNames = useMemo(() => roles.map((r) => r.name), [roles]);

  function openCreate() {
    setError(null);
    setEditing(null);
    setForm({ name: "", description: "", comment: "" });
    setRules([blankRule()]);
    setEditorOpen(true);
  }
  function openEdit(p: PolicyDto) {
    setError(null);
    setEditing(p);
    setForm({ name: p.name, description: p.description ?? "", comment: "" });
    setRules(
      p.rules.map((r) => ({
        id: nextRuleId++,
        minAmount: r.minAmountMinor != null ? KES(r.minAmountMinor) : "",
        maxAmount: r.maxAmountMinor != null ? KES(r.maxAmountMinor) : "",
        mode: r.mode === "SEQUENTIAL" || r.mode === "PARALLEL" ? r.mode : "ANY",
        roles: [...r.requiredRoles],
        minApprovers: String(r.minApprovers),
      })),
    );
    setEditorOpen(true);
  }

  const updateRule = (id: number, patch: Partial<RuleDraft>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const toggleRole = (id: number, role: string) =>
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, roles: r.roles.includes(role) ? r.roles.filter((x) => x !== role) : [...r.roles, role] } : r)));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payloadRules = rules.map((r) => ({
        minAmount: r.minAmount.trim() || undefined,
        maxAmount: r.maxAmount.trim() || undefined,
        mode: r.mode,
        requiredRoles: r.roles,
        minApprovers: Number(r.minApprovers) || 1,
      }));
      const res = editing
        ? await fetch(`/api/admin/policies/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: form.name.trim(), description: form.description.trim() || null, rules: payloadRules, comment: form.comment.trim() }),
          })
        : await fetch("/api/admin/policies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tenantId, name: form.name.trim(), description: form.description.trim() || null, rules: payloadRules }),
          });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Save failed");
        return;
      }
      // Maker-checker: the change is STAGED (202). It applies only after a
      // second platform admin approves it in Config approvals.
      const label = (d.data as { label?: string } | undefined)?.label;
      setNotice(`${label ? `${label} — ` : ""}change submitted. A second platform admin must approve it in Config approvals.`);
      setEditorOpen(false);
      setBusyTenant(true);
      const r2 = await fetch(`/api/admin/policies?tenantId=${encodeURIComponent(tenantId)}`);
      const d2 = await r2.json();
      setPolicies(d2.data?.policies ?? []);
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
      setBusyTenant(false);
    }
  }

  async function toggleActive(p: PolicyDto) {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/policies/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !p.active }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error?.message ?? "Failed to stage policy state change");
        return;
      }
      const label = (d.data as { label?: string } | undefined)?.label;
      setNotice(`${label ? `${label} — ` : ""}change submitted. A second platform admin must approve it in Config approvals.`);
      const r2 = await fetch(`/api/admin/policies?tenantId=${encodeURIComponent(tenantId)}`);
      const d2 = await r2.json();
      setPolicies(d2.data?.policies ?? []);
    } catch {
      setError("Network error — try again");
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Approval policies</h1>
      <p className="mt-1 text-sm text-muted">
        Multi-stage approval rules per tenant. Rule changes archive the previous version and bump the policy version. All changes are staged for a second platform admin's approval.
      </p>

      {notice ? (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>⏳ {notice}</span>
          <button className="text-emerald-600 hover:underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      ) : null}

      <Card className="mt-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Label htmlFor="tenant">Tenant</Label>
            <Select id="tenant" className="w-72" value={tenantId} onChange={(e) => setTenantId(e.target.value)} disabled={!tenants}>
              <option value="">— select tenant —</option>
              {(tenants ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </div>
          <Button size="sm" disabled={!tenantId} onClick={openCreate}>+ New policy</Button>
        </div>

        <div className="mt-5">
          {!tenantId ? (
            <p className="text-sm text-muted">Select a tenant to manage its approval policies.</p>
          ) : busyTenant ? (
            <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : policies === null ? null : policies.length === 0 ? (
            <p className="text-sm text-muted">No policies for this tenant yet — create the first one.</p>
          ) : (
            <div className="space-y-3">
              {policies.map((p) => (
                <div key={p.id} className="rounded-control border border-borderline p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{p.name}</span>
                        <Badge tone={p.active ? "success" : "neutral"}>{p.active ? "ACTIVE" : "PAUSED"}</Badge>
                        <Badge tone="info">v{p.version}</Badge>
                        <span className="text-xs text-muted">{p.rules.length} rule{p.rules.length === 1 ? "" : "s"}</span>
                      </div>
                      {p.description ? <p className="mt-1 text-sm text-muted">{p.description}</p> : null}
                      <ul className="mt-2 space-y-1">
                        {p.rules.map((r, i) => (
                          <li key={i} className="text-xs text-muted">
                            <span className="mr-2 inline-block h-1 w-1 rounded-full bg-primary align-middle" />
                            Rule {i + 1}: {ruleSummary(r)}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <button className="text-xs text-primary hover:underline" onClick={() => openEdit(p)}>Edit</button>
                      <button className="text-xs text-muted hover:underline" onClick={() => void toggleActive(p)}>{p.active ? "Pause" : "Activate"}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title={editing ? `Edit policy — v${editing.version}` : "New approval policy"}>
        <div className="space-y-4">
          {editing ? (
            <p className="rounded-control bg-surface px-3 py-2 text-xs text-muted">
              Publishing stages the change for a second platform admin; on approval, changed rules archive the current v{editing.version} and publish v{editing.version + 1}.
            </p>
          ) : null}
          <div>
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Supplier payouts > KES 50k" />
          </div>
          <div>
            <Label htmlFor="p-desc">Description</Label>
            <Input id="p-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional context for reviewers" />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="p-rules">Rules (first match applies)</Label>
              <Button type="button" variant="secondary" size="sm" onClick={() => setRules((rs) => [...rs, blankRule()])}>+ Add rule</Button>
            </div>
            {rules.length === 0 ? (
              <p className="text-sm text-muted">No rules — add one to require approvals.</p>
            ) : (
              rules.map((r, idx) => (
                <div key={r.id} data-rule={idx} className="rounded-control border border-borderline p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted">Rule {idx + 1}</span>
                    <button type="button" className="text-xs text-danger hover:underline" onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))}>Remove</button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={`r${r.id}-min`}>Min amount (KES)</Label>
                      <Input id={`r${r.id}-min`} inputMode="decimal" value={r.minAmount} onChange={(e) => updateRule(r.id, { minAmount: e.target.value })} placeholder="0" />
                    </div>
                    <div>
                      <Label htmlFor={`r${r.id}-max`}>Max amount (KES)</Label>
                      <Input id={`r${r.id}-max`} inputMode="decimal" value={r.maxAmount} onChange={(e) => updateRule(r.id, { maxAmount: e.target.value })} placeholder="no upper bound" />
                    </div>
                    <div>
                      <Label htmlFor={`r${r.id}-mode`}>Approval mode</Label>
                      <Select id={`r${r.id}-mode`} value={r.mode} onChange={(e) => updateRule(r.id, { mode: e.target.value as RuleDraft["mode"] })}>
                        <option value="ANY">Any listed approver</option>
                        <option value="PARALLEL">All in parallel</option>
                        <option value="SEQUENTIAL">Sequential stages</option>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={`r${r.id}-n`}>Min approvals</Label>
                      <Input id={`r${r.id}-n`} type="number" min={1} value={r.minApprovers} onChange={(e) => updateRule(r.id, { minApprovers: e.target.value })} />
                    </div>
                  </div>
                  <div className="mt-3">
                    <Label htmlFor={`r${r.id}-roles`}>Required roles</Label>
                    {roleNames.length === 0 ? (
                      <p className="text-xs text-muted">No approver roles found for this tenant.</p>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {roleNames.map((rn) => {
                          const on = r.roles.includes(rn);
                          return (
                            <button
                              key={rn}
                              type="button"
                              onClick={() => toggleRole(r.id, rn)}
                              className={`rounded-full border px-2.5 py-1 text-xs ${
                                on ? "border-primary bg-primary/10 text-primary" : "border-borderline text-muted hover:border-primary/40"
                              }`}
                            >
                              {on ? "✓ " : ""}{rn}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {editing ? (
            <div>
              <Label htmlFor="p-comment">Change note</Label>
              <Textarea id="p-comment" rows={2} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} placeholder="e.g. Raise single-approver limit after quarterly review" />
            </div>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button type="button" onClick={() => void save()} disabled={saving || !form.name.trim() || !tenantId}>
              {saving ? <Spinner className="h-4 w-4 text-white" /> : editing ? "Publish new version" : "Create policy"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
