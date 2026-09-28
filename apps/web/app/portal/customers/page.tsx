"use client";
/** Customers — who pays you, identified by phone, ID number and KRA PIN. */
import { useEffect, useState } from "react";
import { PageHeader, Input, Label, Button, TableShell, Badge, Skeleton, EmptyState, Modal, Spinner } from "@/components/ui";
import { IdentityFields, IdentityCell, EMPTY_IDENTITY, type IdentityValue } from "@/components/identity-fields";

interface Customer {
  id: string;
  type: string;
  name: string;
  phone: string | null;
  email: string | null;
  idType: string | null;
  idNumber: string | null;
  kraPin: string | null;
  createdAt: string;
}

const EMPTY = { name: "", phone: "", email: "", type: "individual", address: "" };

export default function CustomersPage() {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [identity, setIdentity] = useState<IdentityValue>(EMPTY_IDENTITY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(query = q) {
    fetch(`/api/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`)
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch(() => setRows([]));
  }
  useEffect(() => load(""), []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...identity }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Could not save");
        return;
      }
      setOpen(false);
      setForm(EMPTY);
      setIdentity(EMPTY_IDENTITY);
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="People and businesses that pay you. Their KRA PIN is printed on eTIMS invoices so they can claim input VAT; ID numbers make them easy to tell apart."
        actions={<Button onClick={() => setOpen(true)}>+ Add customer</Button>}
      />
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <Input aria-label="Search customers" placeholder="Search by name, phone, ID number or KRA PIN…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {!rows ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title={q ? "No matching customers" : "No customers yet"} description="Customers are also created automatically when a known phone number pays your paybill." />
      ) : (
        <TableShell headers={["Name", "Phone", "Identity", "Type", "Added"]}>
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-surface/60">
              <td className="px-4 py-3">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted">{c.email ?? ""}</p>
              </td>
              <td className="px-4 py-3 font-mono text-xs">{c.phone ?? "—"}</td>
              <td className="px-4 py-3"><IdentityCell idType={c.idType} idNumber={c.idNumber} kraPin={c.kraPin} /></td>
              <td className="px-4 py-3"><Badge tone="neutral">{c.type}</Badge></td>
              <td className="px-4 py-3 text-xs text-muted">{new Date(c.createdAt).toLocaleDateString("en-KE")}</td>
            </tr>
          ))}
        </TableShell>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add customer">
        <form onSubmit={create} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div>
              <Label htmlFor="cu-name">Name</Label>
              <Input id="cu-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="cu-type">Type</Label>
              <select id="cu-type" className="focus-ring w-full rounded-control border border-borderline bg-white px-3 py-2.5 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="individual">Individual</option>
                <option value="business">Business</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cu-phone">Phone</Label>
              <Input id="cu-phone" inputMode="tel" placeholder="0712 345 678" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="cu-email">Email</Label>
              <Input id="cu-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <IdentityFields prefix="cu" value={identity} onChange={setIdentity} business={form.type === "business"} />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : "Save customer"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
