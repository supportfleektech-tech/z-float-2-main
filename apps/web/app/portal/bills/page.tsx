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
  Select,
} from "@/components/ui";
interface Biller {
  id: string;
  code: string;
  name: string;
  category: string | null;
  channel: string;
  accountNumber: string;
}
interface BillerFormData {
  billerId: string | "custom";
  accountRef: string;
  amount: string;
  customName?: string;
  customChannel?: string;
  customAccountNumber?: string;
  customCategory?: string;
}
export default function BillsPage() {
  const [billers, setBillers] = useState<Biller[] | null>(null);
  const [paying, setPaying] = useState<BillerFormData | null>(null);
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
    const body: Record<string, unknown> = { accountRef: paying.accountRef, amount: paying.amount };
    if (paying.billerId === "custom") {
      body.customName = paying.customName;
      body.customChannel = paying.customChannel;
      body.customAccountNumber = paying.customAccountNumber;
      body.customCategory = paying.customCategory;
    } else {
      body.billerId = paying.billerId;
    }
    const res = await fetch("/api/billers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error?.message ?? "Payment failed");
      return;
    }
    const desc = paying.billerId === "custom"
      ? `Custom biller "${paying.customName}" KES ${paying.amount}`
      : `Bill ${data.data.paymentNumber}`;
    setResult(`${desc} → ${data.data.status}`);
    setPaying(null);
  }
  function openPay(b: Biller | "custom") {
    if (b === "custom") {
      setPaying({ billerId: "custom", accountRef: "", amount: "", customName: "", customChannel: "paybill", customAccountNumber: "", customCategory: "Utilities" });
    } else {
      setPaying({ billerId: b.id, accountRef: "", amount: "", customName: b.name, customChannel: b.channel, customAccountNumber: b.accountNumber, customCategory: b.category ?? "Utilities" });
    }
  }
  return (
    <div>
      <PageHeader
        title="Corporate bills"
        subtitle="Pay KPLC, water, internet and other billers from your wallet."
      />
      {result ? (
        <p className="mb-4 rounded-control border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">
          {result}
        </p>
      ) : null}
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
        <>
          <TableShell headers={["Biller", "Category", "Channel", "Account", "Actions"]}>
            {billers.map((b) => (
              <tr key={b.id} className="hover:bg-surface/60">
                <td className="px-4 py-3">
                  <p className="font-medium">{b.name}</p>
                  <p className="font-mono text-xs text-muted">{b.code}</p>
                </td>
                <td className="px-4 py-3">
                  <Badge tone="neutral">{b.category ?? "General"}</Badge>
                </td>
                <td className="px-4 py-3 text-xs uppercase text-muted">
                  {b.channel}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{b.accountNumber}</td>
                <td className="px-4 py-3">
                  <Button size="sm" onClick={() => openPay(b)}>
                    Pay bill
                  </Button>
                </td>
              </tr>
            ))}
          </TableShell>
          <div className="mt-6 p-4 rounded-lg border border-primary/20 bg-primary/5">
            <p className="font-medium mb-3">Custom biller</p>
            <p className="text-sm text-muted mb-3">Pay a biller not in the catalog by entering details manually.</p>
            <Button variant="secondary" size="sm" onClick={() => openPay("custom")}>
              Add custom biller
            </Button>
          </div>
        </>
      )}
      <Modal
        open={!!paying}
        onClose={() => setPaying(null)}
        title={paying?.billerId === "custom" ? "Custom biller" : `Pay ${paying?.customName ?? ""}`}
      >
        <form onSubmit={pay} className="space-y-4">
          {paying?.billerId === "custom" ? (
            <>
              <div>
                <Label>Biller name</Label>
                <Input
                  required
                  value={paying.customName ?? ""}
                  onChange={(e) => setPaying({ ...paying, customName: e.target.value })}
                  placeholder="e.g. My ISP"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Channel</Label>
                  <Select
                    value={paying.customChannel ?? "paybill"}
                    onChange={(e) => setPaying({ ...paying, customChannel: e.target.value })}
                  >
                    <option value="paybill">Paybill</option>
                    <option value="till">Till</option>
                  </Select>
                </div>
                <div>
                  <Label>Category</Label>
                  <Input
                    value={paying.customCategory ?? "Utilities"}
                    onChange={(e) => setPaying({ ...paying, customCategory: e.target.value })}
                    placeholder="Utilities"
                  />
                </div>
              </div>
              <div>
                <Label>Account number (paybill/till number)</Label>
                <Input
                  required
                  value={paying.customAccountNumber ?? ""}
                  onChange={(e) => setPaying({ ...paying, customAccountNumber: e.target.value })}
                  placeholder="e.g. 888880"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label>Account reference (meter / customer number)</Label>
                <Input
                  required
                  value={paying?.accountRef ?? ""}
                  onChange={(e) => setPaying({ ...paying!, accountRef: e.target.value })}
                  placeholder="e.g. 3102-XXX"
                />
              </div>
            </>
          )}
          <div>
            <Label>Amount (KES)</Label>
            <Input
              required
              inputMode="decimal"
              value={paying?.amount ?? ""}
              onChange={(e) => setPaying({ ...paying!, amount: e.target.value })}
              placeholder="0.00"
            />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner className="h-4 w-4 text-white" /> : paying?.billerId === "custom" ? "Pay custom biller" : "Pay bill"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
