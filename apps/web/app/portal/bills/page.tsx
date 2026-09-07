"use client";
import { useEffect, useState } from "react";
import {
  PageHeader,
  Button,
  Input,
  Label,
  TableShell,
  Badge,
  Skeleton,
  Modal,
  Spinner,
  EmptyState,
} from "@/components/ui";
interface Biller {
  id: string;
  code: string;
  name: string;
  category: string | null;
  channel: string;
  accountNumber: string;
}
export default function BillsPage() {
  const [billers, setBillers] = useState<Biller[] | null>(null);
  const [paying, setPaying] = useState<Biller | null>(null);
  const [accountRef, setAccountRef] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    fetch("/api/billers")
      .then((r) => r.json())
      .then((d) => setBillers(d.data ?? []))
      .catch(() => setBillers([]));
  }
  useEffect(load, []);
  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!paying) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/billers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billerId: paying.id, accountRef, amount }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error?.message ?? "Payment failed");
      return;
    }
    setResult(`Payment ${data.data.paymentNumber} → ${data.data.status}`);
    setPaying(null);
    setAccountRef("");
    setAmount("");
  }
  return (
    <div>
      {" "}
      <PageHeader
        title="Corporate bills"
        subtitle="Pay KPLC, water, internet and other billers from your wallet."
      />{" "}
      {result ? (
        <p className="mb-4 rounded-control border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">
          {result}
        </p>
      ) : null}{" "}
      {!billers ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : billers.length === 0 ? (
        <EmptyState
          title="No billers configured"
          description="Platform administrators add billers from the provider catalog."
        />
      ) : (
        <TableShell
          headers={["Biller", "Category", "Channel", "Account", "Actions"]}
        >
          {" "}
          {billers.map((b) => (
            <tr key={b.id} className="hover:bg-surface/60">
              {" "}
              <td className="px-4 py-3">
                {" "}
                <p className="font-medium">{b.name}</p>{" "}
                <p className="font-mono text-xs text-muted">{b.code}</p>{" "}
              </td>{" "}
              <td className="px-4 py-3">
                <Badge tone="neutral">{b.category ?? "General"}</Badge>
              </td>{" "}
              <td className="px-4 py-3 text-xs uppercase text-muted">
                {b.channel}
              </td>{" "}
              <td className="px-4 py-3 font-mono text-xs">{b.accountNumber}</td>{" "}
              <td className="px-4 py-3">
                {" "}
                <Button size="sm" onClick={() => setPaying(b)}>
                  Pay bill
                </Button>{" "}
              </td>{" "}
            </tr>
          ))}{" "}
        </TableShell>
      )}{" "}
      <Modal
        open={!!paying}
        onClose={() => setPaying(null)}
        title={`Pay ${paying?.name ?? ""}`}
      >
        {" "}
        <form onSubmit={pay} className="space-y-4">
          {" "}
          <div>
            {" "}
            <Label>Account reference (meter / customer number)</Label>{" "}
            <Input
              required
              value={accountRef}
              onChange={(e) => setAccountRef(e.target.value)}
              placeholder="e.g. 3102-XXX"
            />{" "}
          </div>{" "}
          <div>
            {" "}
            <Label>Amount (KES)</Label>{" "}
            <Input
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />{" "}
          </div>{" "}
          {error ? <p className="text-sm text-danger">{error}</p> : null}{" "}
          <div className="flex justify-end gap-2">
            {" "}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPaying(null)}
            >
              Cancel
            </Button>{" "}
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner className="h-4 w-4 text-white" /> : "Pay bill"}
            </Button>{" "}
          </div>{" "}
        </form>{" "}
      </Modal>{" "}
    </div>
  );
}
