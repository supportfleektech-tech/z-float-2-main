"use client";
/** Connect KRA eTIMS (OSCU/VSCU) + configure how customers pay you (paybill account reference). */
import { useEffect, useState } from "react";
import { PageHeader, Card, Button, Input, Label, Badge, Spinner, Switch } from "@/components/ui";

interface Device {
  kraPin: string;
  branchId: string;
  deviceSerial: string;
  driver: string;
  status: string;
  sdcId: string | null;
  mrcNo: string | null;
  taxpayerName: string | null;
  lastInvoiceNo: number;
  autoReceipt: boolean;
  defaultTaxType: string;
  lastError: string | null;
  initialisedAt: string | null;
}

interface Payload {
  data: Device | null;
  driver: string;
  environment: string;
  tenant: { kraPin: string | null; collectionAccountRef: string | null } | null;
  c2b: { shortcode: string; till: string | null };
}

export default function EtimsSettingsPage() {
  const [p, setP] = useState<Payload | null>(null);
  const [form, setForm] = useState({ kraPin: "", deviceSerial: "", branchId: "00" });
  const [accountRef, setAccountRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    fetch("/api/etims/device")
      .then((r) => r.json())
      .then((d: Payload) => {
        setP(d);
        setForm({
          kraPin: d.data?.kraPin ?? d.tenant?.kraPin ?? "",
          deviceSerial: d.data?.deviceSerial ?? "",
          branchId: d.data?.branchId ?? "00",
        });
        setAccountRef(d.tenant?.collectionAccountRef ?? "");
      })
      .catch(() => undefined);
  }
  useEffect(load, []);

  async function call(method: "PUT" | "PATCH", body: unknown, ok: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/etims/device", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Failed");
        return;
      }
      setNotice(ok);
      load();
    } finally {
      setBusy(false);
    }
  }

  const d = p?.data;
  return (
    <div className="max-w-3xl">
      <PageHeader title="eTIMS & collections settings" subtitle="Connect your KRA eTIMS device so invoices and receipts are signed automatically, and set how customers pay you on M-Pesa." />
      {notice ? <p className="mb-4 rounded-control bg-success/10 px-3 py-2 text-sm text-success">{notice}</p> : null}
      {error ? <p className="mb-4 rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}

      <Card className="mb-6 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold">KRA eTIMS device</h2>
            <p className="text-sm text-muted">
              Mode: <b>{p?.driver?.toUpperCase() ?? "…"}</b> · environment <b>{p?.environment ?? "…"}</b>
              {p?.driver === "sandbox" ? " — documents are signed by a local test signer (not valid for tax)." : null}
            </p>
          </div>
          {d ? <Badge tone={d.status === "ACTIVE" ? "success" : d.status === "FAILED" ? "danger" : "warning"}>{d.status}</Badge> : <Badge tone="neutral">Not connected</Badge>}
        </div>
        {d?.status === "ACTIVE" ? (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted">Taxpayer</dt><dd>{d.taxpayerName ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted">SCU ID</dt><dd className="font-mono">{d.sdcId}</dd></div>
            <div><dt className="text-xs text-muted">MRC no.</dt><dd className="font-mono">{d.mrcNo}</dd></div>
            <div><dt className="text-xs text-muted">Branch</dt><dd className="font-mono">{d.branchId}</dd></div>
            <div><dt className="text-xs text-muted">Last KRA invoice no.</dt><dd>{d.lastInvoiceNo}</dd></div>
            <div><dt className="text-xs text-muted">Connected</dt><dd>{d.initialisedAt ? new Date(d.initialisedAt).toLocaleString("en-KE") : "—"}</dd></div>
          </dl>
        ) : null}
        {d?.lastError ? <p className="mt-3 text-xs text-danger">Last error: {d.lastError}</p> : null}

        <form
          className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_6rem]"
          onSubmit={(e) => {
            e.preventDefault();
            void call("PUT", form, "eTIMS device initialised with KRA.");
          }}
        >
          <div>
            <Label htmlFor="et-pin">Business KRA PIN</Label>
            <Input id="et-pin" required className="font-mono uppercase" placeholder="P051234567Q" value={form.kraPin} onChange={(e) => setForm({ ...form, kraPin: e.target.value.toUpperCase() })} />
          </div>
          <div>
            <Label htmlFor="et-serial">Device serial (from KRA)</Label>
            <Input id="et-serial" required className="font-mono" placeholder="KRACU0100000001" value={form.deviceSerial} onChange={(e) => setForm({ ...form, deviceSerial: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="et-branch">Branch</Label>
            <Input id="et-branch" className="font-mono" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : d ? "Re-initialise device" : "Connect eTIMS"}</Button>
            <p className="mt-2 text-xs text-muted">
              Apply for an OSCU (online) or VSCU (high-volume) integration on the KRA eTIMS portal / GavaConnect; KRA issues the device serial.
              Z-float calls <span className="font-mono">selectInitOsdcInfo</span> and stores the returned communication key encrypted.
            </p>
          </div>
        </form>

        {d ? (
          <div className="mt-5 space-y-3 border-t border-borderline pt-4">
            <Switch
              id="et-auto"
              label="Automatically issue an eTIMS receipt for every payment received"
              checked={d.autoReceipt}
              onCheckedChange={(v) => void call("PATCH", { autoReceipt: v }, v ? "Auto receipts on." : "Auto receipts off.")}
            />
            <div className="flex items-center gap-3 text-sm">
              <Label htmlFor="et-tax">Default tax type for receipts</Label>
              <select
                id="et-tax"
                className="focus-ring rounded-control border border-borderline bg-white px-3 py-2 text-sm"
                value={d.defaultTaxType}
                onChange={(e) => void call("PATCH", { defaultTaxType: e.target.value }, "Default tax type saved.")}
              >
                <option value="B">B · VAT 16%</option>
                <option value="E">E · VAT 8%</option>
                <option value="C">C · Zero-rated</option>
                <option value="A">A · Exempt</option>
                <option value="D">D · Non-VAT (not VAT registered)</option>
              </select>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="p-6">
        <h2 className="font-semibold">M-Pesa paybill account reference</h2>
        <p className="text-sm text-muted">
          Customers pay Business no. <span className="font-mono">{p?.c2b.shortcode ?? "…"}</span>
          {p?.c2b.till ? <> (or Till <span className="font-mono">{p.c2b.till}</span>)</> : null} and enter this as the account number. Add an invoice number to settle it directly,
          e.g. <span className="font-mono">{accountRef || "ACME"}-INV-000123</span>.
        </p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void call("PATCH", { collectionAccountRef: accountRef }, "Account reference saved.");
          }}
        >
          <Input aria-label="Account reference" className="max-w-xs font-mono uppercase" placeholder="ACME" maxLength={12} value={accountRef} onChange={(e) => setAccountRef(e.target.value.toUpperCase())} />
          <Button type="submit" variant="secondary" disabled={busy}>Save</Button>
        </form>
      </Card>
    </div>
  );
}
