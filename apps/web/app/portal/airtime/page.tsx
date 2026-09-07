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
} from "@/components/ui";
interface AirtimeProduct {
  id: string;
  network: string;
  name: string;
  type: string;
  denominationMinor: string;
  enabled: boolean;
}
export default function AirtimePage() {
  const [rows, setRows] = useState<AirtimeProduct[] | null>(null);
  const [buying, setBuying] = useState<AirtimeProduct | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    fetch("/api/airtime")
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch(() => setRows([]));
  }
  useEffect(load, []);
  async function buy(e: React.FormEvent) {
    e.preventDefault();
    if (!buying) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/airtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: buying.id, phone }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error?.message ?? "Airtime purchase failed");
      return;
    }
    setResult(`${buying.name} to ${phone} → ${data.data.status}`);
    setBuying(null);
    setPhone("");
  }
  return (
    <div>
      {" "}
      <PageHeader
        title="Airtime & data"
        subtitle="Top up staff and field teams across Safaricom, Airtel and Telkom."
      />{" "}
      {result ? (
        <p className="mb-4 rounded-control border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">
          {result}
        </p>
      ) : null}{" "}
      {!rows ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <TableShell
          headers={["Network", "Product", "Type", "Denomination", ""]}
        >
          {" "}
          {rows
            .filter((p) => p.enabled)
            .map((p) => (
              <tr key={p.id} className="hover:bg-surface/60">
                {" "}
                <td className="px-4 py-3">
                  <Badge tone="neutral">{p.network}</Badge>
                </td>{" "}
                <td className="px-4 py-3 font-medium">{p.name}</td>{" "}
                <td className="px-4 py-3 text-xs uppercase text-muted">
                  {p.type}
                </td>{" "}
                <td className="px-4 py-3 font-medium">
                  KES {(BigInt(p.denominationMinor) / 100n).toString()}
                </td>{" "}
                <td className="px-4 py-3">
                  <Button size="sm" onClick={() => setBuying(p)}>
                    Buy
                  </Button>
                </td>{" "}
              </tr>
            ))}{" "}
        </TableShell>
      )}{" "}
      <Modal
        open={!!buying}
        onClose={() => setBuying(null)}
        title={`Buy ${buying?.name ?? ""}`}
      >
        {" "}
        <form onSubmit={buy} className="space-y-4">
          {" "}
          <div>
            {" "}
            <Label>Recipient phone</Label>{" "}
            <Input
              required
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0712 345 678"
            />{" "}
          </div>{" "}
          {error ? <p className="text-sm text-danger">{error}</p> : null}{" "}
          <div className="flex justify-end gap-2">
            {" "}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setBuying(null)}
            >
              Cancel
            </Button>{" "}
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Spinner className="h-4 w-4 text-white" />
              ) : (
                "Buy airtime"
              )}
            </Button>{" "}
          </div>{" "}
        </form>{" "}
      </Modal>{" "}
    </div>
  );
}
