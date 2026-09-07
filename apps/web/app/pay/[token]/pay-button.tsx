"use client";

import { useEffect, useState } from "react";
import { Button, Input, Label, Spinner } from "@/components/ui";

/** Client-side pay flow: M-Pesa style number entry → sandbox settlement. */
export function PayButton({ token, inactive }: { token: string; inactive: boolean }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reference: string; walletBalanceMinor: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fresh payer reference per page load → natural idempotency key.
  const [payerRef] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  useEffect(() => {
    const s = sessionStorage.getItem(`pl-${token}`);
    if (s) {
      try {
        setDone(JSON.parse(s));
      } catch {
        /* ignore */
      }
    }
  }, [token]);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payerRef, payerName: name.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Payment could not be completed");
        return;
      }
      const result = {
        reference: d.data.reference,
        walletBalanceMinor: d.data.walletBalanceMinor,
      };
      sessionStorage.setItem(`pl-${token}`, JSON.stringify(result));
      setDone(result);
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  if (inactive) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-center text-sm font-medium text-warning">
        This payment link is no longer active.
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-xl border border-success/40 bg-success/10 p-4 text-center">
        <p className="text-sm font-semibold text-success">Payment received — thank you!</p>
        <p className="mt-1 font-mono text-xs text-muted">Reference {done.reference}</p>
        <p className="mt-3 text-xs text-muted">The merchant wallet has been credited and a ledger entry recorded.</p>
      </div>
    );
  }

  return (
    <form onSubmit={pay} className="space-y-4">
      <div>
        <Label>M-Pesa phone number</Label>
        <Input required inputMode="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div>
        <Label>Your name (optional)</Label>
        <Input placeholder="Jane Wanjiku" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Spinner className="h-4 w-4 text-white" /> : "Pay now with M-Pesa"}
      </Button>
      <p className="text-center text-[11px] text-muted">You will not be charged — sandbox demo rail.</p>
    </form>
  );
}
