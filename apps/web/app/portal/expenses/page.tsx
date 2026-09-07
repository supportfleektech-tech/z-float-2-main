"use client";
import { useEffect, useState } from "react";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Label,
  TableShell,
  Skeleton,
  Modal,
  Spinner,
} from "@/components/ui";
interface Charge {
  id: string;
  description: string;
  amountMinor: string;
  createdAt: string;
}
export default function ExpensesPage() {
  const [rows, setRows] = useState<Charge[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    description: "",
    amount: "",
    payNow: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function load() {
    fetch("/api/expenses")
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch(() => setRows([]));
  }
  useEffect(load, []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error?.message ?? "Failed to record expense");
      return;
    }
    setOpen(false);
    setForm({ description: "", amount: "", payNow: true });
    load();
  }
  return (
    <div>
      {" "}
      <PageHeader
        title="Petty cash & expenses"
        subtitle="Record team spend — optionally pay it straight from the wallet."
        actions={
          <Button onClick={() => setOpen(true)}>+ Record expense</Button>
        }
      />{" "}
      {!rows ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-muted">
          No expenses recorded yet.
        </Card>
      ) : (
        <TableShell headers={["Description", "Amount", "Recorded"]}>
          {" "}
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-surface/60">
              {" "}
              <td className="px-4 py-3 font-medium">{c.description}</td>{" "}
              <td className="px-4 py-3 font-medium">
                KES {(BigInt(c.amountMinor) / 100n).toString()}
              </td>{" "}
              <td className="px-4 py-3 text-xs text-muted">
                {new Date(c.createdAt).toLocaleString()}
              </td>{" "}
            </tr>
          ))}{" "}
        </TableShell>
      )}{" "}
      <Modal open={open} onClose={() => setOpen(false)} title="Record expense">
        {" "}
        <form onSubmit={create} className="space-y-4">
          {" "}
          <div>
            {" "}
            <Label>Description</Label>{" "}
            <Input
              required
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="e.g. Taxi to client site"
            />{" "}
          </div>{" "}
          <div>
            {" "}
            <Label>Amount (KES)</Label>{" "}
            <Input
              required
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />{" "}
          </div>{" "}
          <label className="flex items-center gap-2 text-sm">
            {" "}
            <input
              type="checkbox"
              checked={form.payNow}
              onChange={(e) => setForm({ ...form, payNow: e.target.checked })}
              className="h-4 w-4 accent-[#0F5BFF]"
            />{" "}
            Pay now from wallet (records a payment too){" "}
          </label>{" "}
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
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner className="h-4 w-4 text-white" /> : "Save"}
            </Button>{" "}
          </div>{" "}
        </form>{" "}
      </Modal>{" "}
    </div>
  );
}
