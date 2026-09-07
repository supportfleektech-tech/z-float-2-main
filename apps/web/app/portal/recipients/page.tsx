"use client";
import { useEffect, useState } from "react";
import {
  PageHeader,
  Input,
  Label,
  Button,
  TableShell,
  Badge,
  Skeleton,
  EmptyState,
  Modal,
} from "@/components/ui";
interface Recipient {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  type: string;
  status: string;
  riskFlags: string[];
}
export default function RecipientsPage() {
  const [rows, setRows] = useState<Recipient[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    type: "person",
  });
  const [error, setError] = useState<string | null>(null);
  function load() {
    fetch("/api/recipients")
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch(() => setRows([]));
  }
  useEffect(load, []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/recipients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error?.message ?? "Failed");
      return;
    }
    setOpen(false);
    setForm({ name: "", phone: "", email: "", type: "person" });
    load();
  }
  return (
    <div>
      {" "}
      <PageHeader
        title="Saved recipients"
        subtitle="Verified payees — suppliers, employees and people you pay regularly. New payees need an approver's sign-off in the Approval center before they can receive funds."
        actions={<Button onClick={() => setOpen(true)}>+ Add recipient</Button>}
      />{" "}
      {!rows ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No recipients yet"
          description="Add your first recipient to get started."
        />
      ) : (
        <TableShell
          headers={["Name", "Phone", "Email", "Type", "Status", "Risk"]}
        >
          {" "}
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-surface/60">
              {" "}
              <td className="px-4 py-3 font-medium">{r.name}</td>{" "}
              <td className="px-4 py-3 font-mono text-xs">{r.phone ?? "—"}</td>{" "}
              <td className="px-4 py-3 text-sm text-muted">{r.email ?? "—"}</td>{" "}
              <td className="px-4 py-3">
                <Badge tone="neutral">{r.type}</Badge>
              </td>{" "}
              <td className="px-4 py-3">
                <Badge tone={r.status === "ACTIVE" ? "success" : r.status === "REJECTED" ? "danger" : "warning"}>
                  {r.status === "PENDING" ? "Pending approval" : r.status}
                </Badge>
              </td>{" "}
              <td className="px-4 py-3">
                {" "}
                {r.riskFlags.length ? (
                  <Badge tone="danger">{r.riskFlags.join(", ")}</Badge>
                ) : (
                  <span className="text-xs text-muted">None</span>
                )}{" "}
              </td>{" "}
            </tr>
          ))}{" "}
        </TableShell>
      )}{" "}
      <Modal open={open} onClose={() => setOpen(false)} title="Add recipient">
        {" "}
        <form onSubmit={create} className="space-y-4">
          {" "}
          <div>
            {" "}
            <Label htmlFor="rc-name">Name</Label>{" "}
            <Input
              id="rc-name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />{" "}
          </div>{" "}
          <div>
            {" "}
            <Label htmlFor="rc-phone">Phone (Kenyan mobile)</Label>{" "}
            <Input
              id="rc-phone"
              required
              inputMode="tel"
              placeholder="0712 345 678"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />{" "}
          </div>{" "}
          <div>
            {" "}
            <Label htmlFor="rc-email">Email (optional)</Label>{" "}
            <Input
              id="rc-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />{" "}
          </div>{" "}
          <div>
            {" "}
            <Label htmlFor="rc-type">Type</Label>{" "}
            <select
              id="rc-type"
              className="focus-ring w-full rounded-control border border-borderline bg-white px-3 py-2.5 text-sm"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {" "}
              <option value="person">Person</option>{" "}
              <option value="supplier">Supplier</option>{" "}
              <option value="employee">Employee</option>{" "}
              <option value="biller">Biller</option>{" "}
            </select>{" "}
          </div>{" "}
          {error ? <p className="text-sm text-danger">{error}</p> : null}{" "}
          <div className="flex justify-end gap-2">
            {" "}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>{" "}
            <Button type="submit">Save recipient</Button>{" "}
          </div>{" "}
        </form>{" "}
      </Modal>{" "}
    </div>
  );
}
