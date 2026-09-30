"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatKES } from "@/lib/money";
import {
  PageHeader,
  Button,
  Input,
  Label,
  Select,
  TableShell,
  Skeleton,
  Modal,
  Spinner,
  Badge,
  EmptyState,
} from "@/components/ui";

interface Ledger {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

interface Expense {
  id: string;
  description: string;
  amountMinor: string;
  category: string;
  ledgerId: string | null;
  ledgerName: string | null;
  receiptFileId: string | null;
  receiptFilename: string | null;
  createdAt: string;
}

const CATEGORY_SUGGESTIONS = [
  "General",
  "Travel",
  "Meals",
  "Office Supplies",
  "Transport",
  "Utilities",
  "Marketing",
  "Software",
  "Hardware",
  "Rent",
  "Salaries",
  "Contractors",
];

export default function ExpensesPage() {
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [activeLedgerId, setActiveLedgerId] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false);
  const [form, setForm] = useState({
    description: "",
    amount: "",
    category: "General",
    ledgerId: "",
    payNow: true,
  });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [newLedgerName, setNewLedgerName] = useState("");
  const [newLedgerDesc, setNewLedgerDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadLedgers = useCallback(() => {
    fetch("/api/expense-ledgers")
      .then((r) => r.json())
      .then((d) => setLedgers(d.data ?? []))
      .catch(() => setLedgers([]));
  }, []);

  const load = useCallback(() => {
    const url =
      activeLedgerId === "all"
        ? "/api/expenses"
        : `/api/expenses?ledgerId=${activeLedgerId}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch(() => setRows([]));
  }, [activeLedgerId]);

  useEffect(loadLedgers, [loadLedgers]);
  useEffect(load, [load]);

  const totalMinor = (rows ?? []).reduce((sum, r) => sum + BigInt(r.amountMinor), 0n);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("description", form.description);
    fd.set("amount", form.amount);
    fd.set("category", form.category);
    fd.set("payNow", String(form.payNow));
    if (form.ledgerId) fd.set("ledgerId", form.ledgerId);
    if (receiptFile) fd.set("receipt", receiptFile);
    const res = await fetch("/api/expenses", { method: "POST", body: fd });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error?.message ?? "Failed to record expense");
      return;
    }
    setOpen(false);
    setForm({ description: "", amount: "", category: "General", ledgerId: "", payNow: true });
    setReceiptFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    load();
  }

  async function createLedger(e: React.FormEvent) {
    e.preventDefault();
    setLedgerBusy(true);
    const res = await fetch("/api/expense-ledgers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newLedgerName, description: newLedgerDesc || null }),
    });
    const data = await res.json();
    setLedgerBusy(false);
    if (!res.ok) {
      setError(data.error?.message ?? "Failed to create ledger");
      return;
    }
    setLedgerModalOpen(false);
    setNewLedgerName("");
    setNewLedgerDesc("");
    loadLedgers();
  }

  function exportCsv() {
    const url =
      activeLedgerId === "all"
        ? "/api/expenses?export=csv"
        : `/api/expenses?ledgerId=${activeLedgerId}&export=csv`;
    window.open(url, "_blank");
  }

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Track spend with receipts, categories, and ledgers."
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv}>
              Export CSV
            </Button>
            <Button variant="secondary" onClick={() => setLedgerModalOpen(true)}>
              + Ledger
            </Button>
            <Button onClick={() => setOpen(true)}>+ Record expense</Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label>Ledger:</Label>
          <Select
            value={activeLedgerId}
            onChange={(e) => setActiveLedgerId(e.target.value)}
            className="w-48"
          >
            <option value="all">All ledgers</option>
            {ledgers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        {rows && rows.length > 0 && (
          <div className="flex items-center gap-4 text-sm text-muted">
            <span>{rows.length} expense{rows.length !== 1 ? "s" : ""}</span>
            <span className="font-medium text-ink">Total: {formatKES(totalMinor.toString())}</span>
          </div>
        )}
      </div>

      {!rows ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No expenses found"
          description={
            activeLedgerId === "all"
              ? "Record your first expense to get started."
              : "No expenses in this ledger yet."
          }
          action={<Button onClick={() => setOpen(true)}>+ Record expense</Button>}
        />
      ) : (
        <TableShell
          headers={["Description", "Category", "Ledger", "Receipt", "Amount", "Recorded"]}
        >
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-surface/60">
              <td className="px-4 py-3 font-medium">{c.description}</td>
              <td className="px-4 py-3">
                <Badge tone="info">{c.category}</Badge>
              </td>
              <td className="px-4 py-3 text-sm text-muted">{c.ledgerName ?? "—"}</td>
              <td className="px-4 py-3 text-sm">
                {c.receiptFilename ? (
                  <span className="text-primary">Attached</span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="px-4 py-3 font-medium">{formatKES(c.amountMinor)}</td>
              <td className="px-4 py-3 text-xs text-muted">
                {new Date(c.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Record expense">
        <form onSubmit={create} className="space-y-4">
          <div>
            <Label>Description</Label>
            <Input
              required
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="e.g. Taxi to client site"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Amount (KES)</Label>
              <Input
                required
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div>
              <Label>Category</Label>
              <Input
                list="category-suggestions"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="General"
              />
              <datalist id="category-suggestions">
                {CATEGORY_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
          <div>
            <Label>Ledger</Label>
            <Select
              value={form.ledgerId}
              onChange={(e) => setForm({ ...form, ledgerId: e.target.value })}
            >
              <option value="">No ledger</option>
              {ledgers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Receipt (optional)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              className="focus-ring w-full rounded-control border border-borderline bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-surface file:px-3 file:py-1 file:text-sm file:font-medium"
            />
            {receiptFile && (
              <p className="mt-1 text-xs text-muted">
                {receiptFile.name} ({(receiptFile.size / 1024).toFixed(0)} KB)
              </p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.payNow}
              onChange={(e) => setForm({ ...form, payNow: e.target.checked })}
              className="h-4 w-4 accent-[#0F5BFF]"
            />
            Pay now from wallet (records a payment too)
          </label>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner className="h-4 w-4 text-white" /> : "Save"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={ledgerModalOpen}
        onClose={() => setLedgerModalOpen(false)}
        title="New ledger"
      >
        <form onSubmit={createLedger} className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              required
              value={newLedgerName}
              onChange={(e) => setNewLedgerName(e.target.value)}
              placeholder="e.g. Marketing Q3"
              maxLength={120}
            />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Input
              value={newLedgerDesc}
              onChange={(e) => setNewLedgerDesc(e.target.value)}
              placeholder="What is this ledger for?"
            />
          </div>
          {error && ledgerModalOpen ? (
            <p className="text-sm text-danger">{error}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setLedgerModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={ledgerBusy}>
              {ledgerBusy ? <Spinner className="h-4 w-4 text-white" /> : "Create"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
