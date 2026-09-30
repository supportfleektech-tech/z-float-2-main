"use client";

import { useEffect, useState } from "react";
import { PageHeader, Button, Input, Label, TableShell, Badge, Skeleton, Modal, Spinner } from "@/components/ui";

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  type: string;
  status: string;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  bankCode: string | null;
  tillNumber: string | null;
  tillName: string | null;
  paybillNumber: string | null;
  paybillName: string | null;
  paybillAccount: string | null;
}

interface Payment {
  id: string;
  paymentNumber: string;
  status: string;
  amountMinor: string;
  feeMinor: string;
  beneficiaryName: string;
  channel: string;
  product: string;
  createdAt: string;
}

const emptyForm = {
  name: "",
  phone: "",
  email: "",
  bankAccountName: "",
  bankAccountNumber: "",
  bankName: "",
  bankCode: "",
  tillNumber: "",
  tillName: "",
  paybillNumber: "",
  paybillName: "",
  paybillAccount: "",
};

export default function SuppliersPage() {
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statementSupplier, setStatementSupplier] = useState<Supplier | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  function load() {
    fetch("/api/recipients")
      .then((r) => r.json())
      .then((d) => setRows((d.data ?? []).filter((r: Supplier) => r.type === "supplier")))
      .catch(() => setRows([]));
  }

  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/recipients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, type: "supplier" }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error?.message ?? "Failed to add supplier");
      return;
    }
    setOpen(false);
    setForm(emptyForm);
    load();
  }

  async function openStatement(s: Supplier) {
    setStatementSupplier(s);
    setPayments(null);
    setPaymentsLoading(true);
    try {
      const res = await fetch(`/api/payments?beneficiaryId=${s.id}&limit=100`);
      const data = await res.json();
      setPayments(data.data ?? []);
    } catch {
      setPayments([]);
    } finally {
      setPaymentsLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Suppliers & vendors"
        subtitle="Verified payees with a payment history you can reconcile."
        actions={<Button onClick={() => setOpen(true)}>+ Add supplier</Button>}
      />

      {!rows ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <TableShell
          headers={["Supplier", "Phone", "Email", "Bank", "Paybill", "Till", "Status", ""]}
          empty={<div className="p-6 text-sm text-muted">No suppliers yet. Add your first supplier to get started.</div>}
        >
          {rows.map((s) => (
            <tr key={s.id} className="hover:bg-surface/60">
              <td className="px-4 py-3 font-medium">{s.name}</td>
              <td className="px-4 py-3 font-mono text-xs">{s.phone ?? "—"}</td>
              <td className="px-4 py-3 text-sm text-muted">{s.email ?? "—"}</td>
              <td className="px-4 py-3 text-sm text-muted">
                {s.bankAccountNumber ? `${s.bankName ?? ""} ${s.bankAccountNumber}`.trim() : "—"}
              </td>
              <td className="px-4 py-3 text-sm text-muted">
                {s.paybillNumber ? `${s.paybillName ?? ""} ${s.paybillNumber}`.trim() : "—"}
              </td>
              <td className="px-4 py-3 text-sm text-muted">
                {s.tillNumber ? `${s.tillName ?? ""} ${s.tillNumber}`.trim() : "—"}
              </td>
              <td className="px-4 py-3">
                <Badge tone={s.status === "ACTIVE" ? "success" : "warning"}>
                  {s.status === "PENDING" ? "Pending approval" : s.status}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right">
                <Button size="sm" variant="ghost" onClick={() => openStatement(s)}>
                  Statement
                </Button>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add supplier">
        <form onSubmit={create} className="space-y-4">
          <div>
            <Label>Supplier name</Label>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0712 345 678" />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>

          <div className="border-t border-borderline pt-4">
            <p className="mb-3 text-sm font-medium text-ink">Bank account details</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Bank name</Label>
                <Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
              </div>
              <div>
                <Label>Account name</Label>
                <Input value={form.bankAccountName} onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })} />
              </div>
              <div>
                <Label>Account number</Label>
                <Input value={form.bankAccountNumber} onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })} />
              </div>
              <div>
                <Label>Bank code</Label>
                <Input value={form.bankCode} onChange={(e) => setForm({ ...form, bankCode: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="border-t border-borderline pt-4">
            <p className="mb-3 text-sm font-medium text-ink">Paybill details</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Paybill name</Label>
                <Input value={form.paybillName} onChange={(e) => setForm({ ...form, paybillName: e.target.value })} />
              </div>
              <div>
                <Label>Paybill number</Label>
                <Input value={form.paybillNumber} onChange={(e) => setForm({ ...form, paybillNumber: e.target.value })} />
              </div>
              <div>
                <Label>Paybill account</Label>
                <Input value={form.paybillAccount} onChange={(e) => setForm({ ...form, paybillAccount: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="border-t border-borderline pt-4">
            <p className="mb-3 text-sm font-medium text-ink">Till details</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Till name</Label>
                <Input value={form.tillName} onChange={(e) => setForm({ ...form, tillName: e.target.value })} />
              </div>
              <div>
                <Label>Till number</Label>
                <Input value={form.tillNumber} onChange={(e) => setForm({ ...form, tillNumber: e.target.value })} />
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner className="h-4 w-4" /> : "Add supplier"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!statementSupplier} onClose={() => setStatementSupplier(null)} title={`Statement — ${statementSupplier?.name ?? ""}`}>
        {paymentsLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !payments || payments.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No payments to this supplier yet.</p>
        ) : (
          <TableShell headers={["Payment", "Amount", "Fee", "Channel", "Status", "Date"]}>
            {payments.map((p) => (
              <tr key={p.id} className="hover:bg-surface/60">
                <td className="px-4 py-3 font-mono text-xs">{p.paymentNumber}</td>
                <td className="px-4 py-3 font-mono text-xs">{Number(p.amountMinor).toLocaleString()}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{Number(p.feeMinor).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm">{p.channel}</td>
                <td className="px-4 py-3">
                  <Badge
                    tone={
                      p.status === "SUCCESS"
                        ? "success"
                        : p.status === "FAILED"
                          ? "danger"
                          : p.status === "PENDING_APPROVAL" || p.status === "PROVIDER_PENDING"
                            ? "warning"
                            : "neutral"
                    }
                  >
                    {p.status.replace(/_/g, " ")}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-sm text-muted">{new Date(p.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </Modal>
    </div>
  );
}
