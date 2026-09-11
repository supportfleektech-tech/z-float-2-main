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
  Tabs,
} from "@/components/ui";
import { formatKES } from "@/lib/money";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  riskTier: string;
  kybStatus: string;
  defaultCurrency: string;
  userCount: number;
  paymentCount: number;
  volumeMinor: string;
  createdAt: string;
  settings: Record<string, unknown>;
}

interface TenantDetail extends Tenant {
  wallets: Array<{ id: string; name: string; currency: string; availableMinor: string; status: string }>;
  branches: Array<{ id: string; name: string; code: string }>;
  users: Array<{ id: string; email: string; fullName: string; status: string; roles: string[] }>;
  recentPayments: Array<{ id: string; amountMinor: string; status: string; channel: string; createdAt: string }>;
}

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  ACTIVE: "success",
  PENDING: "warning",
  SUSPENDED: "danger",
  CLOSED: "neutral",
};

const KYB_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  APPROVED: "success",
  NOT_SUBMITTED: "neutral",
  SUBMITTED: "warning",
  NEEDS_INFO: "warning",
  REJECTED: "danger",
};


export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedTenant, setSelectedTenant] = useState<TenantDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState("Overview");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    status: "PENDING" as Tenant["status"],
    riskTier: "STANDARD",
    kybStatus: "NOT_SUBMITTED",
    defaultCurrency: "KES",
    settings: {},
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      });
      if (search) params.set("search", search);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const res = await fetch(`/api/admin/tenants?${params.toString()}`);
      const body = await res.json();
      if (body.data) {
        setTenants(body.data.tenants ?? []);
        setTotalCount(body.data.total ?? 0);
      } else {
        setTenants([]);
        setTotalCount(0);
      }
    } catch {
      setError("Failed to load tenants");
      setTenants([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFilter]);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const fetchTenantDetail = async (tenant: Tenant) => {
    setDetailLoading(true);
    setDetailTab("Overview");
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}`);
      const body = await res.json();
      // The detail endpoint returns no aggregates — carry them over from the list row.
      if (body.data) setSelectedTenant({ ...body.data, userCount: tenant.userCount, paymentCount: tenant.paymentCount, volumeMinor: tenant.volumeMinor });
    } catch {
      setError("Failed to load tenant details");
    } finally {
      setDetailLoading(false);
    }
  };

  const openEditor = (tenant?: Tenant) => {
    if (tenant) {
      setEditingTenant(tenant);
      setForm({
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        riskTier: tenant.riskTier,
        kybStatus: tenant.kybStatus,
        defaultCurrency: tenant.defaultCurrency,
        settings: tenant.settings,
      });
    } else {
      setEditingTenant(null);
      setForm({
        name: "",
        slug: "",
        status: "PENDING",
        riskTier: "STANDARD",
        kybStatus: "NOT_SUBMITTED",
        defaultCurrency: "KES",
        settings: {},
      });
    }
    setEditorOpen(true);
  };

  const saveTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const isEdit = !!editingTenant;
      const res = await fetch(isEdit ? `/api/admin/tenants/${editingTenant.id}` : "/api/admin/tenants", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Save failed");
      setMessage(isEdit ? "Tenant updated" : "Tenant created");
      setEditorOpen(false);
      fetchTenants();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (tenant: Tenant, newStatus: Tenant["status"]) => {
    if (!window.confirm(`Change ${tenant.name} status to ${newStatus}?`)) return;
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Status change failed");
      fetchTenants();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const filteredTenants = tenants ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenants & Merchants"
        subtitle="Every workspace on the platform, with usage at a glance."
        actions={
          <Button onClick={() => openEditor()}>+ Add tenant</Button>
        }
      />

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex justify-between">
          <span>{message}</span>
          <button className="text-emerald-600 hover:underline" onClick={() => setMessage(null)}>Dismiss</button>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex justify-between">
          <span>{error}</span>
          <button className="text-red-600 hover:underline" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <Input
            placeholder="Search by name, slug, email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-64"
          />
          <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-40">
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING">Pending</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="CLOSED">Closed</option>
          </Select>
          <span className="text-sm text-muted ml-auto">
            {totalCount} tenant{totalCount !== 1 ? "s" : ""} total
          </span>
        </div>
      </Card>

      {/* Table */}
      <Card>
        {loading ? (
          <div className="space-y-3 p-6">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : filteredTenants.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">
            No tenants found{search ? ` for "${search}"` : ""}.
          </div>
        ) : (
          <>
            <TableShell headers={["Tenant", "Status", "KYB", "Risk", "Users", "Payments", "Volume", "Created", "Actions"]}>
              {filteredTenants.map((t) => (
                <tr key={t.id} className="hover:bg-surface/60 cursor-pointer" onClick={() => fetchTenantDetail(t)}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted font-mono">{t.slug}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={KYB_TONE[t.kybStatus] ?? "neutral"}>{t.kybStatus.replace("_", " ")}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{t.riskTier}</td>
                  <td className="px-4 py-3">{t.userCount}</td>
                  <td className="px-4 py-3">{t.paymentCount}</td>
                  <td className="px-4 py-3 font-medium">{formatKES(t.volumeMinor)}</td>
                  <td className="px-4 py-3 text-xs text-muted">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEditor(t); }}>Edit</Button>
                      <Select
                      value={t.status}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleStatusChange(t, e.target.value as Tenant["status"])}
                      className="w-32"
                    >
                      <option value="ACTIVE">Activate</option>
                      <option value="SUSPENDED">Suspend</option>
                      <option value="CLOSED">Close</option>
                    </Select>
                  </td>
                </tr>
              ))}
            </TableShell>
            {/* Pagination */}
            <div className="flex items-center justify-between p-4 border-t border-borderline">
              <span className="text-sm text-muted">
                Page {page} of {Math.ceil(totalCount / pageSize)}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                <Button size="sm" variant="secondary" onClick={() => setPage(p => Math.min(Math.ceil(totalCount / pageSize), p + 1))} disabled={page >= Math.ceil(totalCount / pageSize)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Detail Modal */}
      <Modal open={!!selectedTenant || detailLoading} onClose={() => setSelectedTenant(null)} title={selectedTenant?.name ?? "Tenant Details"}>
        {detailLoading || !selectedTenant ? (
          <div className="flex items-center justify-center h-64"><Spinner className="h-8 w-8" /></div>
        ) : (
          <div>
            <Tabs
              tabs={["Overview", "Wallets", "Branches", "Users", "Payments", "Settings"]}
              active={detailTab}
              onChange={setDetailTab}
            />
            {detailTab === "Overview" && (
              <div className="grid grid-cols-2 gap-3 pt-4 text-sm">
                <div className="rounded-control border border-borderline p-3"><p className="text-xs text-muted">Status</p><p className="mt-1 font-medium">{selectedTenant.status}</p></div>
                <div className="rounded-control border border-borderline p-3"><p className="text-xs text-muted">KYB</p><p className="mt-1 font-medium">{selectedTenant.kybStatus.replace("_", " ")}</p></div>
                <div className="rounded-control border border-borderline p-3"><p className="text-xs text-muted">Risk tier</p><p className="mt-1 font-medium">{selectedTenant.riskTier}</p></div>
                <div className="rounded-control border border-borderline p-3"><p className="text-xs text-muted">Currency</p><p className="mt-1 font-medium">{selectedTenant.defaultCurrency}</p></div>
                <div className="rounded-control border border-borderline p-3"><p className="text-xs text-muted">Users</p><p className="mt-1 font-medium">{selectedTenant.userCount}</p></div>
                <div className="rounded-control border border-borderline p-3"><p className="text-xs text-muted">Volume</p><p className="mt-1 font-medium">{formatKES(selectedTenant.volumeMinor)}</p></div>
                <div className="rounded-control border border-borderline p-3 col-span-2"><p className="text-xs text-muted">Slug</p><p className="mt-1 font-mono text-xs">{selectedTenant.slug}</p></div>
              </div>
            )}
            {detailTab === "Wallets" && (
              selectedTenant.wallets.length === 0 ? <p className="pt-4 text-sm text-muted">No wallets.</p> :
              <TableShell headers={["Name", "Currency", "Available", "Status"]}>
                {selectedTenant.wallets.map((w) => (
                  <tr key={w.id}>
                    <td className="px-4 py-3 font-medium">{w.name}</td>
                    <td className="px-4 py-3">{w.currency}</td>
                    <td className="px-4 py-3">{formatKES(w.availableMinor)}</td>
                    <td className="px-4 py-3"><Badge tone="neutral">{w.status}</Badge></td>
                  </tr>
                ))}
              </TableShell>
            )}
            {detailTab === "Branches" && (
              selectedTenant.branches.length === 0 ? <p className="pt-4 text-sm text-muted">No branches.</p> :
              <TableShell headers={["Name", "Code"]}>
                {selectedTenant.branches.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 font-medium">{b.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{b.code}</td>
                  </tr>
                ))}
              </TableShell>
            )}
            {detailTab === "Users" && (
              selectedTenant.users.length === 0 ? <p className="pt-4 text-sm text-muted">No users.</p> :
              <TableShell headers={["Name", "Email", "Status", "Roles"]}>
                {selectedTenant.users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 font-medium">{u.fullName}</td>
                    <td className="px-4 py-3 text-xs">{u.email}</td>
                    <td className="px-4 py-3"><Badge tone="neutral">{u.status}</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted">{u.roles.join(", ") || "—"}</td>
                  </tr>
                ))}
              </TableShell>
            )}
            {detailTab === "Payments" && (
              selectedTenant.recentPayments.length === 0 ? <p className="pt-4 text-sm text-muted">No payments yet.</p> :
              <TableShell headers={["Amount", "Status", "Channel", "Created"]}>
                {selectedTenant.recentPayments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium">{formatKES(p.amountMinor)}</td>
                    <td className="px-4 py-3"><Badge tone="neutral">{p.status}</Badge></td>
                    <td className="px-4 py-3">{p.channel}</td>
                    <td className="px-4 py-3 text-xs text-muted">{new Date(p.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </TableShell>
            )}
            {detailTab === "Settings" && (
              <pre className="mt-4 max-h-96 overflow-auto rounded-control bg-surface p-4 font-mono text-xs">{JSON.stringify(selectedTenant.settings ?? {}, null, 2)}</pre>
            )}
          </div>
        )}
      </Modal>

      {/* Editor Modal */}
      <Modal open={editorOpen} onClose={() => { setEditorOpen(false); setEditingTenant(null); }} title={editingTenant ? "Edit tenant" : "New tenant"}>
        <form onSubmit={saveTenant} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-name">Name</Label>
              <Input id="t-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Traders Ltd" />
            </div>
            <div>
              <Label htmlFor="t-slug">Slug</Label>
              <Input id="t-slug" required disabled={!!editingTenant} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })} placeholder="acme-traders" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="t-status">Status</Label>
              <Select id="t-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Tenant["status"] })}>
                <option value="PENDING">PENDING</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
                <option value="CLOSED">CLOSED</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="t-risk">Risk Tier</Label>
              <Select id="t-risk" value={form.riskTier} onChange={(e) => setForm({ ...form, riskTier: e.target.value })}>
                <option value="STANDARD">STANDARD</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="t-kyb">KYB Status</Label>
              <Select id="t-kyb" value={form.kybStatus} onChange={(e) => setForm({ ...form, kybStatus: e.target.value })}>
                <option value="NOT_SUBMITTED">NOT_SUBMITTED</option>
                <option value="SUBMITTED">SUBMITTED</option>
                <option value="APPROVED">APPROVED</option>
                <option value="REJECTED">REJECTED</option>
                <option value="NEEDS_INFO">NEEDS_INFO</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="t-currency">Default Currency</Label>
            <Input id="t-currency" value={form.defaultCurrency} onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value })} />
          </div>
          <div>
            <Label>Settings (JSON)</Label>
            <textarea
              className="focus-ring w-full rounded-control border border-borderline bg-white px-3 py-2.5 text-sm font-mono text-xs"
              rows={4}
              value={JSON.stringify(form.settings, null, 2)}
              onChange={(e) => { try { setForm({ ...form, settings: JSON.parse(e.target.value) }); } catch { /* keep last valid settings */ } }}
              placeholder='{"allowBulk": true, "allowPayroll": true}'
            />
          </div>
          {message && <p className="text-sm text-danger">{message}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => { setEditorOpen(false); setEditingTenant(null); }}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? <Spinner className="h-4 w-4 text-white" /> : editingTenant ? "Save changes" : "Create tenant"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}