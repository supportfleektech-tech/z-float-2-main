"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, Input, Label, Select, Textarea, PageHeader, Badge, Spinner } from "@/components/ui";
import { parseMinor, minorToDisplay, minorOrZero, MoneyParseError } from "@zfloat/money";

const CHANNELS = [
  { value: "mpesa", label: "M-Pesa phone (send)" },
  { value: "till", label: "Till number" },
  { value: "paybill", label: "Paybill" },
  { value: "bank", label: "Bank account" },
];

export default function NewPaymentPage() {
  const [wallet, setWallet] = useState<string>("");
  const [wallets, setWallets] = useState<Array<{ id: string; name: string; availableMinor: string }>>([]);
  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState("mpesa");
  const [recipientName, setRecipientName] = useState("");
  const [phone, setPhone] = useState("");
  const [remark, setRemark] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fee, setFee] = useState<{ feeMinor: string; percentBps: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ paymentId: string; status: string } | null>(null);

  useEffect(() => {
    fetch("/api/wallets")
      .then((r) => r.json())
      .then((d) => {
        setWallets(d.data ?? []);
        if (d.data?.[0]) setWallet(d.data[0].id);
      })
      .catch(() => {});
  }, []);

  // live fee preview (server-side truth: the fee snapshot at creation)
  useEffect(() => {
    if (!amount || !wallet) return;
    const t = setTimeout(() => {
      fetch(`/api/fees/preview?channel=${channel}&amount=${encodeURIComponent(amount)}&product=single_payment`)
        .then((r) => r.json())
        .then((d) => setFee(d.data ?? null))
        .catch(() => setFee(null));
    }, 300);
    return () => clearTimeout(t);
  }, [amount, channel, wallet]);

  // All money math goes through @zfloat/money bigint helpers — never float math.
  const amountMinor = useMemo(() => {
    if (!amount) return null;
    try {
      return parseMinor(amount);
    } catch (e) {
      return e instanceof MoneyParseError ? null : null;
    }
  }, [amount]);

  const feeMinor = fee ? minorOrZero(fee.feeMinor) : 0n;
  const totalMinor = amountMinor !== null ? amountMinor + feeMinor : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          channel,
          walletId: wallet,
          category: category || undefined,
          remark,
          submit: true,
          idempotencyKey: `web-${crypto.randomUUID()}`,
          recipient: {
            name: recipientName,
            phone: phone || undefined,
            ...(channel === "bank"
              ? { bankAccountName: recipientName, bankAccountNumber: phone /* demo: reuse field */, bankCode: "01" }
              : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message?.trim() || "Failed to create payment");
      setResult(data.data);
    } catch (err) {
      setError(err instanceof Error && err.message.trim() ? err.message : "Payment failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-2xl">✓</div>
          <h2 className="text-xl font-semibold">Payment {result.status.toLowerCase().replace(/_/g, " ")}</h2>
          <p className="mt-2 text-sm text-muted">
            Your payment was created and routed. Track it from the transaction detail page.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href={`/portal/transactions/${result.paymentId}`}>
              <Button>View transaction</Button>
            </Link>
            <Link href="/portal/payments/new">
              <Button variant="secondary">Make another</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Initiate payment" subtitle="Money leaves your wallet only after validation and any required approvals." />
      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={onSubmit} className="space-y-5 lg:col-span-3">
          <Card className="space-y-5 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="wallet">Source wallet</Label>
                <Select id="wallet" value={wallet} onChange={(e) => setWallet(e.target.value)} required>
                  <option value="">Select wallet…</option>
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} — {minorToDisplay(minorOrZero(w.availableMinor))}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="channel">Channel</Label>
                <Select id="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                  {CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="amount">Amount (KES)</Label>
              <Input id="amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              {fee && amountMinor !== null && feeMinor > 0n ? (
                <p className="mt-1 text-xs text-muted">
                  Estimated fee: {minorToDisplay(feeMinor)} · total {minorToDisplay(totalMinor!)}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="recipient">Recipient name</Label>
              <Input id="recipient" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="e.g. Jane Wanjiku" required />
            </div>
            {channel !== "bank" ? (
              <div>
                <Label htmlFor="phone">Phone (Kenyan mobile)</Label>
                <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" inputMode="tel" required={channel === "mpesa"} />
              </div>
            ) : (
              <div>
                <Label htmlFor="bank">Bank account (demo)</Label>
                <Input id="bank" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Account number" required />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="category">Category</Label>
                <Select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">No category</option>
                  <option>office-supplies</option>
                  <option>transport</option>
                  <option>utilities</option>
                  <option>salaries</option>
                  <option>marketing</option>
                </Select>
              </div>
              <div className="sm:pt-7">
                <Badge tone="info">Sandbox rails — no real funds</Badge>
              </div>
            </div>
            <div>
              <Label htmlFor="remark">Remark (visible on the statement)</Label>
              <Textarea id="remark" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          </Card>

          {error?.trim() ? (
            <p role="alert" className="rounded-control border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={submitting} className="w-full">
            {submitting ? <Spinner className="h-4 w-4 text-white" /> : "Submit payment"}
          </Button>
        </form>

        <div className="lg:col-span-2">
          <Card className="sticky top-20 p-6">
            <h2 className="mb-4 font-semibold">Summary</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Amount</dt><dd className="font-medium">{amountMinor !== null ? minorToDisplay(amountMinor) : "KES 0.00"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Fee</dt><dd className="font-medium">{minorToDisplay(feeMinor)}</dd></div>
              <div className="flex justify-between border-t border-borderline pt-3"><dt className="font-medium">Total</dt><dd className="font-semibold">{totalMinor !== null ? minorToDisplay(totalMinor) : "KES 0.00"}</dd></div>
            </dl>
            <div className="mt-5 rounded-control bg-surface p-4 text-xs leading-relaxed text-muted">
              <p className="font-medium text-ink">What happens next</p>
              <p className="mt-1">1. Payment is validated server-side.</p>
              <p>2. Funds are reserved atomically from your wallet.</p>
              <p>3. Approval policy is evaluated.</p>
              <p>4. Sandbox provider executes; callback updates the ledger.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
