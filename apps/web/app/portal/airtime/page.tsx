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
  Select,
} from "@/components/ui";
import { formatKES } from "@/lib/money";
interface AirtimeProduct {
  id: string;
  network: string;
  name: string;
  type: string;
  denominationMinor: string;
  enabled: boolean;
}
interface AirtimeFormData {
  productId: string | "custom";
  phone: string;
  customAmount?: string;
  customNetwork?: string;
  customType?: string;
  name?: string;
}
export default function AirtimePage() {
  const [rows, setRows] = useState<AirtimeProduct[] | null>(null);
  const [buying, setBuying] = useState<AirtimeFormData | null>(null);
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
    const body: Record<string, unknown> = { phone: buying.phone };
    if (buying.productId === "custom") {
      body.customAmount = buying.customAmount;
      body.customNetwork = buying.customNetwork;
      body.customType = buying.customType || "AIRTIME";
    } else {
      body.productId = buying.productId;
    }
    const res = await fetch("/api/airtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error?.message ?? "Airtime purchase failed");
      return;
    }
    const desc = buying.productId === "custom"
      ? `Custom ${buying.customType} KES ${buying.customAmount} to ${buying.phone}`
      : `${buying.name} to ${buying.phone}`;
    setResult(`${desc} → ${data.data.status}`);
    setBuying(null);
  }
  function openBuy(p: AirtimeProduct | "custom") {
    if (p === "custom") {
      setBuying({ productId: "custom", phone: "", customAmount: "", customNetwork: "SAF", customType: "AIRTIME" });
    } else {
      setBuying({ productId: p.id, phone: "", customAmount: "", customNetwork: p.network, customType: p.type, name: p.name });
    }
  }
  return (
    <div>
      <PageHeader
        title="Airtime & data"
        subtitle="Top up staff and field teams across Safaricom, Airtel and Telkom."
      />
      {result ? (
        <p className="mb-4 rounded-control border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">
          {result}
        </p>
      ) : null}
      {!rows ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <>
          <TableShell headers={["Network", "Product", "Type", "Denomination", ""]}>
            {rows
              .filter((p) => p.enabled)
              .map((p) => (
                <tr key={p.id} className="hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <Badge tone="neutral">{p.network}</Badge>
                  </td>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-xs uppercase text-muted">
                    {p.type}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {formatKES(p.denominationMinor)}
                  </td>
                  <td className="px-4 py-3">
                    <Button size="sm" onClick={() => openBuy(p)}>
                      Buy
                    </Button>
                  </td>
                </tr>
              ))}
          </TableShell>
          <div className="mt-6 p-4 rounded-lg border border-primary/20 bg-primary/5">
            <p className="font-medium mb-3">Custom amount</p>
            <p className="text-sm text-muted mb-3">Enter any amount and network for airtime or data top-up.</p>
            <Button variant="secondary" size="sm" onClick={() => openBuy("custom")}>
              Buy custom amount
            </Button>
          </div>
        </>
      )}
      <Modal
        open={!!buying}
        onClose={() => setBuying(null)}
        title={buying?.productId === "custom" ? "Custom airtime/data" : `Buy ${buying?.name ?? ""}`}
      >
        <form onSubmit={buy} className="space-y-4">
          {buying?.productId === "custom" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Network</Label>
                  <Select
                    value={buying.customNetwork ?? "SAF"}
                    onChange={(e) => setBuying({ ...buying, customNetwork: e.target.value })}
                  >
                    <option value="SAF">Safaricom</option>
                    <option value="AIRTEL">Airtel</option>
                    <option value="TELKOM">Telkom</option>
                  </Select>
                </div>
                <div>
                  <Label>Type</Label>
                  <Select
                    value={buying.customType ?? "AIRTIME"}
                    onChange={(e) => setBuying({ ...buying, customType: e.target.value })}
                  >
                    <option value="AIRTIME">Airtime</option>
                    <option value="DATA">Data</option>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Amount (KES)</Label>
                <Input
                  required
                  inputMode="decimal"
                  value={buying.customAmount ?? ""}
                  onChange={(e) => setBuying({ ...buying, customAmount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </>
          ) : (
            <div>
              <Label>Recipient phone</Label>
              <Input
                required
                inputMode="tel"
                value={buying?.phone ?? ""}
                onChange={(e) => setBuying({ ...buying!, phone: e.target.value })}
                placeholder="0712 345 678"
              />
            </div>
          )}
          <div>
            <Label>Recipient phone</Label>
            <Input
              required
              inputMode="tel"
              value={buying?.phone ?? ""}
              onChange={(e) => setBuying({ ...buying!, phone: e.target.value })}
              placeholder="0712 345 678"
            />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setBuying(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner className="h-4 w-4 text-white" /> : buying?.productId === "custom" ? "Buy airtime/data" : "Buy airtime"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
